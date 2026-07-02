import type { AdfNode } from '../../../shared/types'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderMarks(text: string, marks: AdfNode['marks']): string {
  let html = esc(text)
  for (const m of marks ?? []) {
    switch (m.type) {
      case 'strong': html = `<strong>${html}</strong>`; break
      case 'em': html = `<em>${html}</em>`; break
      case 'code': html = `<code>${html}</code>`; break
      case 'strike': html = `<s>${html}</s>`; break
      case 'underline': html = `<u>${html}</u>`; break
      case 'link': {
        const href = esc(String(m.attrs?.href ?? '#'))
        html = `<a href="${href}" target="_blank" rel="noreferrer noopener">${html}</a>`
        break
      }
    }
  }
  return html
}

function renderNodes(nodes: AdfNode[] | undefined): string {
  return (nodes ?? []).map(renderNode).join('')
}

function renderNode(node: AdfNode): string {
  switch (node.type) {
    case 'doc': return renderNodes(node.content)
    case 'paragraph': return `<p>${renderNodes(node.content)}</p>`
    case 'text': return renderMarks(node.text ?? '', node.marks)
    case 'hardBreak': return '<br>'
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6)
      return `<h${level}>${renderNodes(node.content)}</h${level}>`
    }
    case 'bulletList': return `<ul>${renderNodes(node.content)}</ul>`
    case 'orderedList': return `<ol>${renderNodes(node.content)}</ol>`
    case 'listItem': return `<li>${renderNodes(node.content)}</li>`
    case 'blockquote': return `<blockquote>${renderNodes(node.content)}</blockquote>`
    case 'rule': return '<hr>'
    case 'codeBlock': return `<pre><code>${renderNodes(node.content)}</code></pre>`
    case 'panel': {
      const type = esc(String(node.attrs?.panelType ?? 'info'))
      return `<div class="adf-panel adf-panel--${type}">${renderNodes(node.content)}</div>`
    }
    case 'table': return `<table>${renderNodes(node.content)}</table>`
    case 'tableRow': return `<tr>${renderNodes(node.content)}</tr>`
    case 'tableHeader': return `<th>${renderNodes(node.content)}</th>`
    case 'tableCell': return `<td>${renderNodes(node.content)}</td>`
    case 'mention':
      return `<span class="adf-mention">@${esc(String(node.attrs?.text ?? node.attrs?.id ?? ''))}</span>`
    case 'emoji':
      return esc(String(node.attrs?.text ?? node.attrs?.shortName ?? ''))
    case 'inlineCard': {
      const url = esc(String(node.attrs?.url ?? '#'))
      return `<a href="${url}" target="_blank" rel="noreferrer noopener">${url}</a>`
    }
    case 'mediaSingle':
    case 'mediaGroup':
    case 'media':
      return `<div class="adf-media">[media]</div>`
    default:
      return renderNodes(node.content)
  }
}

export function renderAdfToHtml(doc: AdfNode | null): string {
  if (!doc) return ''
  return renderNode(doc)
}
