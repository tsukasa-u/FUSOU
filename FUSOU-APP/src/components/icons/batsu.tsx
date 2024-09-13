import type { PropsOf } from '@builder.io/qwik'
 
export function IconBatsu(props: PropsOf<'svg'>, key: string) {
  return (
    <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg"
      strokeWidth="1.5" 
      stroke="currentColor" 
	    viewBox="0 0 512 512"
      {...props} key={key}>
      	<polygon points="511.998,70.682 441.315,0 256.002,185.313 70.685,0 0.002,70.692 185.316,256.006 0.002,441.318 70.69,512 256.002,326.688 441.315,512 511.998,441.318 326.684,256.006" ></polygon>
    </svg>
  )
}
export default IconBatsu