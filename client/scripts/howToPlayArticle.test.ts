/**
 * Guards the How to Play article.
 *
 * The page this replaced served ~80 words, which is why it ranked behind
 * hobbyist pages from 2001 (growth assessment, Phase 1 item 1). The
 * assertions below are about substance and accuracy, so a future edit cannot
 * quietly hollow it back out or contradict the engine.
 */
import { describe, it, expect } from 'vitest';
import { HOW_TO_PLAY_ARTICLE as article } from '../src/learn/howToPlay/howToPlayArticleContent.mjs';

const words = (text: string) => text.trim().split(/\s+/).length;

const allText = [
  article.standfirst,
  ...article.sections.flatMap((section) => [section.heading, ...section.paragraphs]),
].join(' ');

describe('how to play article', () => {
  it('is genuinely long-form', () => {
    // The report asks for 800+; falling under that is the regression.
    expect(words(allText)).toBeGreaterThan(800);
  });

  it('is broken into scannable sections with real headings', () => {
    expect(article.sections.length).toBeGreaterThanOrEqual(6);
    for (const section of article.sections) {
      expect(section.heading.length).toBeGreaterThan(0);
      expect(section.paragraphs.length).toBeGreaterThan(0);
      // A heading with one thin paragraph under it is not a section.
      expect(words(section.paragraphs.join(' '))).toBeGreaterThan(30);
    }
  });

  it('gives every section a unique anchor for the contents list', () => {
    const ids = article.sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('states the rules this variant actually uses', () => {
    // Each of these is a number or rule taken from the engine, not from
    // generic dominoes. If the engine changes, this page has to change too.
    expect(allText).toContain('double-six');
    expect(allText).toContain('seven tiles');
    expect(allText).toMatch(/60 points|race to 60/);
    expect(allText).toMatch(/multiple of five/);
    expect(allText).toMatch(/divided by five/);
    expect(allText).toMatch(/under 30/);          // the skunk threshold
    expect(allText).toMatch(/best-of-three/);     // the Daily Fritz set
    expect(allText).toMatch(/cannot be a double/); // the go-out restriction
  });

  it('reads as prose rather than keyword filler', () => {
    // Naming the product on every other line is the failure mode the brief
    // warned about; a handful of mentions across 1200 words is normal.
    const mentions = (allText.match(/Racehorse/g) ?? []).length;
    expect(mentions).toBeLessThan(words(allText) / 100);
  });
});
