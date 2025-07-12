import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeCSS } from "lit";
import globalStyles from "../global.css?inline";
import { ifDefined } from "lit/directives/if-defined.js";

export interface IconPlaneProficiencyProps {
  level: number;
  size?: "full" | "none" | "xs" | "sm" | "md" | "lg" | "xl";
}

const class_size = {
  xs: "h-6",
  sm: "h-8",
  md: "h-12",
  lg: "h-20",
  xl: "h-36",
  full: "h-full",
  none: "",
};

@customElement("icon-plane-proficiency")
export class IconPlaneProficiency extends LitElement {
  static styles = [unsafeCSS(globalStyles)];

  @property({ type: Number })
  level = 0;

  @property({ type: String })
  size: keyof typeof class_size = "xs";

  render() {
    if (this.level == 1) {
      return html`<svg
        fill="#f0e040"
        stroke-width="4"
        stroke="currentColor"
        viewBox="0 0 378 378"
        xmlns="http://www.w3.org/2000/svg"
        xmlns:xlink="http://www.w3.org/1999/xlink"
        overflow="hidden"
        class=${["stroke-base-content", class_size[this.size]].join(" ")}
      >
        <g>
          <rect
            x="38"
            y="38"
            width="75"
            height="302"
            stroke-miterlimit="8"
            fill="none"
          />
          <rect
            x="151"
            y="38"
            width="76"
            height="302"
            stroke-miterlimit="8"
            fill="none"
          />
          <rect
            x="262"
            y="38"
            width="76"
            height="302"
            stroke-miterlimit="8"
            fill="#9DC3E6"
          />
        </g>
      </svg>`;
    } else if (this.level == 2) {
      return html`<svg
        stroke-width="4"
        stroke="currentColor"
        viewBox="0 0 378 378"
        xmlns="http://www.w3.org/2000/svg"
        xmlns:xlink="http://www.w3.org/1999/xlink"
        overflow="hidden"
        class=${["stroke-base-content", class_size[this.size]].join(" ")}
      >
        <g>
          <rect
            x="38"
            y="38"
            width="75"
            height="302"
            stroke-miterlimit="8"
            fill="none"
          />
          <rect
            x="151"
            y="38"
            width="76"
            height="302"
            stroke-miterlimit="8"
            fill="#9DC3E6"
          />
          <rect
            x="262"
            y="38"
            width="76"
            height="302"
            stroke-miterlimit="8"
            fill="#9DC3E6"
          />
        </g>
      </svg>`;
    } else if (this.level == 3) {
      return html`<svg
        stroke-width="4"
        stroke="currentColor"
        viewBox="0 0 378 378"
        xmlns="http://www.w3.org/2000/svg"
        xmlns:xlink="http://www.w3.org/1999/xlink"
        overflow="hidden"
        class=${["stroke-base-content", class_size[this.size]].join(" ")}
      >
        <g>
          <rect
            x="38"
            y="38"
            width="75"
            height="302"
            stroke-miterlimit="8"
            fill="#9DC3E6"
          />
          <rect
            x="151"
            y="38"
            width="76"
            height="302"
            stroke-miterlimit="8"
            fill="#9DC3E6"
          />
          <rect
            x="262"
            y="38"
            width="76"
            height="302"
            stroke-miterlimit="8"
            fill="#9DC3E6"
          />
        </g>
      </svg>`;
    } else if (this.level == 4) {
      return html`<svg
        stroke-width="4"
        stroke="currentColor"
        viewBox="0 0 378 378"
        xmlns="http://www.w3.org/2000/svg"
        xmlns:xlink="http://www.w3.org/1999/xlink"
        overflow="hidden"
        class=${["stroke-base-content", class_size[this.size]].join(" ")}
      >
        <g>
          <path
            d="M0 302 28.25 0 114 0 84.75 302Z"
            stroke-miterlimit="8"
            fill="none"
            fill-rule="evenodd"
            transform="matrix(-1 0 0 1 246 38)"
          />
          <path
            d="M0 302 28.25 0 113 0 84.75 302Z"
            stroke-miterlimit="8"
            fill="none"
            fill-rule="evenodd"
            transform="matrix(-1 0 0 1 132 38)"
          />
          <path
            d="M0 302 28.25 0 113 0 84.75 302Z"
            stroke-miterlimit="8"
            fill="#FFD966"
            fill-rule="evenodd"
            transform="matrix(-1 0 0 1 359 38)"
          />
        </g>
      </svg>`;
    } else if (this.level == 5) {
      return html`<svg
        stroke-width="4"
        stroke="currentColor"
        viewBox="0 0 378 378"
        xmlns="http://www.w3.org/2000/svg"
        xmlns:xlink="http://www.w3.org/1999/xlink"
        overflow="hidden"
        class=${["stroke-base-content", class_size[this.size]].join(" ")}
      >
        <g>
          <path
            d="M0 302 28.25 0 114 0 84.75 302Z"
            stroke-miterlimit="8"
            fill="none"
            fill-rule="evenodd"
            transform="matrix(-1 0 0 1 246 38)"
          />
          <path
            d="M0 302 28.25 0 113 0 84.75 302Z"
            stroke-miterlimit="8"
            fill="#FFD966"
            fill-rule="evenodd"
            transform="matrix(-1 0 0 1 132 38)"
          />
          <path
            d="M0 302 28.25 0 113 0 84.75 302Z"
            stroke-miterlimit="8"
            fill="#FFD966"
            fill-rule="evenodd"
            transform="matrix(-1 0 0 1 359 38)"
          />
        </g>
      </svg>`;
    } else if (this.level == 6) {
      return html`<svg
        stroke-width="4"
        stroke="currentColor"
        viewBox="0 0 378 378"
        xmlns="http://www.w3.org/2000/svg"
        xmlns:xlink="http://www.w3.org/1999/xlink"
        overflow="hidden"
        class=${["stroke-base-content", class_size[this.size]].join(" ")}
      >
        <g>
          <path
            d="M0 302 28.25 0 114 0 84.75 302Z"
            stroke-miterlimit="8"
            fill="#FFD966"
            fill-rule="evenodd"
            transform="matrix(-1 0 0 1 246 38)"
          />
          <path
            d="M0 302 28.25 0 113 0 84.75 302Z"
            stroke-miterlimit="8"
            fill="#FFD966"
            fill-rule="evenodd"
            transform="matrix(-1 0 0 1 132 38)"
          />
          <path
            d="M0 302 28.25 0 113 0 84.75 302Z"
            stroke-miterlimit="8"
            fill="#FFD966"
            fill-rule="evenodd"
            transform="matrix(-1 0 0 1 359 38)"
          />
        </g>
      </svg>`;
    } else if (this.level == 7) {
      return html`<svg
        stroke-width="4"
        stroke="currentColor"
        viewBox="0 0 378 378"
        xmlns="http://www.w3.org/2000/svg"
        xmlns:xlink="http://www.w3.org/1999/xlink"
        overflow="hidden"
        class=${["stroke-base-content", class_size[this.size]].join(" ")}
      >
        <g>
          <path
            d="M38 38 113.5 38 189 189 113.5 340 38 340 113.5 189Z"
            stroke-miterlimit="8"
            fill="#FFD966"
            fill-rule="evenodd"
          />
          <path
            d="M189 38 264.5 38 340 189 264.5 340 189 340 264.5 189Z"
            stroke-miterlimit="8"
            fill="#FFD966"
            fill-rule="evenodd"
          />
        </g>
      </svg>`;
    }

    return html``;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "icon-plane-proficiency": IconPlaneProficiency;
  }
}

export const IconPlaneProficiencyBasic = (args: IconPlaneProficiencyProps) => {
  return html`<icon-plane-proficiency
    level=${args.level}
    size=${ifDefined(args.size)}
  ></icon-plane-proficiency>`;
};

export const IconPlaneProficiencyCatalog = () => {
  const level_list = [1, 2, 3, 4, 5, 6, 7];
  return html`<div class="grid gap-4">
    ${level_list.map(
      (level) =>
        html` <div class="flex">
          <h1 class="w-20">${level}</h1>
          <icon-plane-proficiency
            level=${level}
            size=${"sm"}
          ></icon-plane-proficiency>
        </div>`
    )}
  </div>`;
};
