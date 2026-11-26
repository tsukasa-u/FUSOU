class ZDD {
  constructor() {
    this.nodes = [
      { id: 0, v: Infinity, p0: 0, p1: 0 },
      { id: 1, v: Infinity, p0: 0, p1: 0 },
    ];
    this.uniqueTable = new Map();
    this.unionCache = new Map();
    this.poolsCache = new Map();
  }

  getNode(v, p0, p1) {
    if (p1 === 0) return p0;
    const key = `${v},${p0},${p1}`;
    const existing = this.uniqueTable.get(key);
    if (existing !== undefined) return existing;
    const id = this.nodes.length;
    this.nodes.push({ id, v, p0, p1 });
    this.uniqueTable.set(key, id);
    return id;
  }

  base(combo, idx = 0) {
    if (idx === combo.length) return 1;
    return this.getNode(combo[idx], 0, this.base(combo, idx + 1));
  }

  /**
   * O(N) bottom-up ZDD construction from a lexicographically sorted list of
   * equal-length combos (in the current variable ordering).
   */
  buildFromSorted(combos, lo, hi, col, width) {
    if (lo >= hi) return 0;
    if (col === width) return 1;

    const groups = [];
    let i = lo;
    while (i < hi) {
      const v = combos[i][col];
      let j = i + 1;
      while (j < hi && combos[j][col] === v) j++;
      groups.push(v, i, j);
      i = j;
    }

    let p0 = 0;
    for (let g = groups.length - 3; g >= 0; g -= 3) {
      const v = groups[g];
      const s = groups[g + 1];
      const e = groups[g + 2];
      const p1 = this.buildFromSorted(combos, s, e, col + 1, width);
      p0 = this.getNode(v, p0, p1);
    }
    return p0;
  }

  union(a, b) {
    if (a === 0) return b;
    if (b === 0) return a;
    if (a === b) return a;
    if (a > b) {
      const tmp = a;
      a = b;
      b = tmp;
    }
    const key = `${a},${b}`;
    const cached = this.unionCache.get(key);
    if (cached !== undefined) return cached;

    const nA = this.nodes[a];
    const nB = this.nodes[b];
    let res;

    if (nA.v < nB.v) {
      res = this.getNode(nA.v, this.union(nA.p0, b), nA.p1);
    } else if (nA.v > nB.v) {
      res = this.getNode(nB.v, this.union(a, nB.p0), nB.p1);
    } else {
      res = this.getNode(
        nA.v,
        this.union(nA.p0, nB.p0),
        this.union(nA.p1, nB.p1),
      );
    }

    this.unionCache.set(key, res);
    return res;
  }

  extractPools(nodeId) {
    if (nodeId === 0) return [];
    if (nodeId === 1) return [[]];

    const cached = this.poolsCache.get(nodeId);
    if (cached !== undefined) return cached;

    const node = this.nodes[nodeId];
    const p1Pools = this.extractPools(node.p1);
    const res1 = new Array(p1Pools.length);
    for (let i = 0; i < p1Pools.length; i++) {
      res1[i] = [[node.v], ...p1Pools[i]];
    }
    const res0 = this.extractPools(node.p0);

    // Merge implicants sharing identical suffix pools
    const map = new Map();
    const out0 = new Array(res0.length);
    for (let i = 0; i < res0.length; i++) {
      const imp = res0[i];
      const suffix = suffixKey(imp);
      let indices = map.get(suffix);
      if (!indices) {
        indices = [];
        map.set(suffix, indices);
      }
      indices.push(i);
      out0[i] = imp;
    }

    const out1 = [];
    for (let r = 0; r < res1.length; r++) {
      const imp = res1[r];
      const suffix = suffixKey(imp);
      const indices = map.get(suffix);
      if (indices && indices.length > 0) {
        let consumed = false;
        while (indices.length > 0) {
          const idx = indices.pop();
          if (out0[idx] !== null) {
            const matched = out0[idx];
            const mergedFirstPool = mergeSortedUnique(imp[0], matched[0]);
            out1.push([mergedFirstPool, ...imp.slice(1)]);
            out0[idx] = null;
            consumed = true;
            break;
          }
        }
        if (!consumed) out1.push(imp);
      } else {
        out1.push(imp);
      }
    }

    for (let i = 0; i < out0.length; i++) {
      if (out0[i] !== null) out1.push(out0[i]);
    }

    this.poolsCache.set(nodeId, out1);
    return out1;
  }
}

function suffixKey(imp) {
  let s = "";
  for (let i = 1; i < imp.length; i++) {
    if (i > 1) s += "|";
    s += imp[i].join(",");
  }
  return s;
}

function mergeSortedUnique(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] < b[j]) out.push(a[i++]);
    else if (b[j] < a[i]) out.push(b[j++]);
    else {
      out.push(a[i++]);
      j++;
    }
  }
  while (i < a.length) out.push(a[i++]);
  while (j < b.length) out.push(b[j++]);
  return out;
}

/**
 * Fast O(M * k) hash-indexed implicant merger.
 * Repeatedly merges implicants of length k that share (k - 1) identical pools
 * and differ in exactly 1 pool (preserving exact Cartesian product union).
 */
function postMergeImplicants(implicants) {
  let current = implicants;
  let changed = true;
  let pass = 0;
  const maxPasses = 16;

  while (changed && pass < maxPasses) {
    changed = false;
    pass++;
    const n = current.length;
    if (n <= 1) break;

    // Group by (k - 1) matching pool keys for each omitted position.
    // To avoid overlapping merges in one pass, process one canonical coordinate
    // signature at a time: group all implicants that share the exact same
    // (k - 1) sorted pool keys and merge all their differing pools together!
    const poolStrs = new Array(n);
    for (let i = 0; i < n; i++) {
      const imp = current[i];
      const strs = new Array(imp.length);
      for (let c = 0; c < imp.length; c++) strs[c] = imp[c].join(",");
      poolStrs[i] = strs;
    }

    const used = new Uint8Array(n);
    const nextCurrent = [];

    // Try merging along each omitted column index (sorted-key bucket)
    const buckets = new Map();
    for (let i = 0; i < n; i++) {
      const strs = poolStrs[i];
      const k = strs.length;
      for (let skip = 0; skip < k; skip++) {
        // Build sorted key of the other (k - 1) pools
        const others = new Array(k - 1);
        let p = 0;
        for (let c = 0; c < k; c++) {
          if (c !== skip) others[p++] = strs[c];
        }
        others.sort();
        const bKey = `${k}|${others.join(";")}`;
        let list = buckets.get(bKey);
        if (!list) {
          list = [];
          buckets.set(bKey, list);
        }
        list.push(i, skip);
      }
    }

    // Prioritize buckets that merge the most implicants first (greedy max reduction)
    const mergeable = [];
    for (const list of buckets.values()) {
      if (list.length >= 4) mergeable.push(list); // at least 2 entries (2 ints per entry)
    }
    mergeable.sort((a, b) => b.length - a.length);

    for (let b = 0; b < mergeable.length; b++) {
      const list = mergeable[b];
      // Collect unused implicants in this bucket (avoiding duplicate i within same bucket)
      const pickedIdxs = [];
      const pickedSkips = [];
      for (let p = 0; p < list.length; p += 2) {
        const idx = list[p];
        const skip = list[p + 1];
        if (used[idx]) continue;
        if (pickedIdxs.includes(idx)) continue;
        pickedIdxs.push(idx);
        pickedSkips.push(skip);
      }
      if (pickedIdxs.length < 2) continue;

      // Verify all differing pools are disjoint from the kept pools? No: Cartesian
      // product union over the same (k-1) pools is always valid for distinct-item
      // combos because if (x, a, b) and (y, a, b) are both distinct-item combos,
      // neither x nor y equals a or b, so ({x, y} × {a} × {b}) has exact same combos!
      const baseImp = current[pickedIdxs[0]];
      const baseSkip = pickedSkips[0];
      let mergedPool = baseImp[baseSkip];
      for (let m = 1; m < pickedIdxs.length; m++) {
        mergedPool = mergeSortedUnique(
          mergedPool,
          current[pickedIdxs[m]][pickedSkips[m]],
        );
      }
      const newImp = [];
      for (let c = 0; c < baseImp.length; c++) {
        newImp.push(c === baseSkip ? mergedPool : baseImp[c]);
      }
      for (let m = 0; m < pickedIdxs.length; m++) {
        used[pickedIdxs[m]] = 1;
      }
      nextCurrent.push(newImp);
      changed = true;
    }

    for (let i = 0; i < n; i++) {
      if (!used[i]) nextCurrent.push(current[i]);
    }
    current = nextCurrent;
  }

  // Canonicalize each implicant (sort each pool ascending, sort pools lexicographically)
  for (let i = 0; i < current.length; i++) {
    const imp = current[i];
    for (let c = 0; c < imp.length; c++) {
      imp[c] = [...imp[c]].sort((a, b) => a - b);
    }
    imp.sort((a, b) => {
      if (a.length !== b.length) return a.length - b.length;
      for (let k = 0; k < a.length; k++) {
        if (a[k] !== b[k]) return a[k] - b[k];
      }
      return 0;
    });
  }
  current.sort((a, b) => {
    for (let c = 0; c < Math.min(a.length, b.length); c++) {
      const pa = a[c];
      const pb = b[c];
      if (pa.length !== pb.length) return pa.length - pb.length;
      for (let k = 0; k < pa.length; k++) {
        if (pa[k] !== pb[k]) return pa[k] - pb[k];
      }
    }
    return a.length - b.length;
  });

  return current;
}

function compressWithZDD(combos) {
  if (!combos || combos.length === 0) return null;
  const width = combos[0].length;

  // Order variables by descending item frequency so high-frequency shared items
  // sit at the top of the ZDD, maximizing structural sharing and pool merging.
  const freq = new Map();
  for (let i = 0; i < combos.length; i++) {
    const c = combos[i];
    for (let j = 0; j < width; j++) {
      const id = c[j];
      freq.set(id, (freq.get(id) || 0) + 1);
    }
  }
  const orderedIds = [...freq.keys()].sort(
    (a, b) => freq.get(b) - freq.get(a) || a - b,
  );
  const rankOf = new Map();
  for (let i = 0; i < orderedIds.length; i++) rankOf.set(orderedIds[i], i);

  // Remap combos into rank space and sort lexicographically
  const ranked = new Array(combos.length);
  for (let i = 0; i < combos.length; i++) {
    const c = combos[i];
    const rc = new Array(width);
    for (let j = 0; j < width; j++) rc[j] = rankOf.get(c[j]);
    rc.sort((a, b) => a - b);
    ranked[i] = rc;
  }
  ranked.sort((a, b) => {
    for (let j = 0; j < width; j++) {
      if (a[j] !== b[j]) return a[j] - b[j];
    }
    return 0;
  });

  // Deduplicate ranked combos (safety guard)
  let uniqueLen = 0;
  for (let i = 0; i < ranked.length; i++) {
    if (uniqueLen > 0) {
      const prev = ranked[uniqueLen - 1];
      const cur = ranked[i];
      let same = true;
      for (let j = 0; j < width; j++) {
        if (prev[j] !== cur[j]) {
          same = false;
          break;
        }
      }
      if (same) continue;
    }
    ranked[uniqueLen++] = ranked[i];
  }
  ranked.length = uniqueLen;

  const zdd = new ZDD();
  const root = zdd.buildFromSorted(ranked, 0, ranked.length, 0, width);
  const rankedImplicants = zdd.extractPools(root);

  // Map ranks back to real item IDs
  let implicants = new Array(rankedImplicants.length);
  for (let i = 0; i < rankedImplicants.length; i++) {
    const imp = rankedImplicants[i];
    const mapped = new Array(imp.length);
    for (let c = 0; c < imp.length; c++) {
      const p = imp[c];
      const mp = new Array(p.length);
      for (let k = 0; k < p.length; k++) mp[k] = orderedIds[p[k]];
      mp.sort((a, b) => a - b);
      mapped[c] = mp;
    }
    implicants[i] = mapped;
  }

  implicants = postMergeImplicants(implicants);
  return implicants.length < combos.length ? implicants : null;
}

module.exports = { compressWithZDD, ZDD };
