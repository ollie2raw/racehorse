/** One shell breakpoint shared by Tailwind and PostCSS custom media. */
export const WIDE_SHELL_QUERY = '(min-width: 769px) and (min-height: 600px)';
export const COMPACT_SHELL_QUERY = `not all and ${WIDE_SHELL_QUERY}`;
export const SHORT_LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 430px)';
