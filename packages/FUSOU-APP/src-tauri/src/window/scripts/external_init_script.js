window.addEventListener("load", () => {
  observer.observe(window.document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });

  let html_element = document.getElementsByTagName("html")[0];
  if (html_element) html_element.setAttribute("style", "overflow: hidden;");

  let header = document.getElementsByTagName("header")[0];
  console.log("header:", header);
  if (header) header.setAttribute("style", "display: none;");

  let footer = document.getElementsByTagName("footer")[0];
  console.log("footer:", footer);
  if (footer) footer.setAttribute("style", "display: none;");

  let aside = document.getElementsByTagName("aside")[0];
  console.log("aside:", aside);
  if (aside) aside.setAttribute("style", "display: none;");

  let game_frame = document.getElementById("game_frame");
  const game_frame_height = 720;
  const game_frame_width = 1200;
  if (game_frame) {
    game_frame.setAttribute(
      "style",
      `position: fixed; margin: 0px 0px; top: 0px; left: 0px; transform-origin: 0px 0px; transform: scale(1.12083, 1.12083); width: ${game_frame_width}px;`
    );
    game_frame.style.transform =
      "scale(" +
      window.innerHeight / game_frame_height +
      ", " +
      window.innerHeight / game_frame_height +
      ")";
  }
});

window.addEventListener("resize", () => {
  let game_frame = document.getElementById("game_frame");
  const game_frame_height = 720;
  // const game_frame_width = 1200;
  if (game_frame)
    game_frame.style.transform =
      "scale(" +
      window.innerHeight / game_frame_height +
      ", " +
      window.innerHeight / game_frame_height +
      ")";
});

// window.addEventListener("contextmenu", async (e) => {
//     e.preventDefault();
// });

let oldUrl = "";

const observer = new MutationObserver(() => {
  if (oldUrl !== location.href) {
    window.dispatchEvent(new CustomEvent("urlChange"));
    oldUrl = location.href;
  }
});

window.addEventListener("urlChange", () => {
  console.log("URL changed", location.href);
});

window.addEventListener("keydown", function (event) {
  if (event.code === "F5") {
    window.location.reload();
  }
});
