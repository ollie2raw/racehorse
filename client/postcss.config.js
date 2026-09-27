import globalData from '@csstools/postcss-global-data';
import customMedia from 'postcss-custom-media';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { WIDE_SHELL_QUERY, COMPACT_SHELL_QUERY, SHORT_LANDSCAPE_QUERY } from './config/responsivePolicy.js';

const shellCustomMedia = {
  postcssPlugin: 'racehorse-shell-custom-media',
  Once(root) {
    for (const [name, query] of [
      ['--desk', WIDE_SHELL_QUERY],
      ['--compact-shell', COMPACT_SHELL_QUERY],
      ['--short-landscape', SHORT_LANDSCAPE_QUERY],
    ]) {
      root.prepend({ name: 'custom-media', params: `${name} ${query}` });
    }
  },
};

export default {
  plugins: [
    shellCustomMedia,
    globalData({ files: ['./src/styles/tokens.css'] }),
    customMedia(),
    tailwindcss(),
    autoprefixer(),
  ],
};
