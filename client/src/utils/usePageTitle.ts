import { useEffect } from 'react';

const SITE_NAME = 'Racehorse Dominoes';

/** `<page> | Racehorse Dominoes`, the same shape the legal pages use. */
export function pageTitle(page: string): string {
  return `${page} | ${SITE_NAME}`;
}

/**
 * Names the browser tab, the history entry and the screen-reader page announcement for a screen. Without it every
 * screen that does not set its own title shows the site's default one. The previous title is restored on unmount, so
 * leaving the screen puts back whatever was there (the default, or the next screen's own). Pass `enabled` false for a
 * screen that stays mounted while hidden, so it does not rename the tab for the screen that is showing.
 */
export function usePageTitle(page: string, enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    const previous = document.title;
    document.title = pageTitle(page);
    return () => {
      document.title = previous;
    };
  }, [page, enabled]);
}
