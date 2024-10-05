import {JSX} from 'solid-js';

export function IconXMark(props: JSX.HTMLAttributes<HTMLOrSVGElement>, key: string) {
    return (
      <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg"
        strokeWidth="1.5" 
        stroke="currentColor" 
        viewBox="0 0 24 24"
        {...props} key={key}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
      </svg>
    )
  }