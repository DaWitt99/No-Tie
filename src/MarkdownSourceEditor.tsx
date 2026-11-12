import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { MarkdownContextMenu, type MarkdownMenuAction, type MarkdownNoteAction } from './MarkdownContextMenu'
import { AI_REPLACE_SELECTION_EVENT, WIKI_EMBED_INSERT_EVENT, WIKI_LINK_INSERT_EVENT, type AiReplaceSelectionDetail, type WikiEmbedInsertDetail, type WikiLinkInsertDetail } from './wikiLinks'

type ContextMenuPosition = { left: number; top: number; opensLeft: boolean; opensUp: boolean }

function selectedLineRange(markdown: string, from: number, to: number) {
  const start = from === 0 ? 0 : markdown.lastIndexOf('\n', from - 1) + 1
  const end = markdown.indexOf('\n', Math.max(from, to))
  return { start, end: end < 0 ? markdown.length : end }
}

function stripParagraphMarkers(line: string) {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
}

export function MarkdownSourceEditor({
  noteId,
  markdown,
  onChange,
  onSelectionChange,
  noteActions,
  onNoteAction,
}: {
  noteId: string
  markdown: string
  onChange: (markdown: string) => void
  onSelectionChange: (text: string) => void
  noteActions: MarkdownNoteAction[]
  onNoteAction: (id: string) => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const contextRange = useRef({ from: 0, to: 0 })
  const selectionRange = useRef({ from: 0, to: 0 })
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null)

  useEffect(() => {
    const insertWikiLink = (event: Event) => {
      const detail = (event as CustomEvent<WikiLinkInsertDetail>).detail
      if (detail?.noteId !== noteId || !detail.target) return
      const input = textareaRef.current
      if (!input) return
      const { from, to } = contextRange.current
      const selected = input.value.slice(from, to)
      const wikiLink = selected ? `[[${detail.target}|${selected}]]` : `[[${detail.target}]]`
      const next = input.value.slice(0, from) + wikiLink + input.value.slice(to)
      const selectedStart = from + (selected ? detail.target.length + 3 : wikiLink.length)
      onChange(next)
      onSelectionChange(selected ? next.slice(selectedStart, selectedStart + selected.length) : '')
      setContextMenu(null)
      requestAnimationFrame(() => {
        input.focus()
        input.setSelectionRange(selected ? selectedStart : from + wikiLink.length, selected ? selectedStart + selected.length : from + wikiLink.length)
      })
    }
    window.addEventListener(WIKI_LINK_INSERT_EVENT, insertWikiLink)
    return () => window.removeEventListener(WIKI_LINK_INSERT_EVENT, insertWikiLink)
  }, [noteId, onChange, onSelectionChange])

  useEffect(() => {
    const insertEmbed = (event: Event) => {
      const detail = (event as CustomEvent<WikiEmbedInsertDetail>).detail
      const input = textareaRef.current
      if (detail?.noteId !== noteId || !input) return
      const { from, to } = contextRange.current
      const line = selectedLineRange(input.value, from, to)
      const insertion = line.end
      const macro = `![[${detail.target}]]`
      const before = input.value.slice(0, insertion)
      const after = input.value.slice(insertion)
      const separator = before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
      const next = `${before}${separator}${macro}${after.startsWith('\n') ? '' : '\n'}${after}`
      const cursor = insertion + separator.length + macro.length
      onChange(next)
      requestAnimationFrame(() => { input.focus(); input.setSelectionRange(cursor, cursor) })
    }
    window.addEventListener(WIKI_EMBED_INSERT_EVENT, insertEmbed)
    return () => window.removeEventListener(WIKI_EMBED_INSERT_EVENT, insertEmbed)
  }, [noteId, onChange])

  useEffect(() => {
    const replaceSelection = (event: Event) => {
      const detail = (event as CustomEvent<AiReplaceSelectionDetail>).detail
      if (detail?.noteId !== noteId) return
      const input = textareaRef.current
      if (!input) return
      const { from, to } = contextRange.current
      const next = input.value.slice(0, from) + detail.replacement + input.value.slice(to)
      onChange(next)
      onSelectionChange(detail.replacement)
      requestAnimationFrame(() => { input.focus(); input.setSelectionRange(from, from + detail.replacement.length) })
    }
    window.addEventListener(AI_REPLACE_SELECTION_EVENT, replaceSelection)
    return () => window.removeEventListener(AI_REPLACE_SELECTION_EVENT, replaceSelection)
  }, [noteId, onChange, onSelectionChange])

  function showContextMenu(event: ReactMouseEvent<HTMLTextAreaElement>) {
    event.preventDefault()
    const input = event.currentTarget
    contextRange.current = { from: input.selectionStart, to: input.selectionEnd }
    setContextMenu({
      left: Math.max(8, Math.min(event.clientX, window.innerWidth - 222)),
      top: Math.max(8, Math.min(event.clientY, window.innerHeight - 160)),
      opensLeft: event.clientX > window.innerWidth - 486,
      opensUp: event.clientY > window.innerHeight - 320,
    })
  }

  function applyAction(action: MarkdownMenuAction) {
    const { from, to } = contextRange.current
    const start = Math.max(0, Math.min(from, markdown.length))
    const end = Math.max(start, Math.min(to, markdown.length))
    const selected = markdown.slice(start, end)
    setContextMenu(null)

    const commit = (next: string, selectionStart: number, selectionEnd: number) => {
      onChange(next)
      onSelectionChange(next.slice(selectionStart, selectionEnd))
      requestAnimationFrame(() => {
        const input = textareaRef.current
        input?.focus()
        input?.setSelectionRange(selectionStart, selectionEnd)
      })
    }
    const replace = (replacement: string, selectionOffset = replacement.length, selectedLength = 0) => {
      const next = markdown.slice(0, start) + replacement + markdown.slice(end)
      const selectionStart = start + selectionOffset
      commit(next, selectionStart, selectionStart + selectedLength)
    }
    const wrap = (before: string, after: string, placeholder = 'tekst') => {
      const value = selected || placeholder
      replace(`${before}${value}${after}`, before.length, value.length)
    }

    switch (action) {
      case 'bold': wrap('**', '**'); break
      case 'italic': wrap('*', '*'); break
      case 'strike': wrap('~~', '~~'); break
      case 'underline': wrap('<u>', '</u>'); break
      case 'highlight': wrap('<mark data-no-tie-color="#fff176">', '</mark>'); break
      case 'code': wrap('`', '`', 'kod'); break
      case 'inline-math': wrap('$', '$', 'x'); break
      case 'comment': wrap('<span data-no-tie-comment="true">', '</span>'); break
      case 'clear-format': {
        const line = selectedLineRange(markdown, start, end)
        const target = selected || markdown.slice(line.start, line.end)
        const cleaned = target
          .replace(/<\/?(?:u|mark|span)\b[^>]*>/gi, '')
          .replace(/!?\[([^\]]+)\]\([^)]+\)/g, '$1')
          .replace(/\*\*|__|~~|`/g, '')
        if (selected) replace(cleaned, 0, cleaned.length)
        else {
          const next = markdown.slice(0, line.start) + cleaned + markdown.slice(line.end)
          commit(next, line.start, line.start + cleaned.length)
        }
        break
      }
      case 'bullet-list':
      case 'ordered-list':
      case 'task-list':
      case 'heading-1':
      case 'heading-2':
      case 'heading-3':
      case 'paragraph':
      case 'blockquote': {
        const line = selectedLineRange(markdown, start, end)
        const target = markdown.slice(line.start, line.end)
        const headingLevel = action === 'heading-1' ? 1 : action === 'heading-2' ? 2 : action === 'heading-3' ? 3 : 0
        const prefix = action === 'bullet-list' ? '- '
          : action === 'ordered-list' ? '1. '
            : action === 'task-list' ? '- [ ] '
              : headingLevel ? `${'#'.repeat(headingLevel)} `
                : action === 'blockquote' ? '> ' : ''
        const converted = target.split('\n').map(value => {
          const text = stripParagraphMarkers(value)
          return text ? `${prefix}${text}` : ''
        }).join('\n')
        const next = markdown.slice(0, line.start) + converted + markdown.slice(line.end)
        commit(next, line.start, line.start + converted.length)
        break
      }
      case 'footnote': {
        const numbers = [...markdown.matchAll(/\[\^nt(\d+)\]/g)].map(match => Number(match[1]))
        const number = Math.max(0, ...numbers) + 1
        const reference = `${selected}[^nt${number}]`
        const base = markdown.slice(0, start) + reference + markdown.slice(end)
        const definition = `\n\n[^nt${number}]: Treść przypisu\n`
        const separator = base.endsWith('\n\n') ? '' : base.endsWith('\n') ? '\n' : '\n\n'
        commit(base + separator + definition.slice(2), start + selected.length, 0)
        break
      }
      case 'table': replace(`\n\n| ${selected || 'Kolumna 1'} | Kolumna 2 |\n| --- | --- |\n|  |  |\n\n`); break
      case 'callout': {
        const lines = (selected || 'Wyróżniony tekst').split('\n').map(line => `> ${line}`).join('\n')
        replace(`\n\n> **Wyróżnienie**\n>\n${lines}\n\n`)
        break
      }
      case 'horizontal-rule': replace('\n\n---\n\n'); break
      case 'code-block': replace(`\n\n\`\`\`\n${selected}\n\`\`\`\n\n`); break
      case 'math-block': replace(`\n\n$$\n${selected || 'x'}\n$$\n\n`); break
    }
  }

  return <>
    <textarea
      ref={textareaRef}
      className="markdown-source-editor"
      aria-label="Surowy tekst Markdown"
      spellCheck={false}
      value={markdown}
      onContextMenu={showContextMenu}
      onSelect={event => {
        const input = event.currentTarget
        selectionRange.current = { from: input.selectionStart, to: input.selectionEnd }
        onSelectionChange(input.value.slice(input.selectionStart, input.selectionEnd))
      }}
      onChange={event => {
        const input = event.currentTarget
        selectionRange.current = { from: input.selectionStart, to: input.selectionEnd }
        onChange(input.value)
        onSelectionChange(input.value.slice(input.selectionStart, input.selectionEnd))
      }}
    />
    {contextMenu && <MarkdownContextMenu {...contextMenu} noteActions={noteActions} onNoteAction={action => { setContextMenu(null); onNoteAction(action) }} onAction={applyAction} onDismiss={() => setContextMenu(null)} />}
  </>
}
