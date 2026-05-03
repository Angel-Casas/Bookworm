import type { IsoTimestamp } from '@/domain';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function relativeTime(timestamp: IsoTimestamp, nowMs: number = Date.now()): string {
  const then = new Date(timestamp).getTime();
  const diff = nowMs - then;
  if (diff < MIN) return 'just now';
  if (diff < HOUR) return `${String(Math.floor(diff / MIN))}m ago`;
  if (diff < DAY) return `${String(Math.floor(diff / HOUR))}h ago`;
  if (diff < 2 * DAY) return 'yesterday';
  if (diff < WEEK) return `${String(Math.floor(diff / DAY))}d ago`;
  const date = new Date(then);
  const now = new Date(nowMs);
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
