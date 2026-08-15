/**
 * Racehorse responsive breakpoint contract.
 * Keep in sync with --bp-* tokens in styles/tokens.css and @media literals.
 */
export const BP_PHONE_MAX = 767;
export const BP_TABLET_MIN = 768;
export const BP_HUB_STACK = 900;

export const MQ_PHONE = `(max-width: ${BP_PHONE_MAX}px)`;
export const MQ_TABLET_UP = `(min-width: ${BP_TABLET_MIN}px)`;
export const MQ_HUB_STACK = `(max-width: ${BP_HUB_STACK}px)`;
