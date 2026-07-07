import { timingSafeEqual } from 'crypto';

export function constantTimeEqualSecret(provided: unknown, expected: string | undefined): boolean {
  if (typeof provided !== 'string' || !expected) return false;
  const providedBuffer = Buffer.from(provided.trim());
  const expectedBuffer = Buffer.from(expected.trim());
  if (expectedBuffer.length === 0) return false;
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export function isAdminSecret(value: unknown): boolean {
  return constantTimeEqualSecret(value, process.env.ADMIN_SECRET);
}