/** @type {import('tailwindcss').Config} */
import daisyui from "daisyui";
module.exports = {
  content:  ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'media',
  theme: {
      extend: {},
  },
  variants: {
      extend: {},
  },
  plugins: [
    daisyui,
  ],
}
