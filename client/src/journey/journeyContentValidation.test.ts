// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  formatJourneyContentSummary,
  formatJourneyContentValidationErrors,
  formatJourneyContentValidationReport,
  summarizeJourneyContent,
  validateJourneyContent,
} from './journeyContentValidation';

describe('summarizeJourneyContent', () => {
  it('returns chapter and node counts for shipped content', () => {
    const summary = summarizeJourneyContent();
    expect(summary.chapterCount).toBeGreaterThan(0);
    expect(summary.totalNodeCount).toBeGreaterThan(0);
    expect(summary.chapters.every((chapter) => chapter.nodeCount >= 0)).toBe(true);
    expect(summary.puzzleAnswerDistribution.totalPuzzles).toBeGreaterThan(0);
  });
});

describe('formatJourneyContentSummary', () => {
  it('includes chapter lines and trial format totals', () => {
    const summary = summarizeJourneyContent();
    const text = formatJourneyContentSummary(summary);
    expect(text).toContain('Journey content summary');
    expect(text).toContain('Per chapter:');
    expect(text).toContain('Trial formats:');
    expect(text).toContain('Puzzle answer distribution');
  });
});

describe('formatJourneyContentValidationErrors', () => {
  it('prefixes each error with a bullet', () => {
    const text = formatJourneyContentValidationErrors(['first issue', 'second issue']);
    expect(text).toBe(
      'Journey content validation failed:\n- first issue\n- second issue',
    );
  });
});

describe('validateJourneyContent', () => {
  it('passes on the current journey registry', () => {
    const result = validateJourneyContent();
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.summary.chapterCount).toBeGreaterThan(0);
  });

  it('renders a passing report with summary and success line', () => {
    const result = validateJourneyContent();
    const report = formatJourneyContentValidationReport(result);
    expect(report).toContain('Journey content validation passed.');
    expect(report).toContain('Journey content summary');
  });
});