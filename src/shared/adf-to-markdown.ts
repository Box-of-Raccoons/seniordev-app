import type { AdfNode } from './types'

function safeUrl(raw: unknown): string {
  const url = String(raw ?? '').trim()
  return /^(https?:|mailto:)/i.test(url) ? url : ''
}

function applyMarks(text: string, marks: AdfNode['marks']): string {
  let out = text
  for (const m of marks ?? []) {
    switch (m.type) {
      case 'strong': out = `**${out}**`; break
      case 'em': out = `*${out}*`; break
      case 'code': out = `\`${out}\``; break
      case 'strike': out = `~~${out}~~`; break
      case 'link': {
        const href = safeUrl(m.attrs?.href)
        out = href ? `[${out}](${href})` : out
        break
      }
    }
  }
  return out
}

function inlineToMd(nodes: AdfNode[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === 'text') return applyMarks(n.text ?? '', n.marks)
      if (n.type === 'hardBreak') return '\n'
      if (n.type === 'emoji') return String(n.attrs?.text ?? n.attrs?.shortName ?? '')
      if (n.type === 'mention') return `@${String(n.attrs?.text ?? n.attrs?.id ?? '')}`
      return inlineToMd(n.content)
    })
    .join('')
}

function nodeToMd(node: AdfNode): string {
  switch (node.type) {
    case 'paragraph': return inlineToMd(node.content)
    case 'heading': {
      const lvl = Number(node.attrs?.level)
      const level = Number.isFinite(lvl) ? Math.min(Math.max(lvl, 1), 6) : 1
      return `${'#'.repeat(level)} ${inlineToMd(node.content)}`
    }
    case 'bulletList':
      return (node.content ?? []).map((li) => `- ${inlineToMd(li.content).trim()}`).join('\n')
    case 'orderedList':
      return (node.content ?? []).map((li, i) => `${i + 1}. ${inlineToMd(li.content).trim()}`).join('\n')
    case 'blockquote':
      return blockToMd(node.content).split('\n').map((l) => `> ${l}`).join('\n')
    case 'codeBlock': {
      const lang = String(node.attrs?.language ?? '')
      return '```' + lang + '\n' + inlineToMd(node.content) + '\n```'
    }
    case 'rule': return '---'
    case 'panel': return blockToMd(node.content)
    default: return inlineToMd(node.content)
  }
}

function blockToMd(nodes: AdfNode[] | undefined): string {
  return (nodes ?? []).map(nodeToMd).join('\n\n')
}

export function adfToMarkdown(doc: AdfNode | null): string {
  if (!doc) return ''
  if (doc.type === 'doc') return blockToMd(doc.content)
  return nodeToMd(doc)
}
