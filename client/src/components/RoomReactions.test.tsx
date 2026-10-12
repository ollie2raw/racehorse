import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RoomReactions } from './RoomReactions';
import { ROOM_REACTION_EMOTES } from '../multiplayer/roomReactionEmotes';

function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Open reactions' }));
}

describe('RoomReactions', () => {
  it('offers only the six preset emotes and no text input', () => {
    const onSendEmote = vi.fn();
    const { container } = render(<RoomReactions feed={[]} onSendEmote={onSendEmote} />);
    open();

    expect(container.querySelector('input, textarea, form, [contenteditable]')).toBeNull();
    const buttons = ROOM_REACTION_EMOTES.map((e) => screen.getByRole('button', { name: e }));
    expect(buttons).toHaveLength(6);

    fireEvent.click(screen.getByRole('button', { name: '🎉' }));
    expect(onSendEmote).toHaveBeenCalledWith('🎉');
  });

  it('hides Report when there is no reportable opponent', () => {
    render(<RoomReactions feed={[]} onSendEmote={vi.fn()} reportTarget={null} onReport={vi.fn()} />);
    open();
    expect(screen.queryByRole('button', { name: /^Report / })).toBeNull();
  });

  it('reports the opponent with a predefined category and no typed text', async () => {
    const onReport = vi.fn().mockResolvedValue({ error: null });
    const target = { userId: '22222222-2222-4222-8222-222222222222', username: 'rival' };
    const { container } = render(
      <RoomReactions feed={[]} onSendEmote={vi.fn()} reportTarget={target} onReport={onReport} />,
    );
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Report rival' }));
    expect(container.querySelector('input, textarea')).toBeNull();
    for (const label of ['Inappropriate username', 'Harassment / abusive behavior', 'Cheating', 'Other']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Cheating' }));
    await waitFor(() => expect(screen.getByText(/Report sent/)).toBeTruthy());
    expect(onReport).toHaveBeenCalledWith(target, 'cheating');
  });
});
