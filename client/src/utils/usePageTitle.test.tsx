// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pageTitle, usePageTitle } from './usePageTitle';

function Screen({ title, enabled = true }: { title: string; enabled?: boolean }) {
  usePageTitle(title, enabled);
  return null;
}

beforeEach(() => {
  document.title = 'Racehorse Dominoes — Daily dominoes';
});
afterEach(cleanup);

describe('usePageTitle', () => {
  it('names the page in the site-wide shape', () => {
    expect(pageTitle('Games')).toBe('Games | Racehorse Dominoes');
    render(<Screen title="Games" />);
    expect(document.title).toBe('Games | Racehorse Dominoes');
  });

  it('restores the previous title when the screen goes away', () => {
    const { unmount } = render(<Screen title="Friends" />);
    expect(document.title).toBe('Friends | Racehorse Dominoes');
    unmount();
    expect(document.title).toBe('Racehorse Dominoes — Daily dominoes');
  });

  it('follows a changed title and still restores the original at the end', () => {
    const { rerender, unmount } = render(<Screen title="Stats" />);
    rerender(<Screen title="Rating History" />);
    expect(document.title).toBe('Rating History | Racehorse Dominoes');
    unmount();
    expect(document.title).toBe('Racehorse Dominoes — Daily dominoes');
  });

  it('leaves the title alone while a screen is disabled (mounted but hidden), and takes it when shown', () => {
    const { rerender } = render(<Screen title="Friends" enabled={false} />);
    expect(document.title).toBe('Racehorse Dominoes — Daily dominoes');
    rerender(<Screen title="Friends" enabled />);
    expect(document.title).toBe('Friends | Racehorse Dominoes');
    rerender(<Screen title="Friends" enabled={false} />);
    expect(document.title).toBe('Racehorse Dominoes — Daily dominoes');
  });

  it('hands over cleanly between two screens: the next screen\'s title wins, then the original returns', () => {
    const first = render(<Screen title="Practice" />);
    first.unmount();
    const second = render(<Screen title="Friends" />);
    expect(document.title).toBe('Friends | Racehorse Dominoes');
    second.unmount();
    expect(document.title).toBe('Racehorse Dominoes — Daily dominoes');
  });
});
