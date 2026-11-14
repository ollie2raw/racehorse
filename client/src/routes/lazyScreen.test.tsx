// @vitest-environment jsdom
import { Suspense } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { lazyScreen } from './lazyScreen';

afterEach(cleanup);

function deferredModule() {
  let resolve!: () => void;
  const gate = new Promise<void>((r) => {
    resolve = r;
  });
  const screenUnderTest = lazyScreen<{ name: string }>(async () => {
    await gate;
    return { default: ({ name }) => <p>hello {name}</p> };
  });
  return { screenUnderTest, resolve };
}

describe('lazyScreen', () => {
  it('suspends until the chunk arrives, then renders it', async () => {
    const { screenUnderTest: Screen, resolve } = deferredModule();
    render(
      <Suspense fallback={<p>loading</p>}>
        <Screen name="a" />
      </Suspense>,
    );
    expect(screen.getByText('loading')).toBeTruthy();
    await act(async () => resolve());
    expect(await screen.findByText('hello a')).toBeTruthy();
  });

  it('renders at once, with no fallback, when the chunk was preloaded', async () => {
    const { screenUnderTest: Screen, resolve } = deferredModule();
    expect(Screen.isLoaded()).toBe(false);
    resolve();
    await Screen.preload();
    expect(Screen.isLoaded()).toBe(true);
    render(
      <Suspense fallback={<p>loading</p>}>
        <Screen name="b" />
      </Suspense>,
    );
    expect(screen.queryByText('loading')).toBeNull();
    expect(screen.getByText('hello b')).toBeTruthy();
  });

  it('forgets a failed load so the next preload retries', async () => {
    let calls = 0;
    const Screen = lazyScreen<object>(async () => {
      calls += 1;
      if (calls === 1) throw new Error('offline');
      return { default: () => <p>ok</p> };
    });
    await expect(Screen.preload()).rejects.toThrow('offline');
    await Screen.preload();
    expect(Screen.isLoaded()).toBe(true);
  });
});
