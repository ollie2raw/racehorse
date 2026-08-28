/**
 * The site's public identity.
 *
 * Shared results carry this domain into every feed they land in, so it has to
 * be the brand domain rather than whichever deploy host happened to be current
 * when the share text was written. Defined once because it drifted before:
 * every share built between launch and this commit advertised a stale
 * preview URL.
 *
 * This is display copy. Host allowlists that must keep recognising older
 * origins — auth redirects, game-server resolution — deliberately keep their
 * own lists and should not read from here.
 */
export const SITE_DOMAIN = 'playracehorse.com';

export const SITE_ORIGIN = `https://${SITE_DOMAIN}`;
