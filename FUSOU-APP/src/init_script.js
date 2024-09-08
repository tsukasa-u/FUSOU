window.addEventListener("DOMContentLoaded", (event) => {
    document.getElementsByTagName("html")[0].setAttribute("style", "overflow: hidden;");

    document.getElementsByClassName("dmm-ntgnavi")[0].setAttribute("style", "display: none;");
    document.getElementById("foot").setAttribute("style", "display: none;");
    document.getElementById("ntg-recommend").setAttribute("style", "display: none;");
    document.getElementsByClassName("area-naviapp")[0].setAttribute("style", "display: none;");
    
    document.getElementById("game_frame").setAttribute("style", "position: fixed; margin: 0; margin-right: auto; margin-left: auto; top: -24px; left: -8px; transform-origin: 8px 24px;");
    document.getElementById("game_frame").style.transform = "scale(" + window.innerHeight/712 + ", " + window.innerHeight/712 + ")";

});

window.addEventListener("resize", (event) => {
    document.getElementById("game_frame").style.transform = "scale(" + window.innerHeight/712 + ", " + window.innerHeight/712 + ")";
});


window.addEventListener("contextmenu", async (e) => {
    e.preventDefault();
});