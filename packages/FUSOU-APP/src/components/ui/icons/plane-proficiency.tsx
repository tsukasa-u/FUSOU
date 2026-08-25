import { Component, Match, Switch } from "solid-js";

export interface IconPlaneProficiencyProps {
  level: number;
  size?: "full" | "none" | "xs" | "sm" | "md" | "lg" | "xl";
  class?: string;
  classList?: any;
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

export const IconPlaneProficiency: Component<IconPlaneProficiencyProps> = (props) => {
  const size = () => props.size ?? "xs";

  return (
    <Switch fallback={<></>}>
      <Match when={props.level == 1}>
        <svg
          fill="#f0e040"
          stroke-width="4"
          stroke="currentColor"
          viewBox="0 0 378 378"
          xmlns="http://www.w3.org/2000/svg"
          xmlns:xlink="http://www.w3.org/1999/xlink"
          overflow="hidden"
          class={["stroke-base-content", class_size[size()]].join(" ")}
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
        </svg>
      </Match>
      <Match when={props.level == 2}>
        <svg
          stroke-width="4"
          stroke="currentColor"
          viewBox="0 0 378 378"
          xmlns="http://www.w3.org/2000/svg"
          xmlns:xlink="http://www.w3.org/1999/xlink"
          overflow="hidden"
          class={["stroke-base-content", class_size[size()]].join(" ")}
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
        </svg>
      </Match>
      <Match when={props.level == 3}>
        <svg
          stroke-width="4"
          stroke="currentColor"
          viewBox="0 0 378 378"
          xmlns="http://www.w3.org/2000/svg"
          xmlns:xlink="http://www.w3.org/1999/xlink"
          overflow="hidden"
          class={["stroke-base-content", class_size[size()]].join(" ")}
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
        </svg>
      </Match>
      <Match when={props.level == 4}>
        <svg
          stroke-width="4"
          stroke="currentColor"
          viewBox="0 0 378 378"
          xmlns="http://www.w3.org/2000/svg"
          xmlns:xlink="http://www.w3.org/1999/xlink"
          overflow="hidden"
          class={["stroke-base-content", class_size[size()]].join(" ")}
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
        </svg>
      </Match>
      <Match when={props.level == 5}>
        <svg
          stroke-width="4"
          stroke="currentColor"
          viewBox="0 0 378 378"
          xmlns="http://www.w3.org/2000/svg"
          xmlns:xlink="http://www.w3.org/1999/xlink"
          overflow="hidden"
          class={["stroke-base-content", class_size[size()]].join(" ")}
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
        </svg>
      </Match>
      <Match when={props.level == 6}>
        <svg
          stroke-width="4"
          stroke="currentColor"
          viewBox="0 0 378 378"
          xmlns="http://www.w3.org/2000/svg"
          xmlns:xlink="http://www.w3.org/1999/xlink"
          overflow="hidden"
          class={["stroke-base-content", class_size[size()]].join(" ")}
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
        </svg>
      </Match>
      <Match when={props.level == 7}>
        <svg
          stroke-width="4"
          stroke="currentColor"
          viewBox="0 0 378 378"
          xmlns="http://www.w3.org/2000/svg"
          xmlns:xlink="http://www.w3.org/1999/xlink"
          overflow="hidden"
          class={["stroke-base-content", class_size[size()]].join(" ")}
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
        </svg>
      </Match>
    </Switch>
  );
};
