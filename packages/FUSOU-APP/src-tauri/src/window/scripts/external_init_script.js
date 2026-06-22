const GAME_FRAME_HEIGHT = 720;
const GAME_FRAME_WIDTH = 1200;
let oldUrl = "";
let isInitialized = false;
let areShortcutsBound = false;

const adjustGameFrameScale = (
  frame = document.getElementById("game_frame")
) => {
  if (!frame) return;
  const scale = window.innerHeight / GAME_FRAME_HEIGHT;
  frame.style.transform = `scale(${scale}, ${scale})`;
};

const applyLayout = () => {
  const htmlElement = document.documentElement;
  if (htmlElement) {
    htmlElement.style.setProperty("overflow", "hidden", "important");
  }

  const rootElement = document.getElementById("root");
  if (rootElement) {
    ["header", "footer", "aside"].forEach((tag) => {
      const element = rootElement.getElementsByTagName(tag)[0];
      if (element) {
        element.style.setProperty("display", "none", "important");
      }
    });

    const ulElements = rootElement.getElementsByTagName("ul");
    for (let i = 0; i < ulElements.length; i++) {
      ulElements[i].style.setProperty("display", "none", "important");
    }
  }

  const gameFrame = document.getElementById("game_frame");
  if (!gameFrame) return;

  gameFrame.style.position = "fixed";
  gameFrame.style.margin = "0";
  gameFrame.style.top = "0";
  gameFrame.style.left = "0";
  gameFrame.style.transformOrigin = "0 0";
  gameFrame.style.width = `${GAME_FRAME_WIDTH}px`;

  adjustGameFrameScale(gameFrame);
};

const observer = new MutationObserver(() => {
  if (oldUrl !== location.href) {
    window.dispatchEvent(new CustomEvent("urlChange"));
    oldUrl = location.href;
  }

  applyLayout();
});

const initialize = () => {
  if (isInitialized || !document.body) return;

  isInitialized = true;
  oldUrl = location.href;

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });

  applyLayout();
};

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}

window.addEventListener("load", initialize);
window.addEventListener("resize", () => adjustGameFrameScale());
window.addEventListener("urlChange", applyLayout);

const forceRenderRefresh = () => {
  const element = document.body ?? document.documentElement;
  if (!element) return;

  const previousDisplay = element.style.display;
  element.style.display = "none";
  void element.offsetHeight; // Force reflow
  element.style.display = previousDisplay || "";
};

window.__fusouForceRenderRefresh = forceRenderRefresh;

const stopKeyEvent = (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }
};

const shortcutActions = [
  {
    id: "reload",
    match: (event) => event.key === "F5" && !event.ctrlKey && !event.metaKey,
    run: () => {
      window.location.reload();
    },
  },
  {
    id: "force-refresh",
    match: (event) => {
      const key = event.key?.toLowerCase();
      return key === "r" && (event.ctrlKey || event.metaKey);
    },
    run: forceRenderRefresh,
  },
  {
    id: "screenshot",
    match: (event) => {
      const key = event.key?.toLowerCase();
      return key === "s" && (event.ctrlKey || event.metaKey);
    },
    run: () => {
      // Native shortcut handler captures the screenshot.
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
