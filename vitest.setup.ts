// Root-level vitest setup: only apply DOM-specific setup when running in jsdom
if (typeof window !== 'undefined') {
  // Dynamically import client setup so it only runs under jsdom
  await import('./client/src/test/setup.ts');
}
