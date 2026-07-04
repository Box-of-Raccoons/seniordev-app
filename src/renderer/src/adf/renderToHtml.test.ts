import { describe, it, expect } from 'vitest'
import { renderAdfToHtml } from './renderToHtml'
import type { AdfNode } from '../../../shared/types'

const doc = (content: AdfNode[]): AdfNode => ({ type: 'doc', content })

describe('renderAdfToHtml', () => {
  it('returns empty string for null', () => {
    expect(renderAdfToHtml(null)).toBe('')
  })

  it('renders a paragraph with strong and link marks', () => {
    const html = renderAdfToHtml(
      doc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'hi ' },
            { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
            { type: 'text', text: ' link', marks: [{ type: 'link', attrs: { href: 'https://x.io' } }] }
          ]
        }
      ])
    )
    expect(html).toContain('<p>hi <strong>bold</strong>')
    expect(html).toContain('<a href="https://x.io" target="_blank" rel="noreferrer noopener"> link</a>')
  })

  it('escapes HTML in text and code blocks', () => {
    const html = renderAdfToHtml(
      doc([
        { type: 'codeBlock', content: [{ type: 'text', text: '<script>alert(1)</script>' }] }
      ])
    )
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('renders headings, lists, and panels', () => {
    const html = renderAdfToHtml(
      doc([
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'bulletList', content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] }
        ] },
        { type: 'panel', attrs: { panelType: 'warning' }, content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'careful' }] }
        ] }
      ])
    )
    expect(html).toContain('<h2>Title</h2>')
    expect(html).toContain('<ul><li><p>a</p></li></ul>')
    expect(html).toContain('adf-panel--warning')
  })

  it('neutralizes javascript: and data: schemes in link hrefs', () => {
    const html = renderAdfToHtml(
      doc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }
          ]
        }
      ])
    )
    expect(html).not.toContain('javascript:')
    expect(html).toContain('<a href="#"')
  })

  it('neutralizes an unsafe inlineCard url but still shows the text', () => {
    const html = renderAdfToHtml(doc([{ type: 'inlineCard', attrs: { url: 'data:text/html,<script>' } }]))
    expect(html).toContain('href="#"')
    expect(html).not.toContain('href="data:')
  })

  it('renders a malformed heading level as h1', () => {
    const html = renderAdfToHtml(
      doc([{ type: 'heading', attrs: { level: 'x' }, content: [{ type: 'text', text: 'T' }] }])
    )
    expect(html).toContain('<h1>T</h1>')
    expect(html).not.toContain('hNaN')
  })

  it('rounds a fractional heading level instead of emitting <h2.5> (SD-9 low #5)', () => {
    const html = renderAdfToHtml(
      doc([{ type: 'heading', attrs: { level: 2.5 }, content: [{ type: 'text', text: 'T' }] }])
    )
    expect(html).toContain('<h3>T</h3>') // 2.5 rounds to 3
    expect(html).not.toContain('h2.5')
  })

  it('falls back to rendering children for unknown node types', () => {
    const html = renderAdfToHtml(
      doc([{ type: 'someFutureNode', content: [{ type: 'text', text: 'still shown' }] }])
    )
    expect(html).toContain('still shown')
  })
})
