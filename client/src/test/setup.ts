import '@testing-library/jest-dom';

// Shared setup for both jsdom and node environments. F4a real-worker tests
// use `@vitest-environment node` (worker_threads); skip browser stubs there.
const isBrowserTestEnv = typeof window !== 'undefined';

if (isBrowserTestEnv) {
  // jsdom doesn't implement matchMedia — provide a minimal stub
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });

  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
      key: (index: number) => Object.keys(store)[index] || null,
      get length() {
        return Object.keys(store).length;
      },
    };
  })();

  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    configurable: true,
    writable: true,
  });

  // jsdom doesn't implement Worker — provide a minimal no-op stub so effects
  // that construct one (e.g. useReviewWorkerBatch's default createWorker)
  // don't crash tests that aren't exercising worker behavior at all. Tests
  // that need real worker message behavior inject a fake via
  // useReviewWorkerBatch's own createWorker parameter instead of relying on
  // this stub doing anything.
  class NoopWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    postMessage(): void {}
    terminate(): void {}
  }

  Object.defineProperty(window, 'Worker', {
    value: NoopWorker,
    configurable: true,
    writable: true,
  });
}
