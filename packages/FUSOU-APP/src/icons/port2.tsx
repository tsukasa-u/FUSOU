import type { JSX } from "solid-js";

export function IconPort2(props: JSX.HTMLAttributes<SVGSVGElement>) {
  return (
    <svg
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      stroke-width="15"
      stroke="currentColor"
      viewBox="0 0 250 250"
      {...props}
    >
      <path d="M 125 72 V 225 M 39 185 Q 125 260 211 185 M 38 211 V 184 H 65 M 212 211 V 184 H 185" />
      <line
        stroke="currentColor"
        stroke-width="15"
        x1="93"
        y1="87"
        x2="157"
        y2="87"
      />
      <circle
        fill="none"
        stroke="currentColor"
        stroke-width="15"
        cx="125"
        cy="47"
        r="25"
      />
    </svg>
  );
}
export default IconPort2;
