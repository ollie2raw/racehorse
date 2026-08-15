import type { ReactNode } from 'react';

export function formatGhostName(rawName: string): string {
  const cleaned = rawName
    .replace(/'s Ghost/gi, '')
    .replace(/ Ghost/gi, '')
    .replace(/^@/, '')
    .trim();
  const capitalized = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return `@${capitalized}`;
}

export function renderScoreToastMessage(message: string): ReactNode {
  const turnMatch = message.match(/Turn\s+(\d+)/i);
  const pointsMatch = message.match(/\+\d+/);
  if (!pointsMatch || typeof pointsMatch.index !== 'number') {
    if (turnMatch && typeof turnMatch.index === 'number') {
      const start = turnMatch.index;
      const end = start + turnMatch[0].length;
      return (
        <>
          {message.slice(0, start)}
          <span className="rh-score-toast-emphasis">{turnMatch[0]}</span>
          {message.slice(end)}
        </>
      );
    }
    return message;
  }
  const start = pointsMatch.index;
  const end = start + pointsMatch[0].length;
  return (
    <>
      {message.slice(0, start)}
      <span className="rh-score-toast-emphasis">{pointsMatch[0]}</span>
      {message.slice(end)}
    </>
  );
}
