const dmm_login_href = "https://accounts.dmm.com/service/login/password";
const invoke = window.__TAURI__.core.invoke;
let credential_submit_flag = false;

window.addEventListener("DOMContentLoaded", () => {
  observer.observe(window.document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });

  if (window.location.href.startsWith(dmm_login_href)) {
    let login_id_element = document.getElementById("login_id");
    let password_element = document.getElementById("password");
    let form_element = document
      .getElementsByTagName("form")
      .namedItem("loginForm");
    let submit_button_element = form_element?.children?.[4];
    if (login_id_element && password_element && submit_button_element) {
      console.log("DMM login page detected");
      invoke("get_dmm_login_email")
        .then((email) => {
          console.log("Retrieved DMM login email:", email);
          if (email) {
            console.log("Filling DMM login email", email);
            login_id_element.value = email;
          }
        })
        .catch((e) => {
          console.error("Error getting DMM login email:", e);
        });
      invoke("get_dmm_login_password")
        .then((password) => {
          if (password) {
            console.log("Filling DMM login password");
            password_element.value = password;
          }
        })
        .catch((e) => {
          console.error("Error getting DMM login password:", e);
        });
      form_element.addEventListener("submit", () => {
        if (credential_submit_flag) return;
        credential_submit_flag = true;
        invoke("set_dmm_login_email_password", {
          email: login_id_element.value,
          password: password_element.value,
        }).then(() => {
          console.log("DMM login credentials submitted");
        });
      });
    }
  } else {
    let html_element = document.getElementsByTagName("html")[0];
    if (html_element) html_element.setAttribute("style", "overflow: hidden;");

    let dmm_ntgnavi = document.getElementsByClassName("dmm-ntgnavi")[0];
    if (dmm_ntgnavi) dmm_ntgnavi.setAttribute("style", "display: none;");

    let foot = document.getElementById("foot");
    if (foot) foot.setAttribute("style", "display: none;");

    let ntg_recommend = document.getElementById("ntg-recommend");
    if (ntg_recommend) ntg_recommend.setAttribute("style", "display: none;");

    let area_naviapp = document.getElementsByClassName("area-naviapp")[0];
    if (area_naviapp) area_naviapp.setAttribute("style", "display: none;");

    let game_frame = document.getElementById("game_frame");
    if (game_frame) {
      game_frame.setAttribute(
        "style",
        "position: fixed; margin: 0; margin-right: auto; margin-left: auto; top: -24px; left: -8px; transform-origin: 8px 24px;"
      );
      game_frame.style.transform =
        "scale(" +
        window.innerHeight / 712 +
        ", " +
        window.innerHeight / 712 +
        ")";
    }
  }
});

window.addEventListener("resize", () => {
  let game_frame = document.getElementById("game_frame");
  if (game_frame)
    game_frame.style.transform =
      "scale(" +
      window.innerHeight / 712 +
      ", " +
      window.innerHeight / 712 +
      ")";
});

window.addEventListener("contextmenu", async (e) => {
  e.preventDefault();
});

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
