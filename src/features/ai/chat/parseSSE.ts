export type ParsedSSEEvent =
  | { readonly kind: 'data'; readonly data: string }
  | { readonly kind: 'done' };

export type SSEParseResult = {
  readonly events: readonly ParsedSSEEvent[];
  readonly remainder: string;
};

export function parseSSE(chunk: string, buffered: string): SSEParseResult {
  const text = (buffered + chunk).replace(/\r\n/g, '\n');
  const events: ParsedSSEEvent[] = [];
  let cursor = 0;

  for (;;) {
    const sep = text.indexOf('\n\n', cursor);
    if (sep < 0) break;
    const block = text.slice(cursor, sep);
    cursor = sep + 2;

    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line === '') continue;
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const field = line.slice(0, colon);
      let value = line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') dataLines.push(value);
    }

    if (dataLines.length === 0) continue;
    const joined = dataLines.join('\n');
    if (joined === '[DONE]') {
      events.push({ kind: 'done' });
    } else {
      events.push({ kind: 'data', data: joined });
    }
  }

  return { events, remainder: text.slice(cursor) };
}
