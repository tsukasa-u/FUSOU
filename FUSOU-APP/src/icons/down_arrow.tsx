import { JSX } from 'solid-js';
 
export function IconDownArrow(props: JSX.HTMLAttributes<SVGSVGElement>) {
  return (
    <svg fill="none" xmlns="http://www.w3.org/2000/svg"
      stroke-width="1.5" 
      stroke="currentColor" 
	    viewBox="0 0 24 24"
      {...props}>
      	<path d="M7 10L12 15L17 10" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  )
}
export default IconDownArrow