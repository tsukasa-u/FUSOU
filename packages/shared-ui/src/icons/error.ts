import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeCSS } from "lit";
import globalStyles from "../global.css?inline";

export interface IconErrorProps {
  size?: "full" | "none" | "xs" | "sm" | "md" | "lg" | "xl";
  ratio?: number;
}

const class_size = {
  xs: "h-6",
  sm: "h-[27px]",
  md: "h-[30px]",
  lg: "h-[35px]",
  xl: "h-11",
  full: "h-full",
  none: "",
};

@customElement("icon-error")
export class IconError extends LitElement {
  static styles = [unsafeCSS(globalStyles)];

  @property({ type: String })
  size: keyof typeof class_size = "xs";

  @property({ type: Number })
  ratio: number = 1.0;

  render() {
    return html`<svg
      fill="currentColor"
      stroke="currentColor"
      viewBox=${`0 0 ${this.ratio * 96} 96`}
      xmlns="http://www.w3.org/2000/svg"
      xmlns:xlink="http://www.w3.org/1999/xlink"
      overflow="hidden"
      class=${[
        "text-error",
        "fill-error-content",
        "cursor-inherit",
        class_size[this.size],
      ].join(" ")}
    >
      <g style=${`transform: translateX(${(this.ratio - 1.0) * 48}px);`}>
        <path
          d="M43.5001 76.0001C43.5001 73.5148 45.7386 71.5001 48.5001 71.5001 51.2615 71.5001 53.5001 73.5148 53.5001 76.0001 53.5001 78.4853 51.2615 80.5001 48.5001 80.5001 45.7386 80.5001 43.5001 78.4853 43.5001 76.0001Z"
          stroke-width="3"
          stroke-miterlimit="8"
          fill-rule="evenodd"
          class=${["text-error", "fill-error"].join(" ")}
        />
        <path
          d="M43.5001 22.7292C43.5001 20.9458 44.9458 19.5001 46.7292 19.5001L50.2709 19.5001C52.0543 19.5001 53.5001 20.9458 53.5001 22.7292L53.5001 55.2709C53.5001 57.0543 52.0543 58.5001 50.2709 58.5001L46.7292 58.5001C44.9458 58.5001 43.5001 57.0543 43.5001 55.2709Z"
          stroke-width="3"
          stroke-miterlimit="8"
          fill-rule="evenodd"
          class=${["text-error", "fill-error"].join(" ")}
        />
      </g>
    </svg>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "icon-error": IconError;
  }
}
