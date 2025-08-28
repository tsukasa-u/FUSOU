import type { JSX } from "solid-js";

export function IconChevronRight(props: JSX.HTMLAttributes<SVGSVGElement>) {
  return (
    <svg
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      stroke-width="0"
      stroke="currentColor"
      viewBox="0 0 16 16"
      {...props}
    >
      <path
        fill-rule="evenodd"
        d="M4.646 1.646a0.5 0.5 0 0 1 0.708 0l6 6a0.5 0.5 0 0 1 0 0.708l-6 6a0.5 0.5 0 0 1 -0.708 -0.708L10.293 8 4.646 2.354a0.5 0.5 0 0 1 0 -0.708"
      />
    </svg>
  );
}
export default IconChevronRight;
