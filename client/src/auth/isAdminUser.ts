/** Same allowlist used by Learn authoring and other admin-only surfaces. */
export function isAdminUser(email: string | null | undefined): boolean {
  // e2e specs (journey-premium-*.spec.ts) run anonymously — there is no
  // signed-in email to match against VITE_ADMIN_EMAIL — but still need to
  // reach admin-gated content (Journey). playwright.config.ts sets this only
  // on the dev server it spins up for the e2e run; it is never set for local
  // `npm run dev` or the production build.
  if (import.meta.env.VITE_E2E_ADMIN_BYPASS === '1') return true;
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL as string | undefined;
  return Boolean(email && adminEmail && email.toLowerCase() === adminEmail.toLowerCase());
}
