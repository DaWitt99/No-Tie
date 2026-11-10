import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { $markAttr, $markSchema, $remark } from '@milkdown/kit/utils'

type MarkdownNode = {
  type: string
  value?: string
  children?: MarkdownNode[]
  data?: Record<string, unknown>
  [key: string]: unknown
}

const underlineAttr = $markAttr('noteUnderline')
export const underlineSchema = $markSchema('noteUnderline', _ctx => ({
  parseDOM: [{ tag: 'u' }],
  toDOM: () => ['u', 0],
  parseMarkdown: {
    match: node => node.type === 'noTieUnderline',
    runner: (state, node, type) => {
      state.openMark(type)
      state.next(node.children)
      state.closeMark(type)
    },
  },
  toMarkdown: {
    match: mark => mark.type.name === 'noteUnderline',
    runner: (state, mark, node) => {
      state.addNode('html', undefined, '<u>', { data: { noTieGenerated: true } })
      state.next(node.mark(mark.type.removeFromSet(node.marks)))
      state.addNode('html', undefined, '</u>', { data: { noTieGenerated: true } })
      return true
    },
  },
}))

const highlightAttr = $markAttr('noteHighlight')
export const highlightSchema = $markSchema('noteHighlight', () => ({
  attrs: { color: { default: '#fff176', validate: 'string' } },
  parseDOM: [{
    tag: 'mark',
    getAttrs: dom => ({ color: normalizeHighlightColor((dom as HTMLElement).dataset.noTieColor || (dom as HTMLElement).style.backgroundColor) }),
  }],
  toDOM: mark => ['mark', { style: `background-color: ${normalizeHighlightColor(mark.attrs.color)}`, 'data-no-tie-color': normalizeHighlightColor(mark.attrs.color) }, 0],
  parseMarkdown: {
    match: node => node.type === 'noTieHighlight',
    runner: (state, node, type) => {
      state.openMark(type, { color: normalizeHighlightColor(node.color) })
      state.next(node.children)
      state.closeMark(type)
    },
  },
  toMarkdown: {
    match: mark => mark.type.name === 'noteHighlight',
    runner: (state, mark, node) => {
      const color = normalizeHighlightColor(mark.attrs.color)
      state.addNode('html', undefined, `<mark data-no-tie-color="${color}">`, { data: { noTieGenerated: true } })
      state.next(node.mark(mark.type.removeFromSet(node.marks)))
      state.addNode('html', undefined, '</mark>', { data: { noTieGenerated: true } })
      return true
    },
  },
}))

const commentAttr = $markAttr('noteComment')
export const noteCommentSchema = $markSchema('noteComment', () => ({
  parseDOM: [{ tag: 'span[data-no-tie-comment="true"]' }],
  toDOM: () => ['span', { class: 'note-comment-mark', 'data-no-tie-comment': 'true', title: 'Komentarz Markdown' }, 0],
  parseMarkdown: {
    match: node => node.type === 'noTieComment',
    runner: (state, node, type) => {
      state.openMark(type)
      state.next(node.children)
      state.closeMark(type)
    },
  },
  toMarkdown: {
    match: mark => mark.type.name === 'noteComment',
    runner: (state, mark, node) => {
      state.addNode('html', undefined, '<span data-no-tie-comment="true">', { data: { noTieGenerated: true } })
      state.next(node.mark(mark.type.removeFromSet(node.marks)))
      state.addNode('html', undefined, '</span>', { data: { noTieGenerated: true } })
      return true
    },
  },
}))

function normalizeHighlightColor(value: unknown): string {
  if (typeof value !== 'string') return '#fff176'
  const candidate = value.trim()
  return /^#[\da-f]{3}(?:[\da-f]{3})?(?:[\da-f]{2})?$/i.test(candidate) ? candidate : '#fff176'
}

function inlineMarker(value: string): { type: string; close: (candidate: string) => boolean; attrs?: Record<string, string> } | undefined {
  if (/^<u\s*>$/i.test(value)) return { type: 'noTieUnderline', close: candidate => /^<\/u\s*>$/i.test(candidate) }
  if (/^<mark\b/i.test(value) && />$/.test(value)) {
    const color = value.match(/\bdata-no-tie-color=["']([^"']+)["']/i)?.[1]
      ?? value.match(/background-color\s*:\s*([^;"']+)/i)?.[1]
    return { type: 'noTieHighlight', attrs: { color: normalizeHighlightColor(color) }, close: candidate => /^<\/mark\s*>$/i.test(candidate) }
  }
  if (/^<span\b[^>]*data-no-tie-comment=["']true["'][^>]*>$/i.test(value)) {
    return { type: 'noTieComment', close: candidate => /^<\/span\s*>$/i.test(candidate) }
  }
  return undefined
}

function transformInlineMarkdown(node: MarkdownNode): void {
  if (!node.children) return
  const transformed: MarkdownNode[] = []
  for (let index = 0; index < node.children.length; index++) {
    const child = node.children[index]
    if (!child) continue
    if (child.type === 'html' && !child.data?.noTieGenerated && typeof child.value === 'string') {
      const marker = inlineMarker(child.value)
      if (marker) {
        let depth = 1
        let end = index + 1
        for (; end < node.children.length; end++) {
          const candidate = node.children[end]
          if (candidate?.type !== 'html' || candidate.data?.noTieGenerated || typeof candidate.value !== 'string') continue
          if (inlineMarker(candidate.value)?.type === marker.type) depth++
          else if (marker.close(candidate.value) && --depth === 0) break
        }
        if (depth === 0) {
          const children = node.children.slice(index + 1, end)
          const wrapped: MarkdownNode = { type: marker.type, children, ...marker.attrs }
          transformInlineMarkdown(wrapped)
          transformed.push(wrapped)
          index = end
          continue
        }
      }
    }
    transformInlineMarkdown(child)
    transformed.push(child)
  }
  node.children = transformed
}

const inlineMarkdownRemark = $remark('noTieInlineMarkdown', () => () => tree => {
  transformInlineMarkdown(tree as unknown as MarkdownNode)
})

export const markdownMarkupPlugins = [
  underlineAttr,
  underlineSchema,
  highlightAttr,
  highlightSchema,
  commentAttr,
  noteCommentSchema,
  inlineMarkdownRemark,
].flat() as MilkdownPlugin[]
