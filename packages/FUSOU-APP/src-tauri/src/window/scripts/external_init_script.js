const GAME_FRAME_HEIGHT = 720;
const GAME_FRAME_WIDTH = 1200;
let oldUrl = "";
let isInitialized = false;

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

  ["header", "footer", "aside"].forEach((tag) => {
    const element = document.getElementsByTagName(tag)[0];
    if (element) {
      element.style.setProperty("display", "none", "important");
    }
  });

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

// ...existing code...
window.addEventListener("keydown", function (event) {
  if (event.code === "F5") {
    window.location.reload();
  }
});
