import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeCSS } from "lit";
import globalStyles from "../global.css?inline";
import { ifDefined } from "lit/directives/if-defined.js";
export interface IconKiraProps {
  kira_type: number;
  size?: "full" | "none" | "xs" | "sm" | "md" | "lg" | "xl";
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

@customElement("icon-kira")
export class IconKira extends LitElement {
  static styles = [unsafeCSS(globalStyles)];

  @property({ type: Number })
  kira_type = 1;

  @property({ type: String })
  size: keyof typeof class_size = "xs";

  render() {
    if (this.kira_type == 1) {
      return html`<svg
        fill="#f0e040"
        stroke-width="16"
        stroke="currentColor"
        viewBox="-8 -8 528 528"
        xmlns="http://www.w3.org/2000/svg"
        xmlns:xlink="http://www.w3.org/1999/xlink"
        overflow="hidden"
        class=${["stroke-base-content", class_size[this.size]].join(" ")}
      >
        <g>
          <path
            d="M495.469,241.969c-113.594,0-152.875-28.5-174.906-50.531c-22.031-22.125-50.578-61.344-50.578-174.922 c0-4.328-0.453-16.516-14.016-16.516C242.531,0,242,12.188,242,16.516c0,113.578-28.563,152.797-50.594,174.922 c-22.094,22.031-61.375,50.531-174.906,50.531c-4.344,0-16.5,0.5-16.5,14.047c0,13.453,12.156,13.938,16.5,13.938 c113.531,0,152.813,28.578,174.906,50.625C213.438,342.625,242,381.922,242,495.5c0,4.344,0.531,16.5,13.969,16.5 c13.563,0,14.016-12.156,14.016-16.5c0-113.578,28.547-152.875,50.578-174.922c22.031-22.078,61.313-50.625,174.906-50.625 c4.328,0,16.531-0.422,16.531-13.984C512,242.516,499.797,241.969,495.469,241.969z"
          />
        </g>
      </svg>`;
    } else if (this.kira_type == 2) {
      return html`<svg
        fill="#f0e040"
        stroke-width="16"
        stroke="currentColor"
        viewBox="-8 -8 528 528"
        xmlns="http://www.w3.org/2000/svg"
        xmlns:xlink="http://www.w3.org/1999/xlink"
        overflow="hidden"
        class=${["stroke-base-content", class_size[this.size]].join(" ")}
      >
        <g>
          <path
            d="M494.696,155.436l-75.664-19.918c-24.946-6.56-44.421-26.036-50.982-50.963L348.142,8.892 C346.769,3.647,342.032,0,336.618,0c-5.424,0-10.161,3.647-11.542,8.892l-19.908,75.664c-6.56,24.927-26.036,44.402-50.982,50.963 l-75.664,19.918c-5.245,1.381-8.892,6.109-8.892,11.533c0,5.424,3.647,10.151,8.892,11.534l75.664,19.917 c24.946,6.552,44.422,26.036,50.982,50.963l19.908,75.665c1.381,5.245,6.119,8.892,11.542,8.892c5.414,0,10.151-3.647,11.524-8.892 l19.907-75.665c6.561-24.927,26.036-44.411,50.982-50.963l75.664-19.917c5.244-1.382,8.892-6.11,8.892-11.534 C503.587,161.546,499.94,156.818,494.696,155.436z"
          />
          <path
            d="M207.001,402.949l-46.226-12.163c-15.236-4.004-27.136-15.904-31.14-31.13l-12.172-46.226 c-0.837-3.215-3.723-5.432-7.041-5.432c-3.308,0-6.203,2.218-7.04,5.432l-12.163,46.226c-4.014,15.226-15.913,27.126-31.149,31.13 l-46.226,12.163c-3.196,0.846-5.432,3.741-5.432,7.049c0,3.309,2.237,6.204,5.432,7.049l46.226,12.163 c15.236,4.004,27.136,15.904,31.149,31.131l12.163,46.226c0.836,3.215,3.732,5.433,7.04,5.433c3.318,0,6.204-2.218,7.041-5.433 l12.172-46.226c4.004-15.227,15.904-27.127,31.14-31.131l46.226-12.163c3.196-0.845,5.432-3.74,5.432-7.049 C212.434,406.69,210.197,403.795,207.001,402.949z"
          />
        </g>
      </svg>`;
    } else if (this.kira_type == 3) {
      return html`<svg
        fill="#f0e040"
        stroke-width="16"
        stroke="currentColor"
        viewBox="-8 -8 528 528"
        xmlns="http://www.w3.org/2000/svg"
        xmlns:xlink="http://www.w3.org/1999/xlink"
        overflow="hidden"
        class=${["stroke-base-content", class_size[this.size]].join(" ")}
      >
        <g>
          <path
            d="M247.355,106.9C222.705,82.241,205.833,39.18,197.46,0c-8.386,39.188-25.24,82.258-49.899,106.917 c-24.65,24.642-67.724,41.514-106.896,49.904c39.188,8.373,82.254,25.235,106.904,49.895c24.65,24.65,41.522,67.72,49.908,106.9 c8.373-39.188,25.24-82.258,49.886-106.917c24.65-24.65,67.724-41.514,106.896-49.904 C315.08,148.422,272.014,131.551,247.355,106.9z"
          />
          <path
            d="M407.471,304.339c-14.714-14.721-24.81-40.46-29.812-63.864c-5.011,23.404-15.073,49.142-29.803,63.872 c-14.73,14.714-40.464,24.801-63.864,29.812c23.408,5.01,49.134,15.081,63.864,29.811c14.73,14.722,24.81,40.46,29.82,63.864 c5.001-23.413,15.081-49.142,29.802-63.872c14.722-14.722,40.46-24.802,63.856-29.82 C447.939,329.14,422.201,319.061,407.471,304.339z"
          />
          <path
            d="M146.352,354.702c-4.207,19.648-12.655,41.263-25.019,53.626c-12.362,12.354-33.968,20.82-53.613,25.027 c19.645,4.216,41.251,12.656,53.613,25.027c12.364,12.362,20.829,33.96,25.036,53.618c4.203-19.658,12.655-41.255,25.023-53.626 c12.354-12.362,33.964-20.82,53.605-25.035c-19.64-4.2-41.251-12.656-53.613-25.019 C159.024,395.966,150.555,374.351,146.352,354.702z"
          />
        </g>
      </svg>`;
    }

    return html``;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "icon-kira": IconKira;
  }
}

export const IconKiraBasic = (args: IconKiraProps) => {
  return html`<icon-kira
    kira_type=${args.kira_type}
    size=${ifDefined(args.size)}
  ></icon-kira>`;
};

export const IconKiraCatalog = () => {
  return html`<div class="grid gap-4">
    <div class="flex">
      <h1 class="w-20">kira_type:1</h1>
      <icon-kira kira_type=${1} size=${"sm"}></icon-kira>
    </div>
    <div class="flex">
      <h1 class="w-20">kira_type:2</h1>
      <icon-kira kira_type=${2} size=${"sm"}></icon-kira>
    </div>
    <div class="flex">
      <h1 class="w-20">kira_type:3</h1>
      <icon-kira kira_type=${3} size=${"sm"}></icon-kira>
    </div>
  </div>`;
};
