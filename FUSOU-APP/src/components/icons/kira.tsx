import type { PropsOf } from '@builder.io/qwik'
 
export function IconKira(props: PropsOf<'svg'>, key: string) {
  return (
    <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg"
      strokeWidth="1.5" 
      stroke="currentColor" 
	 viewBox="0 0 512 512"
      {...props} key={key}>
      <g>
	<path d="M495.469,241.969c-113.594,0-152.875-28.5-174.906-50.531c-22.031-22.125-50.578-61.344-50.578-174.922
		c0-4.328-0.453-16.516-14.016-16.516C242.531,0,242,12.188,242,16.516c0,113.578-28.563,152.797-50.594,174.922
		c-22.094,22.031-61.375,50.531-174.906,50.531c-4.344,0-16.5,0.5-16.5,14.047c0,13.453,12.156,13.938,16.5,13.938
		c113.531,0,152.813,28.578,174.906,50.625C213.438,342.625,242,381.922,242,495.5c0,4.344,0.531,16.5,13.969,16.5
		c13.563,0,14.016-12.156,14.016-16.5c0-113.578,28.547-152.875,50.578-174.922c22.031-22.078,61.313-50.625,174.906-50.625
		c4.328,0,16.531-0.422,16.531-13.984C512,242.516,499.797,241.969,495.469,241.969z"></path>
</g>
    </svg>
  )
}
export default IconKira