// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppRoutesAuthProps, AppRoutesNavigationProps, AppRoutesShellProps } from '../appRouteTypes';

vi.mock('../learn/guidedMatch/GuidedMatchRecorderScreen', () => ({ default: () => <div data-testid="recorder-tool" /> }));
vi.mock('../learn/guidedMatch/GuidedMatchAnnotatorScreen', () => ({ default: () => <div data-testid="annotator-tool" /> }));

const { GuidedMatchRecorderRoute, GuidedMatchAnnotatorRoute } = await import('./soloPlayRoutes');

afterEach(cleanup);

function setup(auth: Partial<AppRoutesAuthProps>) {
  const setAppMode = vi.fn();
  const shell = { withAuthModals: (node: React.ReactNode) => node, appRootClassName: 'app' } as unknown as AppRoutesShellProps;
  const navigation = { setAppMode } as unknown as AppRoutesNavigationProps;
  return { setAppMode, shell, navigation, auth: { isAdmin: false, authLoading: false, ...auth } as AppRoutesAuthProps };
}

const TOOLS = [
  { name: 'recorder', Route: GuidedMatchRecorderRoute, testId: 'recorder-tool' },
  { name: 'annotator', Route: GuidedMatchAnnotatorRoute, testId: 'annotator-tool' },
] as const;

describe.each(TOOLS)('the Guided Match $name route', ({ Route, testId }) => {
  it('is locked for anyone who is not the admin, by URL as well as by button', () => {
    const { shell, navigation, auth } = setup({ isAdmin: false });
    render(<Route shell={shell} navigation={navigation} auth={auth} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Not available' })).toBeTruthy();
    expect(screen.getByText('This tool is only for the Racehorse team.')).toBeTruthy();
    expect(screen.queryByTestId(testId)).toBeNull();
  });

  it('sends a locked visitor back to Learn', () => {
    const { shell, navigation, auth, setAppMode } = setup({ isAdmin: false });
    render(<Route shell={shell} navigation={navigation} auth={auth} />);
    fireEvent.click(screen.getByRole('button', { name: /Back to Learn/ }));
    expect(setAppMode).toHaveBeenCalledWith('learn');
  });

  it('does not judge anyone while auth is still loading: no locked page flashes for the admin', () => {
    const { shell, navigation, auth } = setup({ isAdmin: false, authLoading: true });
    render(<Route shell={shell} navigation={navigation} auth={auth} />);
    expect(screen.queryByRole('heading', { name: 'Not available' })).toBeNull();
    expect(screen.queryByTestId(testId)).toBeNull();
  });

  it('opens the tool for the admin', async () => {
    const { shell, navigation, auth } = setup({ isAdmin: true });
    render(<Route shell={shell} navigation={navigation} auth={auth} />);
    expect(await screen.findByTestId(testId)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Not available' })).toBeNull();
  });
});
