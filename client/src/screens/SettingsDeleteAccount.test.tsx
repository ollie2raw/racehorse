// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../components/hub/HubViewportPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const { SettingsScreen } = await import('./SettingsScreen');
type Props = import('./SettingsScreen').SettingsScreenProps;

const authUser = { id: 'user-1', email: 'qa@racehorse.test' } as never;
const authProfile = { id: 'user-1', username: 'oliver' } as never;

function renderSettings(overrides: Partial<Props> = {}) {
  const props: Props = {
    authUser,
    authProfile,
    onDeleteAccount: vi.fn(() => Promise.resolve({ error: null })),
    ...overrides,
  };
  render(<SettingsScreen {...props} />);
  return props;
}

const openDelete = () => fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
const confirmField = () => screen.getByLabelText(/type your username/i);
const confirmButton = () => screen.getByRole('button', { name: /delete my account/i });

describe('SettingsScreen — delete account', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not expose the confirmation until the user asks for it', () => {
    renderSettings();
    expect(screen.queryByLabelText(/type your username/i)).toBeNull();
  });

  it('will not delete until the handle is typed exactly', async () => {
    const props = renderSettings();
    openDelete();

    expect(confirmButton()).toHaveProperty('disabled', true);

    fireEvent.change(confirmField(), { target: { value: 'olive' } });
    expect(confirmButton()).toHaveProperty('disabled', true);

    fireEvent.change(confirmField(), { target: { value: 'oliver' } });
    expect(confirmButton()).toHaveProperty('disabled', false);

    fireEvent.click(confirmButton());
    await waitFor(() => expect(props.onDeleteAccount).toHaveBeenCalledWith('oliver'));
  });

  it('accepts the handle with stray whitespace or casing', () => {
    renderSettings();
    openDelete();

    fireEvent.change(confirmField(), { target: { value: ' Oliver ' } });

    expect(confirmButton()).toHaveProperty('disabled', false);
  });

  it('can be backed out of', () => {
    renderSettings();
    openDelete();

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByLabelText(/type your username/i)).toBeNull();
  });

  it('surfaces a failure and does not pretend the account is gone', async () => {
    renderSettings({
      onDeleteAccount: vi.fn(() => Promise.resolve({ error: 'Unable to delete your account.' })),
    });
    openDelete();
    fireEvent.change(confirmField(), { target: { value: 'oliver' } });
    fireEvent.click(confirmButton());

    expect(await screen.findByText('Unable to delete your account.')).toBeTruthy();
    // Still on the page, still confirmable — nothing was destroyed.
    expect(confirmField()).toBeTruthy();
  });

  it('is not offered to a signed-out visitor', () => {
    render(<SettingsScreen authUser={null} authProfile={null} />);
    expect(screen.queryByRole('button', { name: /delete account/i })).toBeNull();
  });
});
