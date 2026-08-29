import { apiDelete } from '../api/client';

/**
 * Irreversibly deletes the signed-in account.
 *
 * The confirmation the user typed is sent and re-checked on the server — a
 * client is not the place to enforce intent for something that cannot be
 * undone.
 *
 * Anything short of an explicit `ok` is reported as an error. The caller signs
 * the user out on success, and doing that to an account that still exists is a
 * worse outcome than showing a failure the user can retry.
 */
export async function deleteAccount(confirmation: string): Promise<{ error: string | null }> {
  try {
    const { data, error } = await apiDelete<{ ok?: boolean }>('/api/account', {
      confirm: confirmation,
    });
    if (error) return { error };
    if (!data?.ok) return { error: 'Account deletion did not complete. Try again.' };
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unable to delete your account.' };
  }
}
