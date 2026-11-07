(() => {
if (window.__fusouInitScriptLoaded) return;
window.__fusouInitScriptLoaded = true;

const GAME_FRAME_HEIGHT = 720;
const GAME_FRAME_WIDTH = 1200;
const TITLEBAR_HEIGHT = 32;
let oldUrl = "";
let isInitialized = false;
let areShortcutsBound = false;

const isTopWindow = () => {
  try {
    return window.self === window.top;
  } catch (e) {
    return false;
  }
};

let fusouCurrentVolume = 1.0;
let fusouIsMuted = false;

const FUSOU_LOGO_SVG = `
<svg viewBox="0 0 1000 1000" width="16" height="16" xmlns="http://www.w3.org/2000/svg" style="display:inline-block; vertical-align:middle; flex-shrink:0; pointer-events:none;">
  <rect x="150" y="73" width="750" height="225" rx="75" fill="#B5D95A" />
  <rect x="150" y="388" width="450" height="225" rx="75" fill="#96C54E" />
  <rect x="150" y="703" width="225" height="225" rx="75" fill="#76B142" />
</svg>
`;

const SCREENSHOT_SVG = `
<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="display:inline-block; vertical-align:middle; pointer-events:none;">
  <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
  <path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
</svg>
`;

const RELOAD_SVG = `
<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="display:inline-block; vertical-align:middle; pointer-events:none;">
  <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
</svg>
`;

const SPEAKER_MUTED_SVG = `
<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#ef4444" stroke-width="2" style="display:inline-block; vertical-align:middle; pointer-events:none;">
  <path stroke-linecap="round" stroke-linejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
  <path stroke-linecap="round" stroke-linejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
</svg>
`;

const SPEAKER_LOW_SVG = `
<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="display:inline-block; vertical-align:middle; pointer-events:none;">
  <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m-4.243-8.486L7.586 11H6a1 1 0 00-1 1v0a1 1 0 001 1h1.586l3.707 3.95c.63.67 1.707.225 1.707-.707V7.757c0-.932-1.077-1.378-1.707-.707z" />
</svg>
`;

const SPEAKER_HIGH_SVG = `
<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="display:inline-block; vertical-align:middle; pointer-events:none;">
  <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
</svg>
`;

const MINIMIZE_SVG = `
<svg width="12" height="12" viewBox="0 0 12 12" style="display:inline-block; vertical-align:middle; pointer-events:none;">
  <rect fill="currentColor" width="10" height="1" x="1" y="6" />
</svg>
`;

const MAXIMIZE_SVG = `
<svg width="12" height="12" viewBox="0 0 12 12" style="display:inline-block; vertical-align:middle; pointer-events:none;">
  <rect fill="none" stroke="currentColor" stroke-width="1" width="9" height="9" x="1.5" y="1.5" />
</svg>
`;

const RESTORE_SVG = `
<svg width="12" height="12" viewBox="0 0 12 12" style="display:inline-block; vertical-align:middle; pointer-events:none;">
  <rect fill="none" stroke="currentColor" stroke-width="1" width="7" height="7" x="3.5" y="1.5" />
  <polyline fill="none" stroke="currentColor" stroke-width="1" points="1.5,4 1.5,10.5 8,10.5" />
</svg>
`;

const CLOSE_SVG = `
<svg width="12" height="12" viewBox="0 0 12 12" style="display:inline-block; vertical-align:middle; pointer-events:none;">
  <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" stroke-width="1.2" />
  <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" stroke-width="1.2" />
</svg>
`;

const ensureScrollbarSuppressionStyles = () => {
  if (document.getElementById("fusou-scrollbar-styles")) return;
  const target = document.head || document.documentElement || document.body;
  if (!target) return;
  const style = document.createElement("style");
  style.id = "fusou-scrollbar-styles";
  style.textContent = `
    * {
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }
    *::-webkit-scrollbar,
    html::-webkit-scrollbar,
    body::-webkit-scrollbar,
    iframe::-webkit-scrollbar,
    ::-webkit-scrollbar,
    ::-webkit-scrollbar-track,
    ::-webkit-scrollbar-thumb,
    ::-webkit-scrollbar-corner,
    ::-webkit-resizer {
      display: none !important;
      width: 0 !important;
      height: 0 !important;
      background: transparent !important;
    }
  `;
  target.appendChild(style);
};

ensureScrollbarSuppressionStyles();

const ensureTitlebarStyles = () => {
  if (!isTopWindow()) {
    ensureScrollbarSuppressionStyles();
    return;
  }
  ensureScrollbarSuppressionStyles();
  if (document.getElementById("fusou-titlebar-styles")) return;
  const target = document.head || document.documentElement || document.body;
  if (!target) return;
  const style = document.createElement("style");
  style.id = "fusou-titlebar-styles";
  style.textContent = `
    /* Base window transparency & full 100vw x 100vh container */
    html {
      width: 100vw !important;
      height: 100vh !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      background-color: transparent !important;
      background: transparent !important;
    }
    body {
      box-sizing: border-box !important;
      width: 100vw !important;
      height: 100vh !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      background-color: transparent !important;
      background: transparent !important;
    }

    /* Clip entire window surface strictly to 10px rounded rectangle (eliminates square corner bleed) */
    html:not(.is-maximized):not(.fusou-screenshot-mode) {
      clip-path: inset(0 round 10px) !important;
    }
    html:not(.is-maximized):not(.fusou-screenshot-mode) body {
      clip-path: inset(0 round 10px) !important;
    }
    html.is-maximized,
    html.is-maximized body,
    html.fusou-screenshot-mode,
    html.fusou-screenshot-mode body {
      clip-path: none !important;
    }

    /* Prevent DMM white container/background bleeding into transparent corners */
    #w,
    #main-ntg,
    #root {
      background: transparent !important;
      background-color: transparent !important;
      border: none !important;
      box-shadow: none !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    /* Subtle window outline frame (10px rounded corners) */
    #fusou-window-frame {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      pointer-events: none !important;
      box-sizing: border-box !important;
      z-index: 2147483647 !important;
      border: 1px solid rgba(0, 0, 0, 0.18) !important;
      border-radius: 10px !important;
    }
    html.fusou-game-mode #fusou-window-frame {
      border: 1px solid rgba(255, 255, 255, 0.15) !important;
    }
    html.is-maximized #fusou-window-frame,
    html.fusou-screenshot-mode #fusou-window-frame {
      border-radius: 0px !important;
      border: none !important;
      display: none !important;
    }

    /* Non-game default canvas background (white with bottom 10px rounded corners) */
    #fusou-canvas-bg {
      position: fixed !important;
      top: ${TITLEBAR_HEIGHT}px !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      width: 100vw !important;
      height: calc(100vh - ${TITLEBAR_HEIGHT}px) !important;
      background-color: #ffffff !important;
      pointer-events: none !important;
      box-sizing: border-box !important;
      z-index: -1000 !important;
    }
    html:not(.is-maximized):not(.fusou-screenshot-mode) #fusou-canvas-bg {
      border-top-left-radius: 0px !important;
      border-top-right-radius: 0px !important;
      border-bottom-left-radius: 10px !important;
      border-bottom-right-radius: 10px !important;
    }
    html.is-maximized #fusou-canvas-bg,
    html.fusou-screenshot-mode #fusou-canvas-bg {
      border-radius: 0px !important;
      clip-path: none !important;
    }
    html.fusou-game-mode #fusou-canvas-bg {
      display: none !important;
    }

    /* Non-game pages (login, terms, etc): natural layout with titlebar clearance */
    body:not(.fusou-game-mode) {
      padding-top: ${TITLEBAR_HEIGHT}px !important;
      overflow: auto !important;
    }
    html:not(.is-maximized):not(.fusou-screenshot-mode) body:not(.fusou-game-mode) {
      border-top-left-radius: 0px !important;
      border-top-right-radius: 0px !important;
      border-bottom-left-radius: 10px !important;
      border-bottom-right-radius: 10px !important;
    }
    html.is-maximized body:not(.fusou-game-mode),
    html.fusou-screenshot-mode body:not(.fusou-game-mode) {
      border-radius: 0px !important;
      clip-path: none !important;
    }

    /* Game Content Container (equivalent to fusou-app .window-content-container) */
    #area-game,
    .fusou-game-container {
      position: fixed !important;
      top: ${TITLEBAR_HEIGHT}px !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      width: 100vw !important;
      height: calc(100vh - ${TITLEBAR_HEIGHT}px) !important;
      margin: 0 !important;
      padding: 0 !important;
      background-color: #0e0e11 !important;
      background: #0e0e11 !important;
      overflow: hidden !important;
      z-index: 1000 !important;
      box-sizing: border-box !important;
      border: none !important;
      border-radius: 0px !important;
      clip-path: none !important;
      isolation: isolate !important;
      contain: paint !important;
    }

    /* Game frame placed inside game container */
    #area-game #game_frame,
    .fusou-game-container #game_frame {
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
      outline: none !important;
      width: ${GAME_FRAME_WIDTH}px !important;
      height: ${GAME_FRAME_HEIGHT}px !important;
      transform-origin: 0 0 !important;
      background-color: #0e0e11 !important;
      background: #0e0e11 !important;
      border-radius: 0px !important;
      clip-path: none !important;
    }

    /* Hide unnecessary DMM clutter in game mode so they never bleed white rectangles */
    .fusou-game-mode #ntg-recommend,
    .fusou-game-mode #foot,
    .fusou-game-mode #header,
    .fusou-game-mode .dmm-ntgnavi,
    .fusou-game-mode aside,
    .fusou-game-mode footer {
      display: none !important;
    }

    #fusou-titlebar {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      height: ${TITLEBAR_HEIGHT}px !important;
      background-color: #27272a !important;
      background-color: oklch(27% 0.006 286.033) !important;
      color: #f1f5f9 !important;
      color: oklch(97.807% 0.029 256.847) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 0 10px !important;
      z-index: 2147483647 !important;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
      font-size: 12px !important;
      user-select: none !important;
      -webkit-user-select: none !important;
      border: none !important;
      border-bottom: none !important;
      box-sizing: border-box !important;
      cursor: default !important;
      -webkit-app-region: drag !important;
    }
    html:not(.is-maximized) #fusou-titlebar {
      border-top-left-radius: 10px !important;
      border-top-right-radius: 10px !important;
      border-bottom-left-radius: 0px !important;
      border-bottom-right-radius: 0px !important;
    }
    html.is-maximized #fusou-titlebar {
      border-radius: 0px !important;
    }
    #fusou-titlebar * {
      box-sizing: border-box !important;
    }
    #fusou-titlebar button,
    #fusou-titlebar input,
    #fusou-volume-popover {
      -webkit-app-region: no-drag !important;
      cursor: pointer !important;
    }
    .fusou-tool-group {
      display: flex !important;
      align-items: center !important;
      gap: 4px !important;
    }
    .fusou-tool-btn {
      height: 24px !important;
      min-height: 24px !important;
      padding: 0 6px !important;
      border-radius: 4px !important;
      border: none !important;
      background: transparent !important;
      color: #e5e7eb !important;
      cursor: pointer !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 4px !important;
      font-size: 12px !important;
      font-family: inherit !important;
      transition: all 0.15s ease !important;
      box-sizing: border-box !important;
    }
    .fusou-tool-btn:hover {
      background: rgba(255, 255, 255, 0.1) !important;
      color: #ffffff !important;
    }
    .fusou-tool-btn.fusou-active {
      background: rgba(255, 255, 255, 0.15) !important;
    }
    .fusou-win-controls {
      display: flex !important;
      align-items: center !important;
      height: 100% !important;
      margin-right: -10px !important;
    }
    .fusou-win-btn {
      width: 40px !important;
      height: ${TITLEBAR_HEIGHT}px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      border: none !important;
      background: transparent !important;
      color: #e5e7eb !important;
      cursor: pointer !important;
      padding: 0 !important;
      margin: 0 !important;
      transition: background 0.15s ease, color 0.15s ease !important;
    }
    .fusou-win-btn:hover {
      background: rgba(255, 255, 255, 0.1) !important;
      color: #ffffff !important;
    }
    .fusou-win-btn:active {
      background: rgba(255, 255, 255, 0.15) !important;
    }
    .fusou-win-close:hover {
      background: #ef4444 !important;
      color: #ffffff !important;
    }
    .fusou-win-close:active {
      background: #dc2626 !important;
    }

    /* DaisyUI 5 Matched Popover & Controls */
    #fusou-volume-popover {
      display: none;
      position: absolute !important;
      top: 32px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      width: 176px !important;
      background-color: #1d1c1c !important;
      background-color: oklch(21.6% 0.006 56.043) !important;
      color: #f1f5f9 !important;
      color: oklch(97.807% 0.029 256.847) !important;
      border: 1px solid #27272a !important;
      border-radius: 8px !important;
      padding: 10px !important;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5) !important;
      flex-direction: column !important;
      gap: 8px !important;
      z-index: 2147483647 !important;
      font-family: inherit !important;
    }
    #fusou-vol-slider {
      -webkit-appearance: none !important;
      appearance: none !important;
      width: 100% !important;
      height: 16px !important;
      background: transparent !important;
      cursor: pointer !important;
      margin: 2px 0 !important;
      padding: 0 !important;
      border: none !important;
    }
    #fusou-vol-slider:focus {
      outline: none !important;
    }
    #fusou-vol-slider::-webkit-slider-runnable-track {
      width: 100% !important;
      height: 8px !important;
      background-color: rgba(255, 255, 255, 0.15) !important;
      border-radius: 9999px !important;
    }
    #fusou-vol-slider::-webkit-slider-thumb {
      -webkit-appearance: none !important;
      appearance: none !important;
      width: 16px !important;
      height: 16px !important;
      border-radius: 50% !important;
      background-color: #96C54E !important;
      border: 2px solid #1d1c1c !important;
      margin-top: -4px !important;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4) !important;
      transition: transform 0.1s ease !important;
    }
    #fusou-vol-slider::-webkit-slider-thumb:hover {
      transform: scale(1.1) !important;
    }
    #fusou-mute-btn {
      width: 100% !important;
      height: 24px !important;
      padding: 0 8px !important;
      font-size: 11px !important;
      font-weight: 600 !important;
      border-radius: 8px !important;
      border: 1px solid rgba(255, 255, 255, 0.2) !important;
      background-color: transparent !important;
      color: #f1f5f9 !important;
      cursor: pointer !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      transition: all 0.15s ease !important;
      font-family: inherit !important;
      text-transform: none !important;
      box-sizing: border-box !important;
    }
    #fusou-mute-btn:hover {
      background-color: #f1f5f9 !important;
      color: #1d1c1c !important;
      border-color: #f1f5f9 !important;
    }
    #fusou-mute-btn.is-muted {
      background-color: #ef4444 !important;
      color: #ffffff !important;
      border-color: transparent !important;
    }
    #fusou-mute-btn.is-muted:hover {
      background-color: #dc2626 !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
};

const updateMaximizeIcon = () => {
  const maxBtn = document.getElementById("fusou-win-max-btn");
  const isMax =
    window.outerWidth >= screen.availWidth - 4 &&
    window.outerHeight >= screen.availHeight - 4;
  if (isMax) {
    document.documentElement.classList.add("is-maximized");
  } else {
    document.documentElement.classList.remove("is-maximized");
  }
  if (!maxBtn) return;
  maxBtn.innerHTML = isMax ? RESTORE_SVG : MAXIMIZE_SVG;
  maxBtn.title = isMax ? "Restore" : "Maximize";
};

let isUserDraggingSlider = false;
let volumeDebounceTimer = null;

const updateVolumeUI = (vol, muted) => {
  const volBtnText = document.getElementById("fusou-vol-btn-text");
  const volIcon = document.getElementById("fusou-vol-icon");
  const volVal = document.getElementById("fusou-vol-val");
  const volSlider = document.getElementById("fusou-vol-slider");
  const muteBtn = document.getElementById("fusou-mute-btn");

  if (volBtnText) {
    volBtnText.textContent = muted ? "0%" : `${vol}%`;
  }
  if (volVal) {
    volVal.textContent = muted ? "Muted" : `${vol}%`;
  }
  if (volSlider && !isUserDraggingSlider) {
    volSlider.value = vol;
  }
  if (muteBtn) {
    muteBtn.textContent = muted ? "Unmute" : "Mute Audio";
    if (muted) {
      muteBtn.classList.add("is-muted");
    } else {
      muteBtn.classList.remove("is-muted");
    }
  }
  if (volIcon) {
    if (muted || vol === 0) {
      volIcon.innerHTML = SPEAKER_MUTED_SVG;
    } else if (vol > 50) {
      volIcon.innerHTML = SPEAKER_HIGH_SVG;
    } else {
      volIcon.innerHTML = SPEAKER_LOW_SVG;
    }
  }
};

const ensureWindowFrameElements = () => {
  if (!isTopWindow()) return;
  const parent = document.body || document.documentElement;
  if (!parent) return;

  if (!document.getElementById("fusou-window-frame")) {
    const frame = document.createElement("div");
    frame.id = "fusou-window-frame";
    parent.appendChild(frame);
  }

  if (!document.getElementById("fusou-canvas-bg")) {
    const bg = document.createElement("div");
    bg.id = "fusou-canvas-bg";
    parent.appendChild(bg);
  }
};

const injectTitlebar = () => {
  if (!isTopWindow()) return;
  ensureTitlebarStyles();
  ensureWindowFrameElements();

  if (document.getElementById("fusou-titlebar")) return;
  const parent = document.body || document.documentElement;
  if (!parent) return;

  const titlebar = document.createElement("div");
  titlebar.id = "fusou-titlebar";
  titlebar.setAttribute("data-tauri-drag-region", "");

  titlebar.addEventListener("mousedown", (e) => {
    if (
      e.target.closest("button") ||
      e.target.closest("#fusou-volume-popover") ||
      e.target.closest("input")
    ) {
      return;
    }
    if (e.button === 0) {
      requestNativeShortcut("start-dragging");
    }
  });

  titlebar.addEventListener("dblclick", (e) => {
    if (
      e.target.closest("button") ||
      e.target.closest("#fusou-volume-popover") ||
      e.target.closest("input")
    ) {
      return;
    }
    requestNativeShortcut("toggle-maximize");
    setTimeout(updateMaximizeIcon, 100);
    setTimeout(updateMaximizeIcon, 300);
  });

  // Left: Brand & Logo
  const leftGroup = document.createElement("div");
  leftGroup.setAttribute("data-tauri-drag-region", "");
  leftGroup.style.cssText =
    "display:flex; align-items:center; gap:8px; cursor:default;";
  leftGroup.innerHTML = `${FUSOU_LOGO_SVG}<span data-tauri-drag-region style="font-weight:700; letter-spacing:0.05em; font-size:11px; opacity:0.9;">FUSOU</span>`;

  // Center: Action & utility buttons
  const toolGroup = document.createElement("div");
  toolGroup.className = "fusou-tool-group";

  const screenshotBtn = document.createElement("button");
  screenshotBtn.type = "button";
  screenshotBtn.className = "fusou-tool-btn";
  screenshotBtn.title = "Capture Screenshot (External Window)";
  screenshotBtn.innerHTML = SCREENSHOT_SVG;
  screenshotBtn.onclick = () => {
    screenshotBtn.style.transform = "scale(0.95)";
    setTimeout(() => {
      screenshotBtn.style.transform = "";
    }, 250);
    if (typeof window.__fusouPrepareScreenshot === "function") {
      window.__fusouPrepareScreenshot();
    }
    requestNativeShortcut("screenshot");
  };

  const reloadBtn = document.createElement("button");
  reloadBtn.type = "button";
  reloadBtn.className = "fusou-tool-btn";
  reloadBtn.title = "Reload External Window (F5)";
  reloadBtn.innerHTML = RELOAD_SVG;
  reloadBtn.onclick = () => {
    reloadBtn.style.transform = "rotate(180deg)";
    setTimeout(() => {
      reloadBtn.style.transform = "";
    }, 500);
    requestNativeShortcut("reload");
  };

  // Volume dropdown
  const volumeContainer = document.createElement("div");
  volumeContainer.style.cssText = "position:relative;";

  const volumeBtn = document.createElement("button");
  volumeBtn.type = "button";
  volumeBtn.className = "fusou-tool-btn";
  volumeBtn.title = "Volume Control";
  volumeBtn.innerHTML = `
    <span id="fusou-vol-icon" style="display:inline-flex; align-items:center;">${SPEAKER_HIGH_SVG}</span>
    <span id="fusou-vol-btn-text" style="font-size:10px; width:24px; text-align:right; font-variant-numeric:tabular-nums;">100%</span>
  `;

  const popover = document.createElement("div");
  popover.id = "fusou-volume-popover";
  popover.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:600;">
      <span>Sound Volume</span>
      <span id="fusou-vol-val" style="font-size:10px; opacity:0.7; font-variant-numeric:tabular-nums;">100%</span>
    </div>
    <input id="fusou-vol-slider" type="range" min="0" max="100" value="100" />
    <button id="fusou-mute-btn" type="button">
      Mute Audio
    </button>
  `;

  volumeBtn.onclick = (e) => {
    e.stopPropagation();
    const isOpen = popover.style.display === "flex";
    popover.style.display = isOpen ? "none" : "flex";
    if (isOpen) {
      volumeBtn.classList.remove("fusou-active");
    } else {
      volumeBtn.classList.add("fusou-active");
    }
  };

  document.addEventListener("mousedown", (e) => {
    if (!volumeContainer.contains(e.target)) {
      popover.style.display = "none";
      volumeBtn.classList.remove("fusou-active");
    }
  });

  volumeContainer.appendChild(volumeBtn);
  volumeContainer.appendChild(popover);

  toolGroup.appendChild(screenshotBtn);
  toolGroup.appendChild(reloadBtn);
  toolGroup.appendChild(volumeContainer);

  // Right: Window controls
  const windowControls = document.createElement("div");
  windowControls.className = "fusou-win-controls";

  const minBtn = document.createElement("button");
  minBtn.type = "button";
  minBtn.className = "fusou-win-btn";
  minBtn.title = "Minimize";
  minBtn.innerHTML = MINIMIZE_SVG;
  minBtn.onclick = () => requestNativeShortcut("minimize");

  const maxBtn = document.createElement("button");
  maxBtn.type = "button";
  maxBtn.id = "fusou-win-max-btn";
  maxBtn.className = "fusou-win-btn";
  maxBtn.title = "Maximize";
  maxBtn.innerHTML = MAXIMIZE_SVG;
  maxBtn.onclick = () => {
    requestNativeShortcut("toggle-maximize");
    setTimeout(updateMaximizeIcon, 100);
    setTimeout(updateMaximizeIcon, 300);
  };

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "fusou-win-btn fusou-win-close";
  closeBtn.title = "Close";
  closeBtn.innerHTML = CLOSE_SVG;
  closeBtn.onclick = () => requestNativeShortcut("close");

  windowControls.appendChild(minBtn);
  windowControls.appendChild(maxBtn);
  windowControls.appendChild(closeBtn);

  titlebar.appendChild(leftGroup);
  titlebar.appendChild(toolGroup);
  titlebar.appendChild(windowControls);

  parent.appendChild(titlebar);

  // Initialize and bind volume controls
  setTimeout(() => {
    const slider = document.getElementById("fusou-vol-slider");
    const muteBtn = document.getElementById("fusou-mute-btn");

    const savedVol = localStorage.getItem("fusou-external-volume");
    const savedMuted = localStorage.getItem("fusou-external-muted");
    const initVol = savedVol !== null ? Number(savedVol) : 100;
    const initMuted = savedMuted === "true";

    fusouCurrentVolume = initVol / 100;
    fusouIsMuted = initMuted;
    updateVolumeUI(initVol, initMuted);
    applyVolumeToPage(fusouCurrentVolume, fusouIsMuted);
    requestNativeShortcut(`volume:${fusouCurrentVolume}:${fusouIsMuted}`);

    if (slider) {
      const startDrag = () => {
        isUserDraggingSlider = true;
      };
      const stopDrag = () => {
        if (!isUserDraggingSlider) return;
        isUserDraggingSlider = false;
        const v = Number(slider.value);
        fusouCurrentVolume = v / 100;
        localStorage.setItem("fusou-external-volume", v.toString());
        localStorage.setItem(
          "fusou-external-muted",
          fusouIsMuted ? "true" : "false",
        );
        window.__fusouSetVolume(fusouCurrentVolume, fusouIsMuted);
      };

      slider.addEventListener("mousedown", startDrag);
      slider.addEventListener("touchstart", startDrag, { passive: true });
      window.addEventListener("mouseup", stopDrag);
      window.addEventListener("touchend", stopDrag);

      slider.oninput = (e) => {
        isUserDraggingSlider = true;
        const v = Number(e.target.value);
        fusouCurrentVolume = v / 100;
        if (fusouIsMuted && v > 0) {
          fusouIsMuted = false;
        } else if (v === 0) {
          fusouIsMuted = true;
        }
        localStorage.setItem("fusou-external-volume", v.toString());
        localStorage.setItem(
          "fusou-external-muted",
          fusouIsMuted ? "true" : "false",
        );

        // Immediate visual feedback
        const volBtnText = document.getElementById("fusou-vol-btn-text");
        const volVal = document.getElementById("fusou-vol-val");
        const muteBtn = document.getElementById("fusou-mute-btn");
        const volIcon = document.getElementById("fusou-vol-icon");
        if (volBtnText) volBtnText.textContent = fusouIsMuted ? "0%" : `${v}%`;
        if (volVal) volVal.textContent = fusouIsMuted ? "Muted" : `${v}%`;
        if (muteBtn) {
          muteBtn.textContent = fusouIsMuted ? "Unmute" : "Mute Audio";
          if (fusouIsMuted) {
            muteBtn.classList.add("is-muted");
          } else {
            muteBtn.classList.remove("is-muted");
          }
        }
        if (volIcon) {
          volIcon.innerHTML =
            fusouIsMuted || v === 0
              ? SPEAKER_MUTED_SVG
              : v > 50
                ? SPEAKER_HIGH_SVG
                : SPEAKER_LOW_SVG;
        }

        applyVolumeToPage(fusouCurrentVolume, fusouIsMuted);

        // Debounce IPC calls and broadcasts
        if (volumeDebounceTimer) clearTimeout(volumeDebounceTimer);
        volumeDebounceTimer = setTimeout(() => {
          requestNativeShortcut(`volume:${fusouCurrentVolume}:${fusouIsMuted}`);
          broadcastToAllFrames({
            type: "fusou-set-volume",
            volume: fusouCurrentVolume,
            muted: fusouIsMuted,
          });
        }, 30);
      };

      slider.onchange = () => {
        stopDrag();
      };
    }

    if (muteBtn) {
      muteBtn.onclick = () => {
        fusouIsMuted = !fusouIsMuted;
        localStorage.setItem(
          "fusou-external-muted",
          fusouIsMuted ? "true" : "false",
        );
        window.__fusouSetVolume(fusouCurrentVolume, fusouIsMuted);
      };
    }

    updateMaximizeIcon();
  }, 50);
};

const adjustGameFrameScale = (
  frame = document.getElementById("game_frame"),
) => {
  if (!frame) return;
  const availableWidth = window.innerWidth;
  if (availableWidth <= 0) return;
  const scale = availableWidth / GAME_FRAME_WIDTH;
  frame.style.transform = `scale(${scale}, ${scale})`;
};

let isApplyingLayout = false;

const applyLayout = () => {
  if (!isTopWindow()) return;
  if (isApplyingLayout) return;
  isApplyingLayout = true;
  try {
    injectTitlebar();

    const gameFrame = document.getElementById("game_frame");

    if (!gameFrame) {
      // Non-game page (Login, terms, maintenance): restore natural layout
      if (document.documentElement.classList.contains("fusou-game-mode")) {
        document.documentElement.classList.remove("fusou-game-mode");
      }
      if (document.body && document.body.classList.contains("fusou-game-mode")) {
        document.body.classList.remove("fusou-game-mode");
      }

      // Restore any hidden navigation elements if present
      const rootElement = document.getElementById("root");
      if (rootElement) {
        ["header", "footer", "aside"].forEach((tag) => {
          const element = rootElement.getElementsByTagName(tag)[0];
          if (element && element.style.display === "none") {
            element.style.display = "";
          }
        });

        const ulElements = rootElement.getElementsByTagName("ul");
        for (let i = 0; i < ulElements.length; i++) {
          if (ulElements[i].style.display === "none") {
            ulElements[i].style.display = "";
          }
        }
      }
      return;
    }

    // Game mode page (#game_frame exists)
    if (!document.documentElement.classList.contains("fusou-game-mode")) {
      document.documentElement.classList.add("fusou-game-mode");
    }
    if (document.body && !document.body.classList.contains("fusou-game-mode")) {
      document.body.classList.add("fusou-game-mode");
    }

    // Assign fusou-game-container class to gameFrame parent (matches fusou-app layout)
    const container =
      gameFrame.parentElement &&
      gameFrame.parentElement !== document.body &&
      gameFrame.parentElement !== document.documentElement
        ? gameFrame.parentElement
        : gameFrame;
    if (
      container !== gameFrame &&
      !container.classList.contains("fusou-game-container")
    ) {
      container.classList.add("fusou-game-container");
    }

    // Hide extra DMM outer navigation bars in game mode
    const rootElement = document.getElementById("root");
    if (rootElement) {
      ["header", "footer", "aside"].forEach((tag) => {
        const element = rootElement.getElementsByTagName(tag)[0];
        if (element && element.style.display !== "none") {
          element.style.setProperty("display", "none", "important");
        }
      });

      const ulElements = rootElement.getElementsByTagName("ul");
      for (let i = 0; i < ulElements.length; i++) {
        if (ulElements[i].style.display !== "none") {
          ulElements[i].style.setProperty("display", "none", "important");
        }
      }
    }

    if (gameFrame.style.position !== "absolute") {
      gameFrame.style.position = "absolute";
      gameFrame.style.margin = "0";
      gameFrame.style.padding = "0";
      gameFrame.style.border = "none";
      gameFrame.style.outline = "none";
      gameFrame.style.top = "0";
      gameFrame.style.left = "0";
      gameFrame.style.transformOrigin = "0 0";
      gameFrame.style.width = `${GAME_FRAME_WIDTH}px`;
      gameFrame.style.height = `${GAME_FRAME_HEIGHT}px`;
      gameFrame.setAttribute("scrolling", "no");
    }

    adjustGameFrameScale(gameFrame);
  } finally {
    isApplyingLayout = false;
  }
};

const observer = new MutationObserver(() => {
  if (oldUrl !== location.href) {
    window.dispatchEvent(new CustomEvent("urlChange"));
    oldUrl = location.href;
  }

  applyLayout();
});

const initialize = () => {
  if (!isTopWindow()) return;
  injectTitlebar();
  if (isInitialized || !document.body) return;

  isInitialized = true;
  oldUrl = location.href;

  observer.observe(document.body, {
    subtree: true,
    childList: true,
  });

  applyLayout();
};

if (isTopWindow() && (document.body || document.documentElement)) {
  injectTitlebar();
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}

window.addEventListener("load", initialize);
window.addEventListener("resize", () => {
  if (isTopWindow()) {
    adjustGameFrameScale();
    updateMaximizeIcon();
  }
});
window.addEventListener("scroll", () => {
  if (isTopWindow() && (window.scrollX !== 0 || window.scrollY !== 0)) {
    window.scrollTo(0, 0);
  }
});
window.addEventListener("urlChange", applyLayout);

if (isTopWindow()) {
  const titlebarPersistenceTimer = setInterval(() => {
    injectTitlebar();
  }, 250);
  setTimeout(() => clearInterval(titlebarPersistenceTimer), 15000);
}

const forceRenderRefresh = () => {
  const element = document.body ?? document.documentElement;
  if (!element) return;

  const previousDisplay = element.style.display;
  element.style.display = "none";
  void element.offsetHeight; // Force reflow
  element.style.display = previousDisplay || "";
};

window.__fusouForceRenderRefresh = forceRenderRefresh;

window.__fusouPrepareScreenshot = () => {
  document.documentElement.classList.add("fusou-screenshot-mode");
  if (document.body) {
    document.body.classList.add("fusou-screenshot-mode");
  }
  void document.documentElement.offsetHeight;
  setTimeout(() => {
    document.documentElement.classList.remove("fusou-screenshot-mode");
    if (document.body) {
      document.body.classList.remove("fusou-screenshot-mode");
    }
  }, 1000);
};

window.__fusouFinishScreenshot = () => {
  document.documentElement.classList.remove("fusou-screenshot-mode");
  if (document.body) {
    document.body.classList.remove("fusou-screenshot-mode");
  }
};

const stopKeyEvent = (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }
};

const requestNativeShortcut = (action) => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== "function") {
    console.error("Native shortcut handler is unavailable.");
    return;
  }

  invoke("external_window_shortcut", { action }).catch((error) => {
    console.error(`Failed to handle external ${action} shortcut:`, error);
  });
};

const shortcutActions = [
  {
    id: "reload",
    match: (event) => event.key === "F5",
    run: () => requestNativeShortcut("reload"),
  },
  {
    id: "force-refresh",
    match: (event) => {
      const key = event.key?.toLowerCase();
      return (
        key === "r" &&
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey
      );
    },
    run: () => requestNativeShortcut("force-refresh"),
  },
  {
    id: "screenshot",
    match: (event) => {
      const key = event.key?.toLowerCase();
      return (
        key === "s" &&
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey
      );
    },
    run: () => {
      if (typeof window.__fusouPrepareScreenshot === "function") {
        window.__fusouPrepareScreenshot();
      }
      requestNativeShortcut("screenshot");
    },
  },
];

const onShortcutKeydown = (event) => {
  const action = shortcutActions.find((entry) => entry.match(event));
  if (!action) return;

  stopKeyEvent(event);
  action.run();
};

const bindShortcutHandlers = () => {
  if (areShortcutsBound) return;

  window.addEventListener("keydown", onShortcutKeydown, {
    capture: true,
  });
  areShortcutsBound = true;
};

bindShortcutHandlers();

/* =========================================================================
 * Multi-frame Direct Audio Control (KanColle WebAudio + HTML5 Media + SoundJS)
 * ========================================================================= */

// Set of direct window proxies for all child/nested frames (maintained by top window)
const registeredFusouFrames = new Set();

// KanColle's kcs_cda.js expects event.data to be a string and executes event.data.split("\t")
// Sending raw JavaScript objects will throw TypeError: event.data.split is not a function.
// Therefore, we MUST serialize all fusou cross-frame IPC messages to JSON strings.
const safePostMessage = (targetWindow, payload) => {
  if (!targetWindow || typeof targetWindow.postMessage !== "function") return;
  try {
    const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
    targetWindow.postMessage(serialized, "*");
  } catch (e) {}
};

// Safely postMessage recursively to all reachable frames (including nested cross-origin iframes)
const postMessageRecursive = (win, msg, depth = 0) => {
  if (!win || depth > 6) return;
  safePostMessage(win, msg);

  // Explore sub-frames via WindowProxy array
  try {
    const len = win.frames ? win.frames.length : 0;
    for (let i = 0; i < len; i++) {
      try {
        postMessageRecursive(win.frames[i], msg, depth + 1);
      } catch (e) {}
    }
  } catch (e) {}

  // If same-origin or DOM accessible, also iterate iframe elements
  try {
    if (win.document && typeof win.document.querySelectorAll === "function") {
      const iframes = win.document.querySelectorAll("iframe");
      iframes.forEach((frame) => {
        try {
          if (frame.contentWindow) {
            postMessageRecursive(frame.contentWindow, msg, depth + 1);
          }
        } catch (e) {}
      });
    }
  } catch (e) {}
};

// Broadcast a message to all accessible frames and windows
const broadcastToAllFrames = (msg) => {
  // 1. Direct postMessage to all registered frames (bypasses cross-origin nesting limits)
  registeredFusouFrames.forEach((frameProxy) => {
    try {
      safePostMessage(frameProxy, msg);
    } catch (e) {
      registeredFusouFrames.delete(frameProxy);
    }
  });

  // 2. Full recursive traversal of all frames starting from current window
  postMessageRecursive(window, msg);

  // 3. If in a sub-frame, also request top to broadcast if possible
  if (!isTopWindow() && window.top) {
    safePostMessage(window.top, msg);
  }
};

// Apply volume directly to all audio nodes and media elements in this frame
const applyVolumeToPage = (volume, muted) => {
  if (typeof volume === "number") {
    fusouCurrentVolume = Math.max(0, Math.min(1, volume));
  }
  if (typeof muted === "boolean") {
    fusouIsMuted = muted;
  }
  const effectiveVolume = fusouIsMuted ? 0 : fusouCurrentVolume;

  // 1. KanColle SoundJS / CreateJS volume control
  try {
    if (window.createjs && window.createjs.Sound) {
      let applied = false;

      // Direct property assignment (KanColle kcs2 primary SoundJS volume setter)
      try {
        window.createjs.Sound.volume = effectiveVolume;
        applied = true;
      } catch (e) {}

      // setVolume method if present
      try {
        if (typeof window.createjs.Sound.setVolume === "function") {
          window.createjs.Sound.setVolume(effectiveVolume);
          applied = true;
        }
      } catch (e) {}

      // Mute flags
      try {
        window.createjs.Sound.muted = fusouIsMuted;
      } catch (e) {}
      try {
        if (typeof window.createjs.Sound.setMute === "function") {
          window.createjs.Sound.setMute(fusouIsMuted);
        }
      } catch (e) {}

      // WebAudio plugin gain node
      try {
        if (
          window.createjs.Sound.activePlugin &&
          window.createjs.Sound.activePlugin.gainNode &&
          window.createjs.Sound.activePlugin.gainNode.gain
        ) {
          window.createjs.Sound.activePlugin.gainNode.gain.value = effectiveVolume;
          applied = true;
        }
      } catch (e) {}

      if (applied) {
        console.debug(
          `[FUSOU-AUDIO] SoundJS volume updated: vol=${effectiveVolume}, muted=${fusouIsMuted}`
        );
      }
    }
  } catch (e) {
    console.warn("[FUSOU-AUDIO] SoundJS volume control error:", e);
  }

  // 2. Standard DOM HTMLMediaElements (<audio>, <video>)
  try {
    document.querySelectorAll("audio, video").forEach((el) => {
      try {
        el.volume = effectiveVolume;
        el.muted = fusouIsMuted;
      } catch (_) {}
    });
  } catch (e) {}
};

// Periodic synchronization to catch late-initializing SoundJS in game frames
setInterval(() => {
  applyVolumeToPage(fusouCurrentVolume, fusouIsMuted);
}, 1000);

// Global setter called from external titlebar or Rust evaluation
window.__fusouSetVolume = (volume, muted, fromRust = false) => {
  if (typeof volume === "number") {
    fusouCurrentVolume = Math.max(0, Math.min(1, volume));
  }
  if (typeof muted === "boolean") {
    fusouIsMuted = muted;
  }
  const volPercent = Math.round(fusouCurrentVolume * 100);

  if (isTopWindow()) {
    updateVolumeUI(volPercent, fusouIsMuted);
    // Request Rust to apply native webview engine mute (SetIsMuted) only if NOT called from Rust
    if (!fromRust) {
      requestNativeShortcut(`volume:${fusouCurrentVolume}:${fusouIsMuted}`);
    }
  }

  applyVolumeToPage(fusouCurrentVolume, fusouIsMuted);

  // Broadcast to all frames
  broadcastToAllFrames({
    type: "fusou-set-volume",
    volume: fusouCurrentVolume,
    muted: fusouIsMuted,
  });
};

// Message listener for cross-frame coordination
window.addEventListener("message", (e) => {
  let data = e.data;
  if (typeof data === "string") {
    if (data.includes("fusou-")) {
      try {
        data = JSON.parse(data);
      } catch (_) {
        return;
      }
    } else {
      return;
    }
  }
  if (!data || typeof data !== "object") return;

  // Handle frame registration (Top window records newly created iframes)
  if (data.type === "fusou-register-frame") {
    if (isTopWindow()) {
      if (e.source) {
        registeredFusouFrames.add(e.source);
        // Immediately reply with current volume configuration
        safePostMessage(e.source, {
          type: "fusou-set-volume",
          volume: fusouCurrentVolume,
          muted: fusouIsMuted,
        });
      }
    } else if (window.top && window.top !== window) {
      // Intermediate frames relay registration up towards top window
      safePostMessage(window.top, data);
    }
  }

  // Handle volume query from newly loaded child frames
  if (data.type === "fusou-get-volume") {
    if (e.source) {
      safePostMessage(e.source, {
        type: "fusou-set-volume",
        volume: fusouCurrentVolume,
        muted: fusouIsMuted,
      });
    }
  }

  // Handle volume change broadcast
  if (data.type === "fusou-set-volume") {
    applyVolumeToPage(data.volume, data.muted);

    // If this is an intermediate or top frame, relay downward to all child frames
    try {
      const len = window.frames ? window.frames.length : 0;
      for (let i = 0; i < len; i++) {
        safePostMessage(window.frames[i], data);
      }
    } catch (err) {}
  }
});

// If this is an iframe (e.g. KanColle game_frame or osapi frame), register and query volume
if (!isTopWindow()) {
  const syncWithTop = () => {
    try {
      if (window.top && window.top !== window) {
        safePostMessage(window.top, { type: "fusou-register-frame" });
        safePostMessage(window.top, { type: "fusou-get-volume" });
      }
      if (
        window.parent &&
        window.parent !== window &&
        window.parent !== window.top
      ) {
        safePostMessage(window.parent, { type: "fusou-register-frame" });
        safePostMessage(window.parent, { type: "fusou-get-volume" });
      }
    } catch (e) {}
  };
  syncWithTop();
  const regTimer = setInterval(syncWithTop, 1500);
  setTimeout(() => {
    clearInterval(regTimer);
    setInterval(syncWithTop, 5000);
  }, 30000);
}
})();
