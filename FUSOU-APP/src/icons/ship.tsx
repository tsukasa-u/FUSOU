import { JSX } from "solid-js";

interface ShipProps {
  ship_stype: number;
  color?: string;
}

const icon_list: { [key: string]: string } = {
  undifined: "#FFFFFF", //  Undefined
  "": "#CCCCCC",
  "-": "#CCCCCC",
  elite: "#FF4500", //  Elite
  flagship: "#FFD700", //  Flagship
};

const name_list: { [key: number]: string } = {
  0: "UN", //    Undefined
  1: "DE", //    Escort
  2: "DD", //		Destroyer
  3: "CL", //	  Light Cruiser
  4: "CLT", //    Torpedo Cruiser
  5: "CA", //	  Heavy Cruiser
  6: "CAV", //    Aircraft Cruiser
  7: "CVL", //    Light Aircraft Carrier
  8: "BB", //	  Battleship
  9: "BB", //	  Battleship
  10: "BBV", //    Aviation Battleship
  11: "CV", //    Aircraft Carrier
  12: "BB", //    Super Dreadnoughts
  13: "SS", //    Submarine
  14: "SSV", //    Aircraft Carrying Submarine
  15: "AO", //    Fleet Oiler
  16: "AV", //    Seaplane Carrier
  17: "LHA", //    Amphibious Assault Ship
  18: "CVB", //    Aircraft Carrier
  19: "AR", //    Repair Ship
  20: "AS", //    Submarine Tender
  21: "CT", //    Training Cruiser
  22: "AO", //    Fleet Oiler
};

export function IconShip(
  props: JSX.HTMLAttributes<SVGSVGElement> & ShipProps,
) {
  let primary_color: string = icon_list[""];
  let secondary_color: string = icon_list[props.color ?? ""];
  if (secondary_color == undefined) {
    secondary_color = "#000000";
    console.log("color is undefined", props.color);
  }
  let name = name_list[props.ship_stype ?? 0];

  return (
    <svg
      fill="currentColor"
      stroke-width="1.5"
      stroke="currentColor"
      viewBox="0 0 199 151"
      xmlns="http://www.w3.org/2000/svg"
      xmlns:xlink="http://www.w3.org/1999/xlink"
      overflow="hidden"
      {...props}
    >
      <text
        font-family="monospace,sans-serif"
        font-weight="400"
        font-size="96"
        transform={"translate(" + (25 - (name.length - 3) * 24) + " 104)"}
      >
        {name}
      </text>
      <path
        d="m 9 32 C 9 19.85 18.85 10 31 10 L 167 10 C 179.15 10 189 19.85 189 32 l 0 88 C 189 132.15 179.15 142 167 142 L 31 142 C 18.85 142 9 132.15 9 120 Z"
        stroke="#000000"
        stroke-width="4"
        stroke-linejoin="round"
        stroke-miterlimit="10"
        fill="none"
        fill-rule="evenodd"
      />
      <path
        d="M28 124 100 124"
        stroke={primary_color}
        stroke-width="16"
        stroke-miterlimit="8"
        fill="none"
        fill-rule="evenodd"
      />
      <path
        d="M100 124 172 124"
        stroke={secondary_color}
        stroke-width="16"
        stroke-miterlimit="8"
        fill="none"
        fill-rule="evenodd"
      />
    </svg>
  );
}
export default IconShip;
