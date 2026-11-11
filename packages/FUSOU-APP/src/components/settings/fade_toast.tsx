import type { JSX } from "solid-js";
import { splitProps } from "solid-js";
import { ALERT_ICON_PATHS, ALERT_VARIANT_CLASSES, type AlertType } from "ui";

import "../../css/fade_toast.css";

interface FadeToastProps {
  toast_id: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const CLOSE_ICON_PATH = "M6 18 18 6M6 6l12 12";

function createSvgIcon(pathData: string, classes: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("fill", "none");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const cls of classes.split(" ")) {
    if (cls) svg.classList.add(cls);
  }

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("d", pathData);
  svg.appendChild(path);
  return svg;
}

export const showFadeToast = function (
  id: string,
  message: string,
  type: AlertType = "info",
) {
  const toast = document.getElementById(id);
  if (!toast) return;

  const variant = ALERT_VARIANT_CLASSES[type];
  const messageContainer = document.createElement("div");
  messageContainer.setAttribute(
    "role",
    type === "error" || type === "warning" ? "alert" : "status",
  );
  messageContainer.className = `alert ${variant.alert} flex items-center justify-between gap-3 min-w-64 max-w-sm py-2.5 px-3.5 shadow-sm`;
  messageContainer.id = "fade_toast_message" + self.crypto.randomUUID();
  messageContainer.style.display = "none";

  const content = document.createElement("div");
  content.className = "flex items-center gap-2.5 min-w-0";

  const statusIcon = createSvgIcon(
    ALERT_ICON_PATHS[type],
    `w-5 h-5 shrink-0 stroke-current ${variant.text}`,
  );

  const textNode = document.createElement("span");
  textNode.className = "text-sm leading-snug break-words";
  textNode.textContent = message;

  content.appendChild(statusIcon);
  content.appendChild(textNode);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Dismiss notification");
  closeButton.className =
    "btn btn-ghost btn-xs btn-square shrink-0 text-base-content/60 hover:text-base-content";
  closeButton.appendChild(
    createSvgIcon(CLOSE_ICON_PATH, "w-4 h-4 stroke-current"),
  );
  closeButton.onclick = hideFadeToast.bind(null, messageContainer.id);

  messageContainer.appendChild(content);
  messageContainer.appendChild(closeButton);

  toast.prepend(messageContainer);

  const containerRef = document.getElementById(messageContainer.id);
  if (!containerRef) return;

  containerRef.style.display = "flex";
  containerRef.classList.add("fadein");

  new Promise<void>((resolve) => {
    setTimeout(() => {
      containerRef.classList.remove("fadein");
      resolve();
    }, 500);
  })
    .then(() => {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          if (!containerRef.isConnected) {
            resolve();
            return;
          }
          containerRef.classList.add("fadeout");
          resolve();
        }, 3000);
      });
    })
    .then(() => {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          containerRef.classList.remove("fadeout");
          containerRef.style.display = "none";
          containerRef.remove();
          resolve();
        }, 500);
      });
    });
};

export const hideFadeToast = function (id: string) {
  const newMessage = document.getElementById(id);
  if (newMessage) {
    if (newMessage.style.display === "none") return;
    newMessage.classList.add("fadeout");
    setTimeout(() => {
      newMessage.classList.remove("fadeout");
      newMessage.style.display = "none";
      newMessage.remove();
    }, 500);
  }
};

export function FadeToast(
  props: FadeToastProps & JSX.HTMLAttributes<HTMLDivElement>,
) {
  const [local, others] = splitProps(props, ["toast_id", "class"]);

  return (
    <div
      class={`toast toast-end toast-bottom z-50 ${local.class ?? ""}`.trim()}
      {...others}
    >
      <div class="flex flex-col items-end gap-2" id={local.toast_id} />
    </div>
  );
}
