import { describe, it, expect } from 'vitest';
import { parseSSE } from './parseSSE';

describe('parseSSE', () => {
  it('returns no events and no remainder on empty input', () => {
    expect(parseSSE('', '')).toEqual({ events: [], remainder: '' });
  });

  it('parses one complete data event', () => {
    const r = parseSSE('data: {"a":1}\n\n', '');
    expect(r.events).toEqual([{ kind: 'data', data: '{"a":1}' }]);
    expect(r.remainder).toBe('');
  });

  it('parses multiple events in one chunk', () => {
    const r = parseSSE('data: a\n\ndata: b\n\n', '');
    expect(r.events).toEqual([
      { kind: 'data', data: 'a' },
      { kind: 'data', data: 'b' },
    ]);
  });

  it('emits done sentinel for [DONE]', () => {
    const r = parseSSE('data: [DONE]\n\n', '');
    expect(r.events).toEqual([{ kind: 'done' }]);
  });

  it('tolerates \\r\\n line endings', () => {
    const r = parseSSE('data: x\r\n\r\n', '');
    expect(r.events).toEqual([{ kind: 'data', data: 'x' }]);
  });

  it('skips comment lines beginning with :', () => {
    const r = parseSSE(':keep-alive\n\ndata: x\n\n', '');
    expect(r.events).toEqual([{ kind: 'data', data: 'x' }]);
  });

  it('joins multi-line data fields', () => {
    const r = parseSSE('data: line1\ndata: line2\n\n', '');
    expect(r.events).toEqual([{ kind: 'data', data: 'line1\nline2' }]);
  });

  it('returns remainder for partial last event', () => {
    const r = parseSSE('data: complete\n\ndata: parti', '');
    expect(r.events).toEqual([{ kind: 'data', data: 'complete' }]);
    expect(r.remainder).toBe('data: parti');
  });

  it('reattaches buffered remainder', () => {
    const r1 = parseSSE('data: par', '');
    expect(r1.events).toEqual([]);
    const r2 = parseSSE('tial\n\n', r1.remainder);
    expect(r2.events).toEqual([{ kind: 'data', data: 'partial' }]);
  });

  it('ignores unknown field types (event:, id:, retry:)', () => {
    const r = parseSSE('event: ping\nid: 1\nretry: 100\ndata: payload\n\n', '');
    expect(r.events).toEqual([{ kind: 'data', data: 'payload' }]);
  });

  it('handles a chunk that splits on the terminator', () => {
    const r1 = parseSSE('data: x\n', '');
    expect(r1.events).toEqual([]);
    const r2 = parseSSE('\n', r1.remainder);
    expect(r2.events).toEqual([{ kind: 'data', data: 'x' }]);
  });
});
