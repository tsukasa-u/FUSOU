import type { JSX } from "solid-js";
import { createMemo } from "solid-js";

interface FleetNumberProps {
  e_flag: number;
  fleet_number: number;
  ship_number: number;
  combined_flag?: boolean | null;
}

export function IconFleetNumber(
  props: JSX.HTMLAttributes<SVGSVGElement> & FleetNumberProps,
) {
  // let primary_color: string = "#000000";
  // if (props.e_flag == 0) {
  //   primary_color = "#2D9C45";
  // } else if (props.e_flag == 1) {
  //   primary_color = "#FF100C";
  // }

  // if (props.combined_flag == true) {
  //   if (props.ship_number > 6) {
  //     props.fleet_number += 1;
  //     props.ship_number -= 6;
  //   }
  // }

  const primary_color = createMemo(() => {
    if (props.e_flag == 0) {
      return "#2D9C45";
    } else if (props.e_flag == 1) {
      return "#FF100C";
    }
  });

  const fleet_ship_number = createMemo(() => {
    if (props.combined_flag == true && props.ship_number > 6) {
      return [props.fleet_number + 1, props.ship_number - 6];
    } else {
      return [props.fleet_number, props.ship_number];
    }
  });

  return (
    <svg
      fill="currentColor"
      stroke-width="1.5"
      stroke="currentColor"
      viewBox="0 0 151 151"
      xmlns="http://www.w3.org/2000/svg"
      xmlns:xlink="http://www.w3.org/1999/xlink"
      overflow="hidden"
      {...props}
    >
      <text
        font-family="monospace,sans-serif"
        font-weight="400"
        font-size="96"
        transform="translate(25 104)"
      >
        {fleet_ship_number()[0]}
        {fleet_ship_number()[1]}
      </text>
      <path
        d="M28 124 124 124"
        stroke={primary_color()}
        stroke-width="16"
        stroke-miterlimit="8"
        fill="none"
        fill-rule="evenodd"
      />
    </svg>
  );
}
export default IconFleetNumber;
