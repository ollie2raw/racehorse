/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{tsx,jsx,ts,js}',
    './src/experimental/**/*.{tsx,jsx,ts,js}',
  ],
  theme: {
    extend: {
      screens: {
        /**
         * Desktop hub layout.
         *
         * Width alone cannot identify a phone: a 390×844 handset is 844px *wide*
         * in landscape, so it matches `md:` (≥768px) and inherits the desktop
         * layout inside a 390px-tall viewport — which is what left hub content
         * below the fold unreachable. Requiring real vertical room as well means
         * no phone matches this in either orientation, while tablets and laptops
         * still do. Hub screens use `desk:` for desktop styling; the unprefixed
         * base is the phone layout.
         */
        desk: { raw: '(min-width: 769px) and (min-height: 600px)' },
      },
    },
  },
  plugins: [],
}
