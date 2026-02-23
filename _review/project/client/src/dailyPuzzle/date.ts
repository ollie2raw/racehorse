const pad = (n: number) => String(n).padStart(2, "0");

export function getLocalDateKey(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function normalizeDateInputToLocalKey(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return getLocalDateKey();

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const localDate = new Date(year, monthIndex, day);
  if (Number.isNaN(localDate.getTime())) return getLocalDateKey();
  return getLocalDateKey(localDate);
}
