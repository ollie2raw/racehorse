// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The app shell owns the live nav; the page only passes it hints.
vi.mock('../components/GlobalNav', () => ({ GlobalNav: () => null }));

const { default: LegalScreen } = await import('./LegalScreen');
const { LegalLinks } = await import('./LegalLinks');

afterEach(cleanup);

describe('legal pages render signed out', () => {
  it.each([
    ['privacy', 'Privacy Policy', ['What we collect', 'Service providers', 'Deleting your account', 'Children']],
    ['terms', 'Terms of Use', ['Usernames', 'Fair play', 'No gambling, prizes or purchases', 'Suspension and termination']],
    ['support', 'Support', ['Contact us', 'Account and password', 'Multiplayer troubleshooting', 'Reporting and blocking']],
  ] as const)('/%s shows its heading, sections and title with no session', (page, heading, sections) => {
    // No auth props at all: these routes must work for a signed-out visitor.
    render(<LegalScreen page={page} />);
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeTruthy();
    for (const section of sections) {
      expect(screen.getByRole('heading', { level: 2, name: section })).toBeTruthy();
    }
    expect(document.title).toBe(`${heading} | Racehorse Dominoes`);
  });

  it('restores the previous document title on the way out', () => {
    document.title = 'Racehorse Dominoes | Daily Strategy Game';
    const { unmount } = render(<LegalScreen page="terms" />);
    expect(document.title).toBe('Terms of Use | Racehorse Dominoes');
    unmount();
    expect(document.title).toBe('Racehorse Dominoes | Daily Strategy Game');
  });

  it('shows owner placeholders as visible labels, not invented values', () => {
    render(<LegalScreen page="support" />);
    expect(screen.getAllByText(/\[support email — to be confirmed\]/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/OWNER_PLACEHOLDER/)).toBeNull();
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it('gives the exact account deletion path', () => {
    render(<LegalScreen page="support" />);
    expect(screen.getByText(/Settings → Delete account, then type your username/)).toBeTruthy();
  });

  it('links to the other legal pages in-app from the footer', () => {
    const onNavigate = vi.fn();
    render(<LegalScreen page="privacy" onNavigate={onNavigate} />);
    const footer = screen.getByRole('navigation', { name: 'Legal and support' });
    const current = within(footer).getByRole('link', { name: 'Privacy' });
    expect(current.getAttribute('aria-current')).toBe('page');
    fireEvent.click(within(footer).getByRole('link', { name: 'Terms' }));
    expect(onNavigate).toHaveBeenCalledWith('terms');
  });
});

describe('LegalLinks', () => {
  it('uses same-origin paths, never absolute URLs, so the iOS app stays in its WebView', () => {
    render(<LegalLinks onNavigate={vi.fn()} />);
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(['/privacy', '/terms', '/support']);
  });

  it('navigates in-app on a plain click and leaves modified clicks to the browser', () => {
    const onNavigate = vi.fn();
    render(<LegalLinks onNavigate={onNavigate} />);
    const support = screen.getByRole('link', { name: 'Support' });

    const plain = fireEvent.click(support);
    expect(plain).toBe(false); // default prevented
    expect(onNavigate).toHaveBeenCalledWith('support');

    onNavigate.mockClear();
    const newTab = fireEvent.click(support, { metaKey: true });
    expect(newTab).toBe(true);
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
