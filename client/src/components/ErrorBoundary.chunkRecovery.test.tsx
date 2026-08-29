// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Where module-import recovery fires, and where it does not.
 *
 * It used to run from the global error/unhandledrejection handlers, so any
 * rejected promise whose message matched could reload the page — including a
 * telemetry chunk failing, which no user would otherwise notice. These pin the
 * narrowed trigger.
 */

const { captureException, addBreadcrumb } = vi.hoisted(() => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));
vi.mock('@sentry/react', () => ({ captureException, addBreadcrumb }));

const { ErrorBoundary } = await import('./ErrorBoundary');
const { MODULE_IMPORT_RECOVERY_KEY } = await import('../debug/moduleImportRecovery');
const { installGlobalErrorHandlers } = await import('../debug/globalErrors');

const replace = vi.fn();

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

beforeEach(() => {
  replace.mockReset();
  captureException.mockReset();
  window.sessionStorage.removeItem(MODULE_IMPORT_RECOVERY_KEY);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { pathname: '/solo', search: '', hash: '', replace },
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('module-import recovery — what triggers it', () => {
  it('reloads when a lazy chunk fails under a boundary', () => {
    render(
      <ErrorBoundary context="test" fallback={null}>
        <Boom message="Importing a module script failed." />
      </ErrorBoundary>,
    );

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0]![0]).toMatch(/rh_reload=\d+/);
  });

  it('does not also report a recovered load as an error', () => {
    render(
      <ErrorBoundary context="test" fallback={null}>
        <Boom message="Importing a module script failed." />
      </ErrorBoundary>,
    );

    expect(captureException).not.toHaveBeenCalled();
  });
});

describe('module-import recovery — what does not trigger it', () => {
  it('leaves an ordinary component crash alone, and still reports it', () => {
    render(
      <ErrorBoundary context="test" fallback={<p>fallback</p>}>
        <Boom message="Cannot read properties of undefined" />
      </ErrorBoundary>,
    );

    expect(replace).not.toHaveBeenCalled();
    // Called, not called-once: ErrorBoundary reports each error to Sentry
    // twice today (directly, and again through logger.error). Pre-existing and
    // out of scope here, but worth knowing before reading issue counts.
    expect(captureException).toHaveBeenCalled();
    expect(screen.getByText('fallback')).toBeTruthy();
  });

  it('ignores an unhandled rejection, even one that mentions a module script', () => {
    // This is the case that reloaded working apps: a telemetry chunk failing
    // is a rejected promise, not a broken UI.
    installGlobalErrorHandlers();

    window.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), {
        reason: new Error('Importing a module script failed.'),
      }),
    );

    expect(replace).not.toHaveBeenCalled();
  });

  it('ignores an uncaught window error mentioning a module script', () => {
    installGlobalErrorHandlers();

    window.dispatchEvent(
      Object.assign(new Event('error'), {
        error: new Error('Importing a module script failed.'),
      }),
    );

    expect(replace).not.toHaveBeenCalled();
  });
});
