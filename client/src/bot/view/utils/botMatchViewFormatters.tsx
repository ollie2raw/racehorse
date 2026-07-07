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
  const pointsMatch = message.match(/\+\d+/);
  if (!pointsMatch || typeof pointsMatch.index !== 'number') return message;
  const start = pointsMatch.index;
  const end = start + pointsMatch[0].length;
  return (
    <>
      {message.slice(0, start)}
      <span
        style={{
          fontSize: '1.48rem',
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: '0.01em',
          display: 'inline-block',
          margin: '0 2px',
        }}
      >
        {pointsMatch[0]}
      </span>
      {message.slice(end)}
    </>
  );
}