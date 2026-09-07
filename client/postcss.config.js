export default {
  plugins: {
    // Resolve @custom-media (--phone) etc. from tokens.css into real queries.
    // Must run before tailwind/autoprefixer. See docs/breakpoints.md.
    '@csstools/postcss-global-data': {
      files: ['./src/styles/tokens.css'],
    },
    'postcss-custom-media': {},
    tailwindcss: {},
    autoprefixer: {},
  },
}
