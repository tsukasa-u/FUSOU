import type { JSX } from "solid-js";

export function IconDashSquare(props: JSX.HTMLAttributes<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      // fill="none"
      //   stroke-width="1.5"
      //   stroke="currentColor"
      viewBox="0 0 16 16"
      {...props}
    >
      <path d="M3.5 2a1.5 1.5 90 00-1.5 1.5v9a1.5 1.5 90 001.5 1.5h9a1.5 1.5 90 001.5-1.5V3.5a1.5 1.5 90 00-1.5-1.5H3.5zm1.875 5.625h5.25a.375.375 90 010 .75h-5.25a.375.375 90 010-.75z" />
    </svg>
  );
}
export default IconDashSquare;
