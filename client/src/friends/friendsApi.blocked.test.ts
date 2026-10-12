import { describe, expect, it, vi } from 'vitest';

// The database refuses a friend request between a blocked pair with the
// neutral `friend_request_unavailable` error (friends_refuse_blocked_pair).
const insertResult = { error: { message: 'friend_request_unavailable' } };
vi.mock('../lib/supabase', () => {
  function tableChain(table: string) {
    const single = table === 'profiles' ? { data: { id: 'target', username: 'rival' }, error: null } : { data: null, error: null };
    const chain = {
      select: () => chain,
      ilike: () => chain,
      or: () => chain,
      maybeSingle: async () => single,
      insert: async () => insertResult,
    };
    return chain;
  }
  return { supabase: { from: (table: string) => tableChain(table) } };
});

const { sendFriendRequest } = await import('./friendsApi');

describe('sendFriendRequest across a block', () => {
  it('shows the same neutral message whichever side blocked', async () => {
    const result = await sendFriendRequest('me', 'rival');
    expect(result.error).toBe('You can’t send a friend request to this player.');
    expect(result.error).not.toMatch(/block/i);
  });
});
