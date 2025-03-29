import { JSX } from "solid-js";

export function IconChevronDoubleLeft(
  props: JSX.HTMLAttributes<SVGSVGElement>,
) {
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
        d="M8.354 1.646a0.5 0.5 0 0 1 0 0.708L2.707 8l5.647 5.646a0.5 0.5 0 0 1 -0.708 0.708l-6 -6a0.5 0.5 0 0 1 0 -0.708l6 -6a0.5 0.5 0 0 1 0.708 0"
      />
      <path
        fill-rule="evenodd"
        d="M12.354 1.646a0.5 0.5 0 0 1 0 0.708L6.707 8l5.647 5.646a0.5 0.5 0 0 1 -0.708 0.708l-6 -6a0.5 0.5 0 0 1 0 -0.708l6 -6a0.5 0.5 0 0 1 0.708 0"
      />
    </svg>
  );
}
export default IconChevronDoubleLeft;
