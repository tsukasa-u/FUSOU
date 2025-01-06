import { JSX } from 'solid-js';
 
export function IconUpArrow(props: JSX.HTMLAttributes<SVGSVGElement>) {
  return (
    <svg fill="none" xmlns="http://www.w3.org/2000/svg"
      stroke-width="1.5" 
      stroke="currentColor" 
	    viewBox="0 0 24 24"
      {...props}>
      	<path d="M17 15L12 10L7 15" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  )
}
export default IconUpArrow