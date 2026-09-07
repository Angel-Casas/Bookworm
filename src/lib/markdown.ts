/**
 * A small markdown renderer for what a chat model actually emits.
 *
 * Deliberately not a full parser. Bookworm has no backend and no server-side
 * sanitising step, so every character that reaches the DOM has to be either
 * escaped by us or emitted by us — a general parser plus a sanitiser is a much
 * larger surface to trust for headings, emphasis, lists, quotes and code.
 *
 * The rule this file lives by: escape the source FIRST, then only ever add
 * tags from a fixed set. No input can become markup by accident.
 */

export interface InlineToken {
  kind: 'text' | 'code' | 'strong' | 'em'
  text: string
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Make a string safe to place in HTML. Always the first thing that happens. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character)
}

/**
 * Inline spans: `code`, **strong**, *em* / _em_. Code wins over everything
 * inside it, which is why it is matched first and its content never re-scanned.
 */
export function renderInline(source: string): string {
  const out: string[] = []
  let rest = source
  for (;;) {
    const match = /(`+)([\s\S]*?)\1|\*\*([\s\S]+?)\*\*|\*([^*\n]+?)\*|_([^_\n]+?)_/.exec(rest)
    if (!match || match.index === undefined) break
    out.push(escapeHtml(rest.slice(0, match.index)))
    if (match[2] !== undefined) out.push(`<code>${escapeHtml(match[2].trim())}</code>`)
    else if (match[3] !== undefined) out.push(`<strong>${renderInline(match[3])}</strong>`)
    else if (match[4] !== undefined) out.push(`<em>${renderInline(match[4])}</em>`)
    else if (match[5] !== undefined) out.push(`<em>${renderInline(match[5])}</em>`)
    rest = rest.slice(match.index + match[0].length)
  }
  out.push(escapeHtml(rest))
  return out.join('')
}

type ListKind = 'ul' | 'ol'

/**
 * Render a markdown block into HTML: headings (#..###), fenced and indented
 * code, bullet and numbered lists, blockquotes, horizontal rules, paragraphs.
 * Anything unrecognised stays literal text — never markup.
 */
export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let list: ListKind | null = null
  let quote = false
  let paragraph: string[] = []
  let fence: string | null = null
  let code: string[] = []

  const closeParagraph = (): void => {
    if (paragraph.length === 0) return
    out.push(`<p>${renderInline(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  const closeList = (): void => {
    if (!list) return
    out.push(`</${list}>`)
    list = null
  }
  const closeQuote = (): void => {
    if (!quote) return
    out.push('</blockquote>')
    quote = false
  }
  const closeAll = (): void => {
    closeParagraph()
    closeList()
    closeQuote()
  }

  for (const line of lines) {
    // ——— fenced code: everything inside is literal ———
    const fenceMark = /^\s*(```|~~~)/.exec(line)
    if (fence !== null) {
      if (fenceMark && line.trim().startsWith(fence)) {
        out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
        code = []
        fence = null
      } else {
        code.push(line)
      }
      continue
    }
    if (fenceMark) {
      closeAll()
      fence = fenceMark[1] ?? '```'
      continue
    }

    if (line.trim().length === 0) {
      closeAll()
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      closeAll()
      // Models love a heading; cap the level so an answer can never outrank
      // the page's own headings in the document outline.
      const level = Math.min(6, Math.max(3, (heading[1] ?? '#').length + 2))
      out.push(`<h${level}>${renderInline((heading[2] ?? '').trim())}</h${level}>`)
      continue
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      closeAll()
      out.push('<hr />')
      continue
    }

    const quoted = /^\s*>\s?(.*)$/.exec(line)
    if (quoted) {
      closeParagraph()
      closeList()
      if (!quote) {
        out.push('<blockquote>')
        quote = true
      }
      out.push(`<p>${renderInline(quoted[1] ?? '')}</p>`)
      continue
    }
    closeQuote()

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || numbered) {
      closeParagraph()
      const kind: ListKind = bullet ? 'ul' : 'ol'
      if (list !== kind) {
        closeList()
        out.push(`<${kind}>`)
        list = kind
      }
      out.push(`<li>${renderInline((bullet ?? numbered)?.[1] ?? '')}</li>`)
      continue
    }
    closeList()

    paragraph.push(line.trim())
  }

  // An answer cut off mid-stream leaves things open; close them all.
  if (fence !== null && code.length > 0) {
    out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
  }
  closeAll()
  return out.join('')
}
