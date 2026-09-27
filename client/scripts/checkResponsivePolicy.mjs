import assert from 'node:assert/strict';
import postcss from 'postcss';
import tailwindConfig from '../tailwind.config.js';
import postcssConfig from '../postcss.config.js';
import { WIDE_SHELL_QUERY, COMPACT_SHELL_QUERY, SHORT_LANDSCAPE_QUERY } from '../config/responsivePolicy.js';

assert.equal(tailwindConfig.theme.extend.screens.desk.raw, WIDE_SHELL_QUERY);
const css = '@media (--desk) { .wide { display: block } } @media (--compact-shell) { .compact { display: block } } @media (--short-landscape) { .short { display: block } }';
const { css: compiled } = await postcss([postcssConfig.plugins[0], postcssConfig.plugins[2]]).process(css, { from: undefined });
for (const query of [WIDE_SHELL_QUERY, COMPACT_SHELL_QUERY, SHORT_LANDSCAPE_QUERY]) {
  assert.ok(compiled.includes(query), `Missing compiled query: ${query}`);
}
assert.ok(!compiled.includes('(--desk)') && !compiled.includes('(--compact-shell)'));
for (const [width, height, wide] of [
  [667, 375, false], [740, 360, false], [844, 390, false],
  [852, 393, false], [915, 412, false], [932, 430, false],
  [390, 844, false], [1000, 500, false], [1280, 720, true], [1440, 900, true],
]) {
  assert.equal(width >= 769 && height >= 600, wide);
}
console.log('Responsive shell policy: Tailwind/PostCSS query parity and viewport matrix PASS');
