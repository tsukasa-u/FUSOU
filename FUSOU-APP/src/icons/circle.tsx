import { JSX } from "solid-js";

export function IconCircle(props: JSX.HTMLAttributes<SVGSVGElement>) {
  return (
    <svg
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      stroke-width="1.5"
      stroke="currentColor"
      viewBox="0 0 32 32"
      {...props}
    >
      <circle fill="none" cx="16" cy="16" r="12" />
      <circle fill="currentColor" cx="16" cy="16" r="8" />
    </svg>
  );
}
export default IconCircle;
