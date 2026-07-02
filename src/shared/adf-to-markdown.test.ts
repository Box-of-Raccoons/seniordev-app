import { describe, it, expect } from 'vitest'
import { adfToMarkdown } from './adf-to-markdown'
import type { AdfNode } from './types'

const doc = (content: AdfNode[]): AdfNode => ({ type: 'doc', content })

describe('adfToMarkdown', () => {
  it('returns empty for null', () => {
    expect(adfToMarkdown(null)).toBe('')
  })
  it('renders paragraphs, bold, and links (safe scheme)', () => {
    const md = adfToMarkdown(doc([
      { type: 'paragraph', content: [
        { type: 'text', text: 'hi ' },
        { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
        { type: 'text', text: ' site', marks: [{ type: 'link', attrs: { href: 'https://x.io' } }] }
      ] }
    ]))
    // The link's leading space is part of its text node, so it lands inside the brackets.
    expect(md).toBe('hi **bold**[ site](https://x.io)')
  })
  it('drops javascript: links to plain text', () => {
    const md = adfToMarkdown(doc([
      { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }
    ]))
    expect(md).toBe('x')
    expect(md).not.toContain('javascript:')
  })
  it('renders headings, bullet lists, and code blocks', () => {
    const md = adfToMarkdown(doc([
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] }
      ] },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const x = 1' }] }
    ]))
    expect(md).toContain('## Title')
    expect(md).toContain('- a\n- b')
    expect(md).toContain('```ts\nconst x = 1\n```')
  })
})
