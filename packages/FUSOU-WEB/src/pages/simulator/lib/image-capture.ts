// ── Image capture pipeline ──

import { toBlob as htmlToImageToBlob } from "html-to-image";

type HtmlToImageToBlobFn = (el: HTMLElement, opts?: Record<string, unknown>) => Promise<Blob | null>;
const toBlobImpl = htmlToImageToBlob as unknown as HtmlToImageToBlobFn;
const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

function hasUrlResource(v: string | null | undefined): boolean {
  if (!v) return false;
  return v.includes("url(");
}

function hasHashUrlResource(v: string | null | undefined): boolean {
  if (!v) return false;
  return v.includes("url(#") || v.includes("url(\"#") || v.includes("url('#");
}

function extractCssUrl(v: string): string | null {
  const m = v.match(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/);
  return m?.[1] ?? null;
}

function sanitizeFileName(name: string): string {
  const n = name.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-");
  return n || "fleet-deck";
}

interface CaptureStats {
  totalImages: number;
  externalImages: number;
  proxiedImages: number;
  cacheHitImages: number;
  cacheMissImages: number;
  proxyFetchImages: number;
  hiddenImages: number;
  sanitizedStyleNodes: number;
}

interface SaveImageDiagnostics extends CaptureStats {
  attempt: number;
  safeMode: boolean;
  usedProxyOption: boolean;
  hideExternalOption: boolean;
  elapsedMs: number;
  success: boolean;
  note?: string;
}

function emptyCaptureStats(): CaptureStats {
  return {
    totalImages: 0, externalImages: 0, proxiedImages: 0,
    cacheHitImages: 0, cacheMissImages: 0, proxyFetchImages: 0,
    hiddenImages: 0, sanitizedStyleNodes: 0,
  };
}

function addCaptureStats(base: CaptureStats, extra: CaptureStats): CaptureStats {
  return {
    totalImages: base.totalImages + extra.totalImages,
    externalImages: base.externalImages + extra.externalImages,
    proxiedImages: base.proxiedImages + extra.proxiedImages,
    cacheHitImages: base.cacheHitImages + extra.cacheHitImages,
    cacheMissImages: base.cacheMissImages + extra.cacheMissImages,
    proxyFetchImages: base.proxyFetchImages + extra.proxyFetchImages,
    hiddenImages: base.hiddenImages + extra.hiddenImages,
    sanitizedStyleNodes: base.sanitizedStyleNodes + extra.sanitizedStyleNodes,
  };
}

function renderSaveDiagnostics(diag: SaveImageDiagnostics): string {
  return [
    `結果: ${diag.success ? "成功" : "失敗"}`,
    `試行: ${diag.attempt}回目${diag.safeMode ? " (safe mode)" : ""}`,
    `オプション: proxy=${diag.usedProxyOption ? "ON" : "OFF"}, 外部画像除外=${diag.hideExternalOption ? "ON" : "OFF"}`,
    `画像: 総数 ${diag.totalImages}, 外部 ${diag.externalImages}, proxy変換 ${diag.proxiedImages}, 非表示 ${diag.hiddenImages}`,
    `キャッシュ: hit ${diag.cacheHitImages}, miss ${diag.cacheMissImages}, proxy取得 ${diag.proxyFetchImages}`,
    `スタイル無効化ノード: ${diag.sanitizedStyleNodes}`,
    `処理時間: ${diag.elapsedMs}ms`,
    diag.note ? `備考: ${diag.note}` : "",
  ].filter(Boolean).join("\n");
}

function logSaveImageDiagnostics(diag: SaveImageDiagnostics) {
  const title = `[save-image][diag] ${diag.success ? "success" : "failed"} attempt=${diag.attempt}${diag.safeMode ? " safe" : ""}`;
  console.groupCollapsed(title);
  console.info(renderSaveDiagnostics(diag));
  console.table({
    totalImages: diag.totalImages,
    externalImages: diag.externalImages,
    proxiedImages: diag.proxiedImages,
    cacheHitImages: diag.cacheHitImages,
    cacheMissImages: diag.cacheMissImages,
    proxyFetchImages: diag.proxyFetchImages,
    hiddenImages: diag.hiddenImages,
    sanitizedStyleNodes: diag.sanitizedStyleNodes,
    proxyOption: diag.usedProxyOption,
    hideExternalOption: diag.hideExternalOption,
    elapsedMs: diag.elapsedMs,
  });
  console.groupEnd();
}

// Cache external images as data URIs so html-to-image can embed them directly.
// Blob URLs require html-to-image to re-fetch them which can fail silently and
// fall back to TRANSPARENT_PIXEL; data URIs are inlined without any re-fetch.
const externalImageDataUrlCache = new Map<string, string>();

async function fetchProxyImageAsDataUrl(absUrl: string): Promise<string | null> {
  const proxied = `/api/asset-sync/image-proxy?url=${encodeURIComponent(absUrl)}`;
  try {
    const res = await fetch(proxied, { cache: "force-cache" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    externalImageDataUrlCache.set(absUrl, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

async function getCachedExternalDataUrl(absUrl: string, stats?: CaptureStats): Promise<string | null> {
  const cached = externalImageDataUrlCache.get(absUrl);
  if (cached) {
    if (stats) stats.cacheHitImages += 1;
    return cached;
  }
  if (stats) {
    stats.cacheMissImages += 1;
    stats.proxyFetchImages += 1;
  }
  return fetchProxyImageAsDataUrl(absUrl);
}

export async function prewarmVisibleExternalImageCache(root: Pick<Element, "querySelectorAll">) {
  const targets = new Set<string>();
  root.querySelectorAll("img").forEach((img) => {
    if (!(img instanceof HTMLImageElement)) return;
    const srcAttr = img.currentSrc || img.getAttribute("src") || "";
    // data: URLs are already inlined — skip them entirely.
    if (!srcAttr || srcAttr.startsWith("data:")) return;
    try {
      const u = new URL(srcAttr, window.location.href);
      if (u.origin !== window.location.origin) targets.add(u.toString());
    } catch { /* ignore */ }
  });
  root.querySelectorAll<HTMLElement>("*").forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    const bgImage = el.style.backgroundImage;
    if (!bgImage) return;
    const rawUrl = extractCssUrl(bgImage);
    if (!rawUrl || rawUrl.startsWith("#") || rawUrl.startsWith("data:")) return;
    try {
      const u = new URL(rawUrl, window.location.href);
      if (u.origin !== window.location.origin) targets.add(u.toString());
    } catch { /* ignore */ }
  });
  if (targets.size === 0) return;
  await Promise.all(Array.from(targets, (u) => getCachedExternalDataUrl(u)));
}

async function buildCaptureNode(opts: {
  includeAirBase: boolean;
  fleetTarget: "both" | "fleet1" | "fleet2";
  transparentBackground?: boolean;
  hideExternalImages: boolean;
  useImageProxy?: boolean;
  safeMode?: boolean;
}): Promise<{ host: HTMLElement; node: HTMLElement; stats: CaptureStats } | null> {
  const src = document.getElementById("deck-capture-area");
  if (!(src instanceof HTMLElement)) return null;
  const stats = emptyCaptureStats();

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.zIndex = "-1";

  const clone = src.cloneNode(true) as HTMLElement;
  clone.style.width = `${src.getBoundingClientRect().width}px`;
  clone.style.background = opts.transparentBackground ? "transparent" : "#eceff3";
  clone.style.padding = "0";

  clone.querySelector("#data-status")?.remove();
  if (!opts.includeAirBase) clone.querySelector("#airbase-section")?.remove();
  if (opts.fleetTarget === "fleet1") clone.querySelector("#fleet-2-section")?.remove();
  if (opts.fleetTarget === "fleet2") clone.querySelector("#fleet-1-section")?.remove();

  const tasks: Promise<void>[] = [];
  clone.querySelectorAll("*").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const st = node.style;
    const cs = window.getComputedStyle(node);

    const bgImage = st.backgroundImage || "";
    const bg = st.background || "";
    const filter = st.filter || "";
    const maskImage = (st as CSSStyleDeclaration & { webkitMaskImage?: string }).webkitMaskImage || st.maskImage || "";
    const cBgImage = cs.backgroundImage || "";
    const cFilter = cs.filter || "";
    const cMaskImage = cs.maskImage || "";
    const cWebkitMaskImage = (cs as CSSStyleDeclaration & { webkitMaskImage?: string }).webkitMaskImage || "";
    const cClipPath = cs.clipPath || "";

    const bgImageUrl = bgImage ? extractCssUrl(bgImage) : null;
    const bgImageIsInlineExternal = !!(bgImageUrl &&
      (bgImageUrl.startsWith("http://") || bgImageUrl.startsWith("https://")));
    if (bgImageIsInlineExternal) {
      const rawUrl = bgImageUrl!;
      tasks.push((async () => {
        try {
          const absUrl = new URL(rawUrl, window.location.href).toString();
          const dataUrl = await getCachedExternalDataUrl(absUrl, stats);
          if (dataUrl) {
            node.style.backgroundImage = bgImage.replace(rawUrl, dataUrl);
          } else {
            // Proxy failed: clear to prevent html-to-image from fetching the
            // external URL directly (which would be CORS-blocked).
            node.style.backgroundImage = "none";
          }
        } catch { /* leave as-is */ }
      })());
    }

    if (
      (hasUrlResource(bgImage) && !bgImageIsInlineExternal) ||
      hasUrlResource(bg) ||
      hasUrlResource(filter) ||
      hasUrlResource(maskImage) ||
      hasHashUrlResource(cBgImage) ||
      hasHashUrlResource(cFilter) ||
      hasHashUrlResource(cMaskImage) ||
      hasHashUrlResource(cWebkitMaskImage) ||
      hasHashUrlResource(cClipPath)
    ) {
      stats.sanitizedStyleNodes += 1;
      if (!bgImageIsInlineExternal) st.backgroundImage = "none";
      st.background = st.backgroundColor || "transparent";
      st.filter = "none";
      st.maskImage = "none";
      (st as CSSStyleDeclaration & { webkitMaskImage?: string }).webkitMaskImage = "none";
      st.clipPath = "none";
    }

    if (opts.safeMode) {
      st.backdropFilter = "none";
      (st as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter = "none";
    }

    if (node instanceof HTMLImageElement) {
      stats.totalImages += 1;
      const srcAttr = node.currentSrc || node.getAttribute("src") || "";
      let isExternal = false;
      let absSrc = "";
      // data: URLs are already inlined — new URL() gives origin="null" which
      // would be mis-classified as external and sent through the proxy (failing).
      if (srcAttr.startsWith("data:")) {
        // Already a data URL: nothing to fetch, html-to-image embeds it as-is.
        isExternal = false;
      } else {
        try {
          const u = new URL(srcAttr, window.location.href);
          absSrc = u.toString();
          isExternal = u.origin !== window.location.origin;
        } catch {
          isExternal = true;
        }
      }
      if (isExternal) stats.externalImages += 1;

      if (opts.useImageProxy && isExternal && absSrc) {
        tasks.push((async () => {
          const dataUrl = await getCachedExternalDataUrl(absSrc, stats);
          if (dataUrl) {
            node.src = dataUrl;
            stats.proxiedImages += 1;
          } else {
            // Proxy failed: replace with transparent placeholder to prevent
            // html-to-image from falling back to the external URL (CORS-blocked).
            node.src = TRANSPARENT_PIXEL;
            stats.hiddenImages += 1;
          }
        })());
      }
      if ((opts.hideExternalImages || opts.safeMode) && isExternal) {
        node.removeAttribute("src");
        node.style.visibility = "hidden";
        stats.hiddenImages += 1;
      }
    }
  });

  if (tasks.length > 0) await Promise.all(tasks);

  host.appendChild(clone);
  document.body.appendChild(host);
  return { host, node: clone, stats };
}

/** Wire up save-image modal and button event listeners. */
export function initImageCaptureEvents() {
  document.getElementById("btn-save-image")?.addEventListener("click", () => {
    const modal = document.getElementById("save-image-modal");
    const captureRoot = document.getElementById("deck-capture-area");
    if (captureRoot) {
      prewarmVisibleExternalImageCache(captureRoot).catch(() => {});
    }
    if (modal instanceof HTMLDialogElement) modal.showModal();
  });

  document.getElementById("btn-save-image-confirm")?.addEventListener("click", async () => {
    const btn = document.getElementById("btn-save-image-confirm");
    const modal = document.getElementById("save-image-modal");
    if (!(btn instanceof HTMLButtonElement)) return;

    const fleetTarget = ((document.querySelector('input[name="saveimg-fleet-target"]:checked') as HTMLInputElement | null)?.value ?? "both") as "both" | "fleet1" | "fleet2";
    const includeAirBase = (document.getElementById("saveimg-include-airbase") as HTMLInputElement | null)?.checked ?? true;
    const transparentBackground = (document.getElementById("saveimg-transparent-bg") as HTMLInputElement | null)?.checked ?? false;
    const hideExternalImages = false;
    const useImageProxy = true;
    const scaleRaw = parseInt((document.getElementById("saveimg-scale") as HTMLSelectElement | null)?.value ?? "2", 10);
    const scale = Math.max(1, Math.min(3, Number.isFinite(scaleRaw) ? scaleRaw : 2));
    const fileBase = sanitizeFileName((document.getElementById("saveimg-filename") as HTMLInputElement | null)?.value ?? "fleet-deck");

    const prevDisabled = btn.disabled;
    const prevText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "保存中...";

    let host: HTMLElement | null = null;
    let aggregatedStats = emptyCaptureStats();
    const startedAt = performance.now();
    let attempt = 1;
    let safeModeUsed = false;
    try {
      const prepared = await buildCaptureNode({ includeAirBase, fleetTarget, transparentBackground, hideExternalImages, useImageProxy });
      if (!prepared) throw new Error("capture target missing");
      host = prepared.host;
      aggregatedStats = addCaptureStats(aggregatedStats, prepared.stats);

      let blob: Blob | null = null;
      let primaryError: unknown = null;

      try {
        const renderOpts: Record<string, unknown> = {
          pixelRatio: scale,
          cacheBust: false,
          skipFonts: true,
          imagePlaceholder: TRANSPARENT_PIXEL,
        };
        if (!transparentBackground) renderOpts.backgroundColor = "#eceff3";
        blob = await toBlobImpl(prepared.node, renderOpts);
      } catch (e) {
        primaryError = e;
      }

      if (!blob) {
        const elapsedMs = Math.round(performance.now() - startedAt);
        logSaveImageDiagnostics({
          ...aggregatedStats,
          attempt: 1,
          safeMode: false,
          usedProxyOption: useImageProxy,
          hideExternalOption: hideExternalImages,
          elapsedMs,
          success: false,
          note: `1回目失敗のため safe mode 再試行 (target=${fleetTarget})`,
        });
        if (host && host.parentElement) host.parentElement.removeChild(host);
        const retry = await buildCaptureNode({ includeAirBase, fleetTarget, transparentBackground, hideExternalImages: true, useImageProxy: true, safeMode: true });
        if (!retry) throw (primaryError ?? new Error("capture target missing"));
        host = retry.host;
        aggregatedStats = addCaptureStats(aggregatedStats, retry.stats);
        attempt = 2;
        safeModeUsed = true;
        const retryRenderOpts: Record<string, unknown> = {
          pixelRatio: Math.min(2, scale),
          cacheBust: false,
          skipFonts: true,
          imagePlaceholder: TRANSPARENT_PIXEL,
          filter: (n: Node) => !(n instanceof HTMLImageElement),
        };
        if (!transparentBackground) retryRenderOpts.backgroundColor = "#eceff3";
        blob = await toBlobImpl(retry.node, retryRenderOpts);
      }
      if (!blob) throw new Error("png conversion failed");

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileBase}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      logSaveImageDiagnostics({
        ...aggregatedStats,
        attempt,
        safeMode: safeModeUsed,
        usedProxyOption: useImageProxy,
        hideExternalOption: hideExternalImages,
        elapsedMs: Math.round(performance.now() - startedAt),
        success: true,
        note: `target=${fleetTarget}`,
      });
      if (modal instanceof HTMLDialogElement) modal.close();
    } catch (err) {
      console.error("[save-image] failed", err);
      const msg = err instanceof Error ? err.message : String(err);
      logSaveImageDiagnostics({
        ...aggregatedStats,
        attempt,
        safeMode: safeModeUsed,
        usedProxyOption: useImageProxy,
        hideExternalOption: hideExternalImages,
        elapsedMs: Math.round(performance.now() - startedAt),
        success: false,
        note: `target=${fleetTarget}; ${msg}`,
      });
      alert(`画像保存に失敗しました。\n${msg}\nCORS制限のため外部画像は自動除外で保存されます。`);
    } finally {
      if (host && host.parentElement) host.parentElement.removeChild(host);
      btn.disabled = prevDisabled;
      if (prevText != null) btn.textContent = prevText;
    }
  });
}
