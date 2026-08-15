export function makeCode(len = 4): string {
  return Math.random().toString(36).slice(2, 2 + len).toUpperCase();
}
