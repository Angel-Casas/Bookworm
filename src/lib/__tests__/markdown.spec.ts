import { describe, expect, it } from 'vitest'
import { escapeHtml, renderInline, renderMarkdown } from '../markdown'

describe('escaping', () => {
  it('neutralises every character that could open a tag', () => {
    expect(escapeHtml(`<script>alert("x")&'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;',
    )
  })

  it('escapes model output before any markup is added', () => {
    const html = renderMarkdown('A **bold** <img src=x onerror=alert(1)> claim')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
  })

  it('does not let a link or tag through inside a list item', () => {
    const html = renderMarkdown('- <a href="javascript:alert(1)">tap</a>')
    expect(html).not.toContain('<a ')
    expect(html).toContain('&lt;a href=')
  })

  it('leaves code spans literal', () => {
    expect(renderInline('use `<b>` for bold')).toBe('use <code>&lt;b&gt;</code> for bold')
  })
})

describe('inline', () => {
  it('renders strong and emphasis', () => {
    expect(renderInline('**very** and *quite* and _also_')).toBe(
      '<strong>very</strong> and <em>quite</em> and <em>also</em>',
    )
  })

  it('nests emphasis inside strong', () => {
    expect(renderInline('**a *b* c**')).toBe('<strong>a <em>b</em> c</strong>')
  })

  it('leaves a lone asterisk alone', () => {
    expect(renderInline('2 * 3 = 6')).toBe('2 * 3 = 6')
  })
})

describe('blocks', () => {
  it('renders a bullet list as a list, not a run-on line', () => {
    const html = renderMarkdown('Themes:\n- loss\n- memory\n- the sea')
    expect(html).toBe(
      '<p>Themes:</p><ul><li>loss</li><li>memory</li><li>the sea</li></ul>',
    )
  })

  it('renders a numbered list', () => {
    expect(renderMarkdown('1. first\n2. second')).toBe('<ol><li>first</li><li>second</li></ol>')
  })

  it('starts a new list when the kind changes', () => {
    const html = renderMarkdown('- a\n1. b')
    expect(html).toBe('<ul><li>a</li></ul><ol><li>b</li></ol>')
  })

  it('demotes headings so an answer cannot outrank the page', () => {
    expect(renderMarkdown('# Title')).toBe('<h3>Title</h3>')
    expect(renderMarkdown('#### Deep')).toBe('<h6>Deep</h6>')
  })

  it('renders a blockquote as one quote, not one per line', () => {
    expect(renderMarkdown('> she said\n> nothing at all')).toBe(
      '<blockquote><p>she said</p><p>nothing at all</p></blockquote>',
    )
  })

  it('keeps fenced code verbatim', () => {
    const html = renderMarkdown('```\n- not a list\n**not bold**\n```')
    expect(html).toBe('<pre><code>- not a list\n**not bold**</code></pre>')
  })

  it('joins wrapped lines into one paragraph and splits on a blank line', () => {
    expect(renderMarkdown('one\ntwo\n\nthree')).toBe('<p>one two</p><p>three</p>')
  })

  it('renders a horizontal rule', () => {
    expect(renderMarkdown('---')).toBe('<hr />')
  })

  it('closes everything an interrupted stream left open', () => {
    // Mid-stream the answer is a fragment; it must still be valid HTML.
    expect(renderMarkdown('- one\n- tw')).toBe('<ul><li>one</li><li>tw</li></ul>')
    expect(renderMarkdown('```\nhalf a fence')).toBe('<pre><code>half a fence</code></pre>')
    expect(renderMarkdown('**unclosed')).toBe('<p>**unclosed</p>')
  })

  it('renders nothing for nothing', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown('   \n  \n')).toBe('')
  })
})

describe('citations travelling through the renderer', () => {
  // The chat swaps each citation for a private-use placeholder so the sentence
  // stays whole through a BLOCK renderer, then swaps a button back in. If the
  // placeholder disturbed the parse, a full stop after a citation would end up
  // as a paragraph of its own — which is exactly what rendering the runs
  // separately used to do.
  const OPEN = '\uE000'
  const CLOSE = '\uE001'

  it('keeps a sentence whole around a citation', () => {
    const html = renderMarkdown(`Two threads run here ${OPEN}0${CLOSE}. The second is quieter.`)
    expect(html).toBe(`<p>Two threads run here ${OPEN}0${CLOSE}. The second is quieter.</p>`)
    expect(html.split('<p>')).toHaveLength(2)
  })

  it('leaves the placeholder intact inside a list item', () => {
    expect(renderMarkdown(`- the lamp ${OPEN}1${CLOSE}`)).toBe(
      `<ul><li>the lamp ${OPEN}1${CLOSE}</li></ul>`,
    )
  })

  it('does not escape or mangle the placeholder characters', () => {
    const html = renderMarkdown(`${OPEN}0${CLOSE}`)
    expect(html).toContain(OPEN)
    expect(html).toContain(CLOSE)
  })
})
