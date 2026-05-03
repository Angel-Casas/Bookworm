import { describe, it, expect } from 'vitest';
import { IsoTimestamp, type IsoTimestamp as IsoTimestampType } from '@/domain';
import { relativeTime } from './relativeTime';

const NOW = new Date('2026-05-03T12:00:00.000Z').getTime();

function ts(offsetMs: number): IsoTimestampType {
  return IsoTimestamp(new Date(NOW - offsetMs).toISOString());
}

describe('relativeTime', () => {
  it('"just now" for <60s', () => {
    expect(relativeTime(ts(0), NOW)).toBe('just now');
    expect(relativeTime(ts(59_000), NOW)).toBe('just now');
  });

  it('"Nm ago" for <1h', () => {
    expect(relativeTime(ts(60_000), NOW)).toBe('1m ago');
    expect(relativeTime(ts(45 * 60_000), NOW)).toBe('45m ago');
  });

  it('"Nh ago" for <24h', () => {
    expect(relativeTime(ts(60 * 60_000), NOW)).toBe('1h ago');
    expect(relativeTime(ts(23 * 60 * 60_000), NOW)).toBe('23h ago');
  });

  it('"yesterday" for 24-48h', () => {
    expect(relativeTime(ts(24 * 60 * 60_000), NOW)).toBe('yesterday');
    expect(relativeTime(ts(47 * 60 * 60_000), NOW)).toBe('yesterday');
  });

  it('"Nd ago" for 2-7d', () => {
    expect(relativeTime(ts(2 * 24 * 60 * 60_000), NOW)).toBe('2d ago');
    expect(relativeTime(ts(6 * 24 * 60 * 60_000), NOW)).toBe('6d ago');
  });

  it('absolute date for ≥7d', () => {
    expect(relativeTime(ts(8 * 24 * 60 * 60_000), NOW)).toMatch(/Apr|2026/);
  });

  it('handles future timestamps as "just now"', () => {
    expect(relativeTime(ts(-1000), NOW)).toBe('just now');
  });
});
