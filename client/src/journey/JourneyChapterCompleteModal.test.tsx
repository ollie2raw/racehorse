// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JourneyChapterCompleteModal } from './JourneyChapterCompleteModal';
import {
  getJourneyChapterById,
  getVisibleJourneyChapterDefinitions,
  isFinalVisibleJourneyChapter,
} from './journeyChapters';

const chapterOne = () => getJourneyChapterById('ch1-fritz-trail')!;
const chapterTwo = () => getJourneyChapterById('ch2-high-line')!;

describe('the chapter-complete dialog', () => {
  it('after the last chapter a player can reach, offers somewhere real to go and a way back, not a button that only closes', () => {
    const onClose = vi.fn();
    const onPlayFritz = vi.fn();
    render(<JourneyChapterCompleteModal open chapter={chapterOne()} onClose={onClose} isFinalChapter onPlayFritz={onPlayFritz} />);

    expect(screen.queryByRole('button', { name: 'Continue the Journey' })).toBeNull();
    act(() => screen.getByRole('button', { name: 'Play Fritz' }).click());
    expect(onPlayFritz).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    act(() => screen.getByRole('button', { name: 'Back to the trail' }).click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps "Continue the Journey" when another chapter follows, and when there is nowhere to send the player', () => {
    const onClose = vi.fn();
    const { rerender } = render(<JourneyChapterCompleteModal open chapter={chapterOne()} onClose={onClose} onPlayFritz={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Continue the Journey' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Play Fritz' })).toBeNull();

    rerender(<JourneyChapterCompleteModal open chapter={chapterOne()} onClose={onClose} isFinalChapter />);
    act(() => screen.getByRole('button', { name: 'Continue the Journey' }).click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the chapter reward and a closing line that is true after clearing the trail', () => {
    render(<JourneyChapterCompleteModal open chapter={chapterOne()} onClose={vi.fn()} isFinalChapter onPlayFritz={vi.fn()} />);
    expect(screen.getByText('Fritz Trail Conqueror')).toBeTruthy();
    expect(screen.getByText('More chapters of Racehorse Journey are on the way.')).toBeTruthy();
    expect(screen.queryByText(/reveal the next chapter/i)).toBeNull();
  });

  it('renders nothing without a chapter', () => {
    const { container } = render(<JourneyChapterCompleteModal open chapter={null} onClose={vi.fn()} />);
    expect(container.textContent).toBe('');
  });
});

describe('which chapter is the last one a player can reach', () => {
  it('is exactly the last visible chapter, and never a hidden one', () => {
    const visible = getVisibleJourneyChapterDefinitions();
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.filter(isFinalVisibleJourneyChapter).map((chapter) => chapter.chapterId)).toEqual([visible[visible.length - 1]!.chapterId]);
    // Today only Chapter One is visible (Chapters 2-6 are held back), so it is the final one; this changes, on purpose, when a second chapter ships.
    expect(visible.map((chapter) => chapter.chapterNumber)).toEqual([1]);
    expect(isFinalVisibleJourneyChapter(chapterOne())).toBe(true);
    expect(isFinalVisibleJourneyChapter(chapterTwo())).toBe(false);
  });
});

describe('copy that is shown both before and after a chapter is cleared', () => {
  it('never promises that clearing the final reachable chapter reveals another one', () => {
    for (const chapter of getVisibleJourneyChapterDefinitions().filter(isFinalVisibleJourneyChapter)) {
      expect(chapter.nextChapterCopy).not.toMatch(/reveal/i);
      expect(chapter.nextChapterCopy.trim().length).toBeGreaterThan(0);
    }
  });
});
