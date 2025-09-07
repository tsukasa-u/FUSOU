window.addEventListener("DOMContentLoaded", (event) => {
    
    observer.observe(window.document.body, {
        subtree: true,
        childList: true, 
        attributes: true,
        characterData: true
    });

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
        game_frame.setAttribute("style", "position: fixed; margin: 0; margin-right: auto; margin-left: auto; top: -24px; left: -8px; transform-origin: 8px 24px;");
        game_frame.style.transform = "scale(" + window.innerHeight/712 + ", " + window.innerHeight/712 + ")";
    }
});

window.addEventListener("resize", (event) => {
    
    let game_frame = document.getElementById("game_frame");
    if (game_frame) game_frame.style.transform = "scale(" + window.innerHeight/712 + ", " + window.innerHeight/712 + ")";
});


window.addEventListener("contextmenu", async (e) => {
    e.preventDefault();
});

let oldUrl = '';

const observer = new MutationObserver(() => {
    if(oldUrl !== location.href) {
        window.dispatchEvent(new CustomEvent('urlChange'));
        oldUrl = location.href;
   }
});

window.addEventListener('urlChange', () => {
    console.log('URL changed', location.href);
});

window.addEventListener('keydown', function(event) {
  if (event.code === 'F5') {
    if (event.shiftKey) {
        let ua = window.navigator.userAgent.toLowerCase();
        if(ua.indexOf("firefox") !== -1 || ua.indexOf("fxios") !== -1) {
            window.location.reload(forceGet=true);
        } else {
            window.location.reload();
        }
    } else {
        window.location.reload();
    }
  }
});