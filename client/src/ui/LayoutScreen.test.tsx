// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import LayoutScreen from './LayoutScreen';

afterEach(cleanup);

describe('LayoutScreen title', () => {
  it('is an h2 by default, so a page that already has its own h1 does not end up with two', () => {
    render(<LayoutScreen title="Learn Racehorse" subtitle="Sub" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Learn Racehorse' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('is the page h1 when asked, with the same class so the styling is unchanged', () => {
    render(<LayoutScreen title="Games" headingLevel={1} />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Games' });
    expect(heading.className).toBe('layout-screen-title');
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });
});
