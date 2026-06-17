type AuthLikeError = {
  message?: string;
  status?: number;
  code?: string;
};

/** Map Supabase auth errors to clearer player-facing copy. */
export function formatAuthErrorMessage(error: AuthLikeError | null | undefined): string {
  if (!error) return 'Something went wrong. Try again.';

  const message = error.message?.trim() || 'Something went wrong. Try again.';
  const lower = message.toLowerCase();

  if (error.status === 429 || lower.includes('rate limit')) {
    return 'Too many email requests. Wait a few minutes, then try again.';
  }

  if (lower.includes('error sending recovery email') || lower.includes('error sending confirmation email')) {
    return 'We could not send that email right now. Wait a few minutes and try again. If this keeps happening, mail delivery may need to be fixed in Supabase (Auth → SMTP / email logs).';
  }

  if (lower.includes('redirect') && lower.includes('url')) {
    return 'Password reset is misconfigured for this site URL. Contact support.';
  }

  return message;
}
