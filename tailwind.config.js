/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#001839',
        luxe: {
          navy: '#001839',
          navyLight: '#082552',
          navyDeep: '#000f24',
          gold: '#c5a880',
          pearl: '#fbfbfb',
          white: '#ffffff',
          lineLight: 'rgba(0, 24, 57, 0.08)',
          lineDark: 'rgba(255, 255, 255, 0.12)',
        }
      },
      fontFamily: {
        serif: ['"DM Serif Display"', 'serif'],
        sans: ['Inter', '"Noto Sans Lao"', 'sans-serif'],
        lao: ['"Noto Sans Lao"', 'sans-serif']
      }
    },
  },
  plugins: [],
};
