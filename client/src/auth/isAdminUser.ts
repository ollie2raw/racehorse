/** Same allowlist used by Learn authoring and other admin-only surfaces. */
export function isAdminUser(email: string | null | undefined): boolean {
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL as string | undefined;
  return Boolean(email && adminEmail && email.toLowerCase() === adminEmail.toLowerCase());
}
