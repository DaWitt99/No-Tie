import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { $node, $remark } from '@milkdown/kit/utils'
import type { Note, NoteAsset } from './types'
import { resolveWikiTarget } from './knowledge'

type MarkdownNode = {
  type: string
  value?: string
  children?: MarkdownNode[]
  target?: string
  data?: Record<string, unknown>
  [key: string]: unknown
}

function transformEmbeds(node: MarkdownNode) {
  if (!node.children) return
  const transformed: MarkdownNode[] = []
  for (const child of node.children) {
    if (child.type === 'paragraph' && child.children?.length === 1 && child.children[0]?.type === 'text') {
      const value = child.children[0].value ?? ''
      const pattern = /!\[\[([^\]\n]+)\]\]/g
      let offset = 0
      let match: RegExpExecArray | null
      let replaced = false
      while ((match = pattern.exec(value))) {
        replaced = true
        const before = value.slice(offset, match.index).trim()
        if (before) transformed.push({ ...child, children: [{ type: 'text', value: before }] })
        transformed.push({ type: 'noTieEmbed', target: match[1]?.trim() ?? '' })
        offset = match.index + match[0].length
      }
      if (replaced) {
        const after = value.slice(offset).trim()
        if (after) transformed.push({ ...child, children: [{ type: 'text', value: after }] })
        continue
      }
    }
    transformEmbeds(child)
    transformed.push(child)
  }
  node.children = transformed
}

export const noteEmbedNode = $node('noTieEmbed', () => ({
  group: 'block',
  atom: true,
  selectable: true,
  attrs: { target: { default: '' } },
  parseDOM: [{ tag: 'div[data-no-tie-embed]', getAttrs: (dom: HTMLElement) => ({ target: dom.dataset.noTieEmbed ?? '' }) }],
  toDOM: node => ['div', { class: 'no-tie-embed-node', 'data-no-tie-embed': node.attrs.target }],
  parseMarkdown: {
    match: node => node.type === 'noTieEmbed',
    runner: (state, node, type) => state.addNode(type, { target: String(node.target ?? '') }),
  },
  toMarkdown: {
    match: node => node.type.name === 'noTieEmbed',
    runner: (state, node) => state.addNode('text', undefined, `![[${String(node.attrs.target ?? '')}]]`),
  },
}))

const noteEmbedRemark = $remark('noTieNoteEmbeds', () => () => tree => transformEmbeds(tree as unknown as MarkdownNode))

export const noteEmbedPlugins = [noteEmbedNode, noteEmbedRemark].flat() as MilkdownPlugin[]

function appendInline(parent: HTMLElement, source: string) {
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|\*[^*]+\*|_[^_]+_|!?\[[^\]]+\]\([^)]+\)|!?\[\[[^\]]+\]\])/g
  let offset = 0
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > offset) parent.append(document.createTextNode(source.slice(offset, index)))
    const token = match[0]
    let element: HTMLElement | null = null
    if (token.startsWith('**') || token.startsWith('__')) {
      element = document.createElement('strong'); element.textContent = token.slice(2, -2)
    } else if (token.startsWith('~~')) {
      element = document.createElement('del'); element.textContent = token.slice(2, -2)
    } else if (token.startsWith('`')) {
      element = document.createElement('code'); element.textContent = token.slice(1, -1)
    } else if (token.startsWith('*') || token.startsWith('_')) {
      element = document.createElement('em'); element.textContent = token.slice(1, -1)
    } else {
      const image = token.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      const wiki = token.match(/^(!?)\[\[([^\]]+)\]\]$/)
      if (wiki) {
        element = document.createElement('span'); element.className = wiki[1] ? 'note-embed-nested-reference' : 'note-embed-wiki-reference'
        const [target, label] = wiki[2].split('|', 2); element.textContent = wiki[1] ? `Osadzona notatka: ${label?.trim() || target.trim()}` : label?.trim() || target.trim()
      } else if (image) {
        element = document.createElement('span'); element.className = 'note-embed-image-label'; element.textContent = image[1] || 'Obraz'
      } else if (link) {
        element = document.createElement('a'); element.textContent = link[1]
        if (/^(https?:|mailto:|#no-tie-note\/)/i.test(link[2])) (element as HTMLAnchorElement).href = link[2]
      }
    }
    parent.append(element ?? document.createTextNode(token))
    offset = index + token.length
  }
  if (offset < source.length) parent.append(document.createTextNode(source.slice(offset)))
}

function tableCells(line: string) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(value => value.replace(/\\\|/g, '|').trim())
}

function isTableSeparator(line: string) {
  const cells = tableCells(line)
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell))
}

function appendMarkdownBlocks(parent: HTMLElement, markdown: string, assetMap: Map<string, NoteAsset>) {
  const lines = markdown.split(/\r?\n/)
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim()) { index++; continue }
    const fence = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      const codeLines: string[] = []
      index++
      while (index < lines.length && !lines[index]?.trimStart().startsWith(fence[1])) codeLines.push(lines[index++] ?? '')
      if (index < lines.length) index++
      const pre = document.createElement('pre'); const code = document.createElement('code')
      code.textContent = codeLines.join('\n'); pre.append(code); parent.append(pre); continue
    }
    if (index + 1 < lines.length && line.includes('|') && isTableSeparator(lines[index + 1] ?? '')) {
      const table = document.createElement('table'); const head = document.createElement('thead'); const body = document.createElement('tbody')
      const headerRow = document.createElement('tr')
      for (const value of tableCells(line)) { const cell = document.createElement('th'); appendInline(cell, value); headerRow.append(cell) }
      head.append(headerRow); index += 2
      while (index < lines.length && (lines[index] ?? '').includes('|')) {
        const row = document.createElement('tr')
        for (const value of tableCells(lines[index] ?? '')) { const cell = document.createElement('td'); appendInline(cell, value); row.append(cell) }
        body.append(row); index++
      }
      table.append(head, body); parent.append(table); continue
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/)
    if (heading) {
      const element = document.createElement(`h${heading[1].length}`); appendInline(element, heading[2]); parent.append(element); index++; continue
    }
    const image = line.match(/^\s*!\[([^\]]*)\]\(\.\/assets\/([^)]+)\)\s*$/)
    if (image) {
      const asset = assetMap.get(image[2])
      if (asset) {
        const frame = document.createElement('div'); frame.className = 'note-embed-svg'; frame.setAttribute('aria-label', image[1] || 'Schemat SVG')
        const svgDocument = new DOMParser().parseFromString(asset.svg, 'image/svg+xml')
        svgDocument.querySelectorAll('script, foreignObject, iframe, object, embed').forEach(element => element.remove());
        [svgDocument.documentElement, ...Array.from(svgDocument.querySelectorAll('*'))].forEach(element => Array.from(element.attributes).forEach(attribute => {
          const name = attribute.name.toLowerCase()
          const value = attribute.value.trim().toLowerCase()
          if (name.startsWith('on') || (name === 'style' && value.includes('url(')) || ((name === 'href' || name.endsWith(':href')) && value && !value.startsWith('#'))) element.removeAttribute(attribute.name)
        }))
        if (svgDocument.documentElement.localName === 'svg') frame.append(document.importNode(svgDocument.documentElement, true))
        parent.append(frame)
      } else { const p = document.createElement('p'); p.textContent = image[1] || 'Schemat SVG'; parent.append(p) }
      index++; continue
    }
    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) { parent.append(document.createElement('hr')); index++; continue }
    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^\s*>/.test(lines[index] ?? '')) quoteLines.push((lines[index++] ?? '').replace(/^\s*>\s?/, ''))
      const quote = document.createElement('blockquote'); appendMarkdownBlocks(quote, quoteLines.join('\n'), assetMap); parent.append(quote); continue
    }
    if (/^\s*(?:[-+*]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line); const list = document.createElement(ordered ? 'ol' : 'ul')
      while (index < lines.length && /^\s*(?:[-+*]|\d+[.)])\s+/.test(lines[index] ?? '')) {
        const content = (lines[index++] ?? '').replace(/^\s*(?:[-+*]|\d+[.)])\s+/, '')
        const item = document.createElement('li')
        const task = content.match(/^\[([ xX])\]\s+(.*)$/)
        if (task) { const check = document.createElement('span'); check.className = 'note-embed-task-check'; check.textContent = task[1].toLowerCase() === 'x' ? '✓' : '○'; item.append(check); appendInline(item, task[2]) }
        else appendInline(item, content)
        list.append(item)
      }
      parent.append(list); continue
    }
    const paragraph: string[] = []
    while (index < lines.length && (lines[index] ?? '').trim() && !/^\s{0,3}(?:#{1,6}\s+|>|[-+*]\s+|\d+[.)]\s+|```|~~~)/.test(lines[index] ?? '')) {
      if (index + 1 < lines.length && (lines[index] ?? '').includes('|') && isTableSeparator(lines[index + 1] ?? '')) break
      paragraph.push(lines[index++] ?? '')
    }
    if (!paragraph.length) { index++; continue }
    const p = document.createElement('p'); appendInline(p, paragraph.join(' ')); parent.append(p)
  }
}

function renderEmbed(element: HTMLElement, notes: Note[], assets: NoteAsset[], onOpen: (note: Note) => void) {
  const target = element.dataset.noTieEmbed ?? ''
  const [targetWithHeading, rawLabel] = target.split('|', 2)
  const [cleanTarget, heading] = (targetWithHeading ?? target).split('#', 2)
  const note = resolveWikiTarget(notes, cleanTarget.trim())
  element.replaceChildren()
  const card = document.createElement('article'); card.className = 'note-embed-card note-embed-inline'
  const header = document.createElement('header')
  const icon = document.createElement('span'); icon.className = 'note-embed-icon'; icon.textContent = '↳'
  const title = document.createElement('strong'); title.textContent = `${rawLabel?.trim() || note?.title || cleanTarget.trim() || 'Osadzona notatka'}${heading ? ` · ${heading.trim()}` : ''}`
  header.append(icon, title)
  if (note) {
    const open = document.createElement('button'); open.type = 'button'; open.textContent = 'Otwórz notatkę ↗'; open.addEventListener('click', () => onOpen(note)); header.append(open)
  }
  card.append(header)
  if (note) {
    const content = document.createElement('div'); content.className = 'note-embed-rendered-content'
    const noteAssets = new Map(assets.filter(asset => asset.noteId === note.id).map(asset => [asset.fileName, asset]))
    let markdown = note.content
    if (heading) {
      const lines = note.content.split(/\r?\n/)
      const requestedHeading = heading.trim().toLocaleLowerCase('pl')
      const start = lines.findIndex(line => /^#{1,6}\s+/.test(line) && line.replace(/^#+\s+/, '').trim().toLocaleLowerCase('pl') === requestedHeading)
      if (start < 0) markdown = `Nie znaleziono sekcji „${heading.trim()}” w tej notatce.`
      else {
        const level = lines[start]?.match(/^#+/)?.[0].length ?? 6
        let end = start + 1
        while (end < lines.length && !new RegExp(`^#{1,${level}}\\s+`).test(lines[end] ?? '')) end++
        markdown = lines.slice(start, end).join('\n')
      }
    }
    appendMarkdownBlocks(content, markdown, noteAssets)
    card.append(content)
  } else {
    const missing = document.createElement('p'); missing.className = 'note-embed-missing'; missing.textContent = `Nie znaleziono notatki „${target}”.`; card.append(missing)
  }
  element.append(card)
}

export function refreshNoteEmbeds(root: HTMLElement | null, notes: Note[], assets: NoteAsset[], onOpen: (note: Note) => void) {
  if (!root) return
  root.querySelectorAll<HTMLElement>('.no-tie-embed-node').forEach(element => renderEmbed(element, notes, assets, onOpen))
}
