// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../components/hub/HubViewportPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const { SettingsScreen } = await import('./SettingsScreen');
type Props = import('./SettingsScreen').SettingsScreenProps;

const authUser = { id: 'user-1', email: 'old@racehorse.test' } as never;
const authProfile = { id: 'user-1', username: 'oliver' } as never;

const ok = () => Promise.resolve({ error: null });

function renderSettings(overrides: Partial<Props> = {}) {
  const props: Props = {
    authUser,
    authProfile,
    onSaveUsername: vi.fn(ok),
    onUpdatePassword: vi.fn(ok),
    onUpdateEmail: vi.fn(ok),
    ...overrides,
  };
  render(<SettingsScreen {...props} />);
  return props;
}

const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('SettingsScreen — handle', () => {
  it('starts from the handle the account already has', () => {
    renderSettings();
    expect((screen.getByLabelText(/^username$/i) as HTMLInputElement).value).toBe('oliver');
  });

  it('saves a new handle', async () => {
    const props = renderSettings();
    type(/^username$/i, 'oliver_two');
    fireEvent.click(screen.getByRole('button', { name: /save username/i }));

    await waitFor(() => expect(props.onSaveUsername).toHaveBeenCalledWith('oliver_two'));
  });

  it('surfaces a rejected handle rather than reporting success', async () => {
    const props = renderSettings({
      onSaveUsername: vi.fn(() => Promise.resolve({ error: 'Username already taken. Try another one.' })),
    });
    type(/^username$/i, 'taken');
    fireEvent.click(screen.getByRole('button', { name: /save username/i }));

    expect(await screen.findByText('Username already taken. Try another one.')).toBeTruthy();
    expect(props.onSaveUsername).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsScreen — password', () => {
  it('changes the password without an email round-trip', async () => {
    const props = renderSettings();
    type(/^new password$/i, 'correct-horse');
    type(/^confirm new password$/i, 'correct-horse');
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => expect(props.onUpdatePassword).toHaveBeenCalledWith('correct-horse'));
  });

  it('refuses a mismatched pair without calling supabase', async () => {
    const props = renderSettings();
    type(/^new password$/i, 'correct-horse');
    type(/^confirm new password$/i, 'correct-hoarse');
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    expect(await screen.findByText('Passwords do not match.')).toBeTruthy();
    expect(props.onUpdatePassword).not.toHaveBeenCalled();
  });

  it('clears the fields once the password is changed', async () => {
    renderSettings();
    type(/^new password$/i, 'correct-horse');
    type(/^confirm new password$/i, 'correct-horse');
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() =>
      expect((screen.getByLabelText(/^new password$/i) as HTMLInputElement).value).toBe(''),
    );
  });
});

describe('SettingsScreen — email', () => {
  it('shows the address currently on the account', () => {
    renderSettings();
    expect(screen.getByText('old@racehorse.test')).toBeTruthy();
  });

  it('sends the change and reports it as pending, not done', async () => {
    const props = renderSettings({
      onUpdateEmail: vi.fn(() =>
        Promise.resolve({ error: null, message: 'Check new@racehorse.test for a confirmation link.' }),
      ),
    });
    type(/^new email$/i, 'new@racehorse.test');
    fireEvent.click(screen.getByRole('button', { name: /change email/i }));

    await waitFor(() => expect(props.onUpdateEmail).toHaveBeenCalledWith('new@racehorse.test'));
    expect(await screen.findByText(/confirmation link/i)).toBeTruthy();
    // The header still shows the old address: nothing changed yet.
    expect(screen.getByText('old@racehorse.test')).toBeTruthy();
  });

  it('surfaces a rejected address', async () => {
    renderSettings({
      onUpdateEmail: vi.fn(() => Promise.resolve({ error: 'That is already your email address.' })),
    });
    type(/^new email$/i, 'old@racehorse.test');
    fireEvent.click(screen.getByRole('button', { name: /change email/i }));

    expect(await screen.findByText('That is already your email address.')).toBeTruthy();
  });
});

describe('SettingsScreen — signed out', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows no account fields at all', () => {
    render(<SettingsScreen authUser={null} authProfile={null} />);
    expect(screen.queryByLabelText(/^username$/i)).toBeNull();
    expect(screen.queryByLabelText(/^new password$/i)).toBeNull();
    expect(screen.queryByLabelText(/^new email$/i)).toBeNull();
  });
});
