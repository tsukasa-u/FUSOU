/**
 * FormulaStore: abstraction layer for formula result storage.
 *
 * - Development: reads JSON files from the local filesystem
 *   (fusou-datasets/analysis/results/).
 * - Production: reads from R2 bucket + D1 index table.
 *
 * Note: node:fs and node:path are imported dynamically inside
 * LocalFormulaStore methods to avoid breaking Cloudflare Workers.
 */

// ========================
// Types
// ========================

export interface FormulaArtifact {
  id: string;
  created_at: string;
  target: string;
  status: "validated" | "candidate" | "failed";
  best_formula: {
    latex: string;
    sympy_str: string;
    complexity: number;
    coefficients: Record<string, number>;
    ast_tree: {
      nodes: Array<{
        id: string;
        type: string;
        position: { x: number; y: number };
        data: { label: string; type: string; latex?: string };
      }>;
      edges: Array<{
        id: string;
        source: string;
        target: string;
      }>;
    };
  };
  pareto_front: Array<{
    complexity: number;
    loss: number;
    latex: string;
    sympy_str: string;
  }>;
  regime_info: {
    breakpoints: Array<{
      value: number;
      variable: string;
      confidence: number;
    }>;
    regimes: Array<{
      range: [number | null, number | null];
      slope: number | null;
      intercept: number | null;
    }>;
  } | null;
  validation: {
    known_formula_match: boolean | null;
    known_formula_latex: string | null;
    structural_similarity: number | null;
    metrics: {
      mae: number;
      rmse: number;
      interval_accuracy: number;
      n_samples: number;
    };
    residual_histogram?: {
      bins: number[];
      counts: number[];
    };
    residual_by_input?: Array<{ x: number; residual: number }>;
  };
  data_summary: Record<string, unknown>;
  data_source?: {
    type: "sdk" | "csv" | "synthetic" | "unknown";
    /** Table names from fusou-datasets SDK */
    tables?: string[];
    /** Table name → description */
    table_descriptions?: Record<string, string>;
    /** Column name → description (e.g. "damage" → "ダメージ値") */
    column_descriptions?: Record<string, string>;
    /** CSV file path (for CSV mode) */
    csv_path?: string;
    /** Human-readable formula description (for synthetic mode) */
    formula_description?: string;
    /** Additional notes about the data source */
    note?: string;
  } | null;
  feature_selection?: {
    target_col: string;
    all_features: string[];
    selected_features: string[];
    rankings: Array<{
      name: string;
      mi_score: number;
      tree_importance: number;
      permutation_importance: number;
      combined_rank: number;
    }>;
    metadata?: Record<string, unknown>;
  } | null;
  actual_vs_predicted?: Array<{
    actual: number;
    predicted: number;
    features?: Record<string, number>;
  }> | null;
  pipeline_config: Record<string, unknown>;
}

export interface FormulaIndexEntry {
  id: string;
  target: string;
  status: string;
  best_formula_latex: string;
  complexity: number;
  interval_accuracy: number | null;
  created_at: string;
}

// ========================
// Interface
// ========================

export interface FormulaStore {
  list(): Promise<FormulaIndexEntry[]>;
  get(id: string): Promise<FormulaArtifact | null>;
  put(artifact: FormulaArtifact): Promise<void>;
}

// ========================
// Local (dev) implementation
// ========================

export class LocalFormulaStore implements FormulaStore {
  private readonly dir: string;

  constructor(resultsDir?: string) {
    this.dir = resultsDir || "";
  }

  private async resolveDir(): Promise<{ fs: typeof import("node:fs"); path: typeof import("node:path"); dir: string }> {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = this.dir || path.resolve(process.cwd(), "..", "fusou-datasets", "analysis", "results");
    return { fs, path, dir };
  }

  async list(): Promise<FormulaIndexEntry[]> {
    const { fs, path, dir } = await this.resolveDir();
    const indexPath = path.join(dir, "index.json");
    try {
      const raw = fs.readFileSync(indexPath, "utf-8");
      return JSON.parse(raw) as FormulaIndexEntry[];
    } catch {
      // No index.json → scan for individual JSON files
      return this.scanDir();
    }
  }

  async get(id: string): Promise<FormulaArtifact | null> {
    const { fs, path, dir } = await this.resolveDir();
    const filePath = path.join(dir, `${id}.json`);
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as FormulaArtifact;
    } catch {
      return null;
    }
  }

  async put(artifact: FormulaArtifact): Promise<void> {
    const { fs, path, dir } = await this.resolveDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write artifact
    const filePath = path.join(dir, `${artifact.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(artifact, null, 2), "utf-8");

    // Update index
    const index = await this.list();
    const filtered = index.filter((e) => e.id !== artifact.id);
    const best = artifact.best_formula || {};
    const metrics = artifact.validation?.metrics || {};

    filtered.push({
      id: artifact.id,
      target: artifact.target,
      status: artifact.status,
      best_formula_latex: best.latex || "",
      complexity: best.complexity || 0,
      interval_accuracy: metrics.interval_accuracy ?? null,
      created_at: artifact.created_at,
    });

    filtered.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const indexPath = path.join(dir, "index.json");
    fs.writeFileSync(indexPath, JSON.stringify(filtered, null, 2), "utf-8");
  }

  private async scanDir(): Promise<FormulaIndexEntry[]> {
    const { fs, path, dir } = await this.resolveDir();
    try {
      if (!fs.existsSync(dir)) return [];
      const files = fs.readdirSync(dir);
      const entries: FormulaIndexEntry[] = [];

      for (const file of files) {
        if (file === "index.json" || !file.endsWith(".json")) continue;
        try {
          const raw = fs.readFileSync(path.join(dir, file), "utf-8");
          const artifact = JSON.parse(raw) as FormulaArtifact;
          const best = artifact.best_formula || ({} as any);
          const metrics = artifact.validation?.metrics || ({} as any);

          entries.push({
            id: artifact.id,
            target: artifact.target,
            status: artifact.status,
            best_formula_latex: best.latex || "",
            complexity: best.complexity || 0,
            interval_accuracy: metrics.interval_accuracy ?? null,
            created_at: artifact.created_at,
          });
        } catch {
          // skip invalid files
        }
      }

      entries.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      return entries;
    } catch {
      return [];
    }
  }
}

// ========================
// R2 + D1 (prod) implementation
// ========================

export class R2FormulaStore implements FormulaStore {
  private readonly bucket: any; // R2BucketBinding
  private readonly db: any; // D1Database

  constructor(bucket: any, db: any) {
    this.bucket = bucket;
    this.db = db;
  }

  async list(): Promise<FormulaIndexEntry[]> {
    try {
      const result = await this.db
        .prepare(
          `SELECT id, target, status, best_formula_latex, complexity,
                  interval_accuracy, created_at
           FROM formula_results
           ORDER BY created_at DESC
           LIMIT 100`
        )
        .all();

      return (result?.results ?? []).map((row: any) => ({
        id: String(row.id),
        target: String(row.target ?? ""),
        status: String(row.status ?? "candidate"),
        best_formula_latex: String(row.best_formula_latex ?? ""),
        complexity: Number(row.complexity ?? 0),
        interval_accuracy:
          row.interval_accuracy != null
            ? Number(row.interval_accuracy)
            : null,
        created_at: String(row.created_at ?? ""),
      }));
    } catch (err) {
      console.error("[FormulaStore] D1 list error:", err);
      return [];
    }
  }

  async get(id: string): Promise<FormulaArtifact | null> {
    try {
      const key = `formulas/${id}.json`;
      const obj = await this.bucket.get(key);
      if (!obj) return null;

      const buf = await obj.arrayBuffer();
      const text = new TextDecoder().decode(buf);
      return JSON.parse(text) as FormulaArtifact;
    } catch (err) {
      console.error(`[FormulaStore] R2 get error for ${id}:`, err);
      return null;
    }
  }

  async put(artifact: FormulaArtifact): Promise<void> {
    // Write to R2
    const key = `formulas/${artifact.id}.json`;
    const data = JSON.stringify(artifact, null, 2);
    await this.bucket.put(key, data, {
      httpMetadata: { contentType: "application/json" },
    });

    // Upsert D1 index
    const best = artifact.best_formula || ({} as any);
    const metrics = artifact.validation?.metrics || ({} as any);

    await this.db
      .prepare(
        `INSERT OR REPLACE INTO formula_results
           (id, target, status, best_formula_latex, complexity,
            interval_accuracy, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        artifact.id,
        artifact.target,
        artifact.status,
        best.latex || "",
        best.complexity || 0,
        metrics.interval_accuracy ?? null,
        artifact.created_at
      )
      .run();
  }
}

// ========================
// Factory
// ========================

/**
 * Create the appropriate FormulaStore based on environment.
 *
 * In development mode, uses LocalFormulaStore (filesystem).
 * In production, uses R2FormulaStore (R2 + D1).
 */
export function createFormulaStore(env: {
  isDev: boolean;
  runtime: Record<string, any>;
}): FormulaStore {
  if (env.isDev) {
    const customDir = env.runtime.FORMULA_RESULTS_DIR || undefined;
    return new LocalFormulaStore(customDir);
  }

  const bucket = env.runtime.BATTLE_DATA_BUCKET; // reuse existing bucket
  const db = env.runtime.BATTLE_INDEX_DB; // reuse existing DB

  if (!bucket || !db) {
    console.warn(
      "[FormulaStore] R2/D1 bindings not available, falling back to local"
    );
    return new LocalFormulaStore();
  }

  return new R2FormulaStore(bucket, db);
}
