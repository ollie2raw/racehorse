/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{tsx,jsx,ts,js}',
    './src/experimental/**/*.{tsx,jsx,ts,js}',
  ],
  // Structured diagnostic prefixes look like Tailwind arbitrary-property
  // classes (for example `[room:recovery]`). Never emit CSS for log tokens.
  blocklist: [
    '[app:navigation]',
    '[daily-fritz:next-hand]',
    '[draw:audit]',
    '[hand:ready]',
    '[room:recovery]',
    '[tournament:attach-client]',
    '[tournament:bracket]',
    '[tournament:complete]',
    '[tournament:exit]',
    '[tournament:hub]',
    '[tournament:hydrate-check]',
    '[tournament:postgame]',
    '[tournament:recovery]',
  ],
  theme: {
    extend: {
      // Locked to Racehorse breakpoint contract (styles/breakpoints.ts)
      screens: {
        md: '768px',
      },
    },
  },
  plugins: [],
}
