import { JSX } from 'solid-js';

interface FleetNumberProps {
  e_flag: number;
  fleet_number: number;
  ship_number: number;
}
 
export function IconFleetNumber({e_flag, fleet_number, ship_number, ...props}: JSX.HTMLAttributes<SVGSVGElement> & FleetNumberProps) {

  let primary_color: string = "#000000";
  if (e_flag == 0) {
    primary_color = "#2D9C45";
  } else if (e_flag == 1) {
    primary_color = "#FF100C";
  }

  return (
    <svg 
      fill="currentColor"
      stroke-width="1.5" 
      stroke="currentColor" 
      viewBox="0 0 151 151"
      xmlns="http://www.w3.org/2000/svg" 
      xmlns:xlink="http://www.w3.org/1999/xlink" 
      overflow="hidden" 
      {...props}>
        <text font-family="monospace,sans-serif" font-weight="400" font-size="96" transform="translate(25 104)">
          {fleet_number}{ship_number}
        </text>
        {/* <path d="M9 32C9 19.85 18.85 10 31 10L119 10C131.15 10 141 19.85 141 32L141 120C141 132.15 131.15 142 119 142L31 142C18.85 142 9 132.15 9 120Z" stroke="#000000" stroke-width="4" stroke-linejoin="round" stroke-miterlimit="10" fill="none" fill-rule="evenodd"/> */}
        {/* <path d="M28 124 76 124" stroke={primary_color} stroke-width="16" stroke-miterlimit="8" fill="none" fill-rule="evenodd"/>
        <path d="M76 124 124 124" stroke={secondary_color} stroke-width="16" stroke-miterlimit="8" fill="none" fill-rule="evenodd"/> */}
        <path d="M28 124 124 124" stroke={primary_color} stroke-width="16" stroke-miterlimit="8" fill="none" fill-rule="evenodd"/>
    </svg>
  )
}
export default IconFleetNumber