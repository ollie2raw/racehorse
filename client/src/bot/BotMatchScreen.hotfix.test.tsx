import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BotMatchScreen from './BotMatchScreen';

const {
  useBotMatchScreenController,
  preloadLessonV2ForBotMatch,
  isLessonV2Preloaded,
} = vi.hoisted(() => ({
  useBotMatchScreenController: vi.fn(() => ({ mocked: true })),
  preloadLessonV2ForBotMatch: vi.fn<() => Promise<void>>(),
  isLessonV2Preloaded: vi.fn(() => false),
}));

vi.mock('./useBotMatchScreenController', () => ({
  useBotMatchScreenController,
}));

vi.mock('./BotMatchScreenView', () => ({
  BotMatchScreenView: () => <div>bot match ready</div>,
}));

vi.mock('../modules/match/bootstrap/lessonV2LazyRegistry.ts', () => ({
  preloadLessonV2ForBotMatch,
  isLessonV2Preloaded,
}));

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    onBack: vi.fn(),
    dealSize: 7 as const,
    mode: 'bot' as const,
    ...overrides,
  };
}

function deferredPromise() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('BotMatchScreen lesson V2 hotfix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isLessonV2Preloaded.mockReturnValue(false);
  });

  it('waits for lesson V2 preload before rendering guided V2 match content', async () => {
    const deferred = deferredPromise();
    preloadLessonV2ForBotMatch.mockReturnValue(deferred.promise);

    render(<BotMatchScreen {...makeProps({ isGuidedV2Mode: true })} />);

    expect(screen.getByText('Loading lesson…')).toBeInTheDocument();
    expect(useBotMatchScreenController).not.toHaveBeenCalled();

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
    });

    expect(screen.getByText('bot match ready')).toBeInTheDocument();
    expect(useBotMatchScreenController).toHaveBeenCalledTimes(1);
  });

  it('treats the default bot route as needing lesson V2 even when mode prop is omitted', async () => {
    const deferred = deferredPromise();
    preloadLessonV2ForBotMatch.mockReturnValue(deferred.promise);

    render(<BotMatchScreen {...makeProps({ mode: undefined, isGuidedV2Mode: true })} />);

    expect(screen.getByText('Loading lesson…')).toBeInTheDocument();
    expect(useBotMatchScreenController).not.toHaveBeenCalled();

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
    });

    expect(screen.getByText('bot match ready')).toBeInTheDocument();
  });

  it('re-enters the loading gate when a live bot screen switches into guided V2 mode', async () => {
    preloadLessonV2ForBotMatch.mockResolvedValue();

    const { rerender } = render(<BotMatchScreen {...makeProps()} />);
    expect(screen.getByText('bot match ready')).toBeInTheDocument();
    expect(useBotMatchScreenController).toHaveBeenCalledTimes(1);

    const deferred = deferredPromise();
    preloadLessonV2ForBotMatch.mockReturnValueOnce(deferred.promise);

    rerender(<BotMatchScreen {...makeProps({ isGuidedV2Mode: true })} />);

    expect(screen.getByText('Loading lesson…')).toBeInTheDocument();
    expect(useBotMatchScreenController).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
    });

    expect(screen.getByText('bot match ready')).toBeInTheDocument();
    expect(useBotMatchScreenController).toHaveBeenCalledTimes(2);
  });

  it('shows a recoverable guided lesson error instead of throwing through the boundary', async () => {
    preloadLessonV2ForBotMatch.mockRejectedValue(new Error('lesson chunk failed'));

    render(<BotMatchScreen {...makeProps({ isGuidedV2Mode: true })} />);

    expect(await screen.findByText('Lesson not available')).toBeInTheDocument();
    expect(screen.getByText('lesson chunk failed')).toBeInTheDocument();
    expect(useBotMatchScreenController).not.toHaveBeenCalled();
  });
});
