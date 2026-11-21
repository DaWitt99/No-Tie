import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { commandsCtx, defaultValueCtx, editorViewCtx, Editor, rootCtx } from '@milkdown/kit/core'
import { Fragment } from '@milkdown/kit/prose/model'
import {
  commonmark,
  createCodeBlockCommand,
  strongSchema,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import {
  columnResizingPlugin,
  gfm,
  toggleStrikethroughCommand,
} from '@milkdown/kit/preset/gfm'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { toggleMark as toggleProseMark } from '@milkdown/kit/prose/commands'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { getMarkdown, replaceRange } from '@milkdown/kit/utils'
import { markdownForEditor, markdownFromEditor } from './content'
import { MarkdownContextMenu, type MarkdownMenuAction, type MarkdownNoteAction } from './MarkdownContextMenu'
import { MarkdownTableMenu, type MarkdownTableAction } from './MarkdownTableMenu'
import { highlightSchema, markdownMarkupPlugins, noteCommentSchema, underlineSchema } from './markdownMarkup'
import { applyTableColumnWidths, applyTableRowHeights, markdownWithTableColumnWidths, parseTableColumnWidths, parseTableRowHeights, stripTableWidthMetadata } from './markdownTableWidths'
import { noteEmbedPlugins, refreshNoteEmbeds } from './noteEmbeds'
import { AI_REPLACE_SELECTION_EVENT, WIKI_EMBED_INSERT_EVENT, WIKI_LINK_INSERT_EVENT, markdownToWikiLinks, wikiLinksToMarkdown, wikiNoteHref, wikiNoteTargetFromHref, type AiReplaceSelectionDetail, type WikiEmbedInsertDetail, type WikiLinkInsertDetail } from './wikiLinks'
import type { NoteAsset, NoteAttachment } from './types'

type ContextMenuState = { left: number; top: number; opensLeft: boolean; opensUp: boolean }
type TableTarget = { tablePos: number; row: number; column: number; element: HTMLTableElement }
type TableOverlayState = TableTarget & { left: number; top: number }
type TableContextState = TableTarget & { left: number; top: number }
type TableFilterState = { tablePos: number; column: number; value: string }
type AssistPanel = 'outline' | 'find' | 'comments' | 'shortcuts' | 'validation' | null
type ShortcutAction = 'find' | 'outline' | 'comments' | 'focus'
type EditorShortcutMap = Record<ShortcutAction, string>
type HeadingEntry = { id: string; level: number; text: string; pos: number }
type InlineComment = { id: string; text: string; excerpt: string; from: number; to: number; resolved: boolean }
type TextMatch = { from: number; to: number }
type TextSegment = { from: number; to: number; start: number; end: number }

const SHORTCUTS_STORAGE_KEY = 'no-tie-editor-shortcuts'
const VALIDATION_STORAGE_KEY = 'no-tie-editor-validation'
const DEFAULT_SHORTCUTS: EditorShortcutMap = { find: 'Ctrl+Shift+F', outline: 'Ctrl+Shift+O', comments: 'Ctrl+Shift+J', focus: 'Ctrl+Shift+M' }

function readShortcuts(): EditorShortcutMap {
  try {
    const stored = JSON.parse(localStorage.getItem(SHORTCUTS_STORAGE_KEY) || '{}') as Partial<EditorShortcutMap> | null
    return Object.fromEntries((Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]).map(action => [action, typeof stored?.[action] === 'string' ? stored[action] : DEFAULT_SHORTCUTS[action]])) as EditorShortcutMap
  }
  catch { return DEFAULT_SHORTCUTS }
}

function readValidationOptions(): { spelling: boolean; markdown: boolean } {
  try {
    const parsed = JSON.parse(localStorage.getItem(VALIDATION_STORAGE_KEY) || '{}')
    return { spelling: parsed.spelling !== false, markdown: parsed.markdown !== false }
  } catch { return { spelling: true, markdown: true } }
}

function shortcutFromEvent(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) parts.push(key)
  return parts.join('+')
}

function headingEntries(view: EditorView): HeadingEntry[] {
  const occurrences = new Map<string, number>()
  const headings: HeadingEntry[] = []
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true
    const level = Number(node.attrs.level) || 1
    const text = node.textContent.trim() || 'Pusty nagłówek'
    const key = `${level}:${text}`
    const occurrence = occurrences.get(key) ?? 0
    occurrences.set(key, occurrence + 1)
    headings.push({ id: `${key}:${occurrence}`, level, text, pos })
    return true
  })
  return headings
}

function textMatches(doc: import('@milkdown/kit/prose/model').Node, query: string): TextMatch[] {
  const needle = query.trim()
  if (!needle) return []
  const matches: TextMatch[] = []
  const normalizedNeedle = needle.toLocaleLowerCase()
  doc.descendants((block, blockPos) => {
    if (!block.isTextblock) return true
    const segments: TextSegment[] = []
    let text = ''
    block.descendants((node, pos) => {
      if (!node.isText) return true
      const value = node.text ?? ''
      const start = text.length
      text += value
      segments.push({ from: blockPos + 1 + pos, to: blockPos + 1 + pos + node.nodeSize, start, end: text.length })
      return false
    })
    const normalizedText = text.toLocaleLowerCase()
    const positionAt = (offset: number) => {
      const segment = segments.find(item => offset >= item.start && offset < item.end) ?? (offset === text.length ? segments.at(-1) : undefined)
      if (!segment) return undefined
      return segment.from + Math.min(offset - segment.start, segment.to - segment.from)
    }
    let cursor = 0
    while (cursor <= normalizedText.length - normalizedNeedle.length) {
      const found = normalizedText.indexOf(normalizedNeedle, cursor)
      if (found < 0) break
      const from = positionAt(found)
      const to = positionAt(found + needle.length)
      if (from !== undefined && to !== undefined && to > from) matches.push({ from, to })
      cursor = found + Math.max(needle.length, 1)
    }
    return true
  })
  return matches
}

function inlineComments(view: EditorView): InlineComment[] {
  const comments = new Map<string, InlineComment>()
  view.state.doc.descendants((node, pos) => {
    if (!node.isText) return true
    const mark = node.marks.find(item => item.type.name === 'noteComment')
    if (!mark) return true
    const markId = String(mark.attrs.id || '')
    const id = markId || `legacy:${pos}`
    const current = comments.get(id)
    const excerpt = node.text ?? ''
    if (current) {
      current.excerpt += excerpt
      current.to = pos + node.nodeSize
    } else {
      comments.set(id, {
        id,
        text: String(mark.attrs.text || ''),
        excerpt,
        from: pos,
        to: pos + node.nodeSize,
        resolved: Boolean(mark.attrs.resolved),
      })
    }
    return true
  })
  return [...comments.values()].sort((left, right) => left.from - right.from)
}

function markdownWarnings(markdown: string, notes: import('./types').Note[]): string[] {
  const warnings: string[] = []
  const fences = markdown.match(/^\s*```/gm)?.length ?? 0
  if (fences % 2) warnings.push('Niezamknięty blok kodu — dodaj końcowe ```.')
  if (/^\s{0,3}#{1,6}\S/m.test(markdown)) warnings.push('Nagłówek Markdown powinien mieć spację po znakach #.')
  if (/\[\[[^\]]*$/.test(markdown)) warnings.push('Niedokończony link do notatki — sprawdź zapis [[nazwa]].')
  if (/\[[^\]]*\]\(\s*\)/.test(markdown)) warnings.push('Link Markdown nie ma adresu docelowego.')
  if (/\[[^\]]*\]\([^)]*$/.test(markdown)) warnings.push('Niedokończony link Markdown — zamknij adres nawiasem ).')
  const noteNames = new Set(notes.flatMap(note => [note.id, note.title, ...(note.aliases ?? [])].map(value => value.trim().toLocaleLowerCase())))
  const unresolved = [...markdown.matchAll(/\[\[([^\]]+)\]\]/g)].map(match => match[1]?.trim()).filter((target): target is string => Boolean(target) && !noteNames.has(target.toLocaleLowerCase()))
  for (const target of [...new Set(unresolved)].slice(0, 8)) warnings.push(`Nie znaleziono notatki „${target}”.`)
  if (!warnings.length) warnings.push('Nie znaleziono problemów w Markdownzie ani linkach.')
  return warnings
}

function tablePositionAt(doc: import('@milkdown/kit/prose/model').Node, pos: number): number | undefined {
  try {
    const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)))
    for (let depth = $pos.depth; depth > 0; depth--) {
      if ($pos.node(depth).type.name === 'table') return $pos.before(depth)
    }
  } catch {
    return undefined
  }
  return undefined
}

function cellPositionAt(table: import('@milkdown/kit/prose/model').Node, tablePos: number, rowIndex: number, columnIndex: number): number | undefined {
  let rowStart = tablePos + 1
  for (let row = 0; row < table.childCount; row++) {
    const rowNode = table.child(row)
    if (row === rowIndex && columnIndex < rowNode.childCount) {
      let cellStart = rowStart + 1
      for (let column = 0; column < columnIndex; column++) cellStart += rowNode.child(column).nodeSize
      return cellStart
    }
    rowStart += rowNode.nodeSize
  }
  return undefined
}

function markdownForTable(table: import('@milkdown/kit/prose/model').Node): string {
  const rows: string[] = []
  table.forEach(row => {
    const cells: string[] = []
    row.forEach(cell => cells.push(cell.textContent.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, '<br>')))
    rows.push(`| ${cells.join(' | ')} |`)
  })
  if (rows.length < 2) return rows.join('\n')
  const columns = table.firstChild?.childCount ?? 1
  return [rows[0], `| ${Array(columns).fill('---').join(' | ')} |`, ...rows.slice(1)].join('\n')
}

async function copyMarkdownToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Fall back to the clipboard API available in older WebViews.
  }
  const input = document.createElement('textarea')
  input.value = value
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.append(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  return copied
}

export function MarkdownEditor({
  noteId,
  markdown,
  assets,
  attachments,
  revision,
  onChange,
  onSelectionChange,
  onOpenNote,
  onOpenAttachment,
  notes,
  allAssets,
  noteActions,
  onNoteAction,
  readOnly = false,
}: {
  noteId: string
  markdown: string
  assets: NoteAsset[]
  attachments: NoteAttachment[]
  revision: number
  onChange: (markdown: string) => void
  onSelectionChange: (text: string) => void
  onOpenNote: (target: string) => void
  onOpenAttachment: (fileName: string, page?: number, fragment?: string) => void
  notes: import('./types').Note[]
  allAssets: NoteAsset[]
  noteActions: MarkdownNoteAction[]
  onNoteAction: (id: string) => void
  readOnly?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const tableFilterStyle = useRef<HTMLStyleElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const contextRange = useRef({ from: 0, to: 0 })
  const selectedRange = useRef({ from: 0, to: 0 })
  const activeTableElement = useRef<HTMLTableElement | null>(null)
  const tableToolbarDismissTimer = useRef<number | null>(null)
  const onChangeRef = useRef(onChange)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onOpenNoteRef = useRef(onOpenNote)
  const onOpenAttachmentRef = useRef(onOpenAttachment)
  const notesRef = useRef(notes)
  const assetsRef = useRef(allAssets)
  const pendingMarkdownUpdate = useRef<{ markdown: string; view: EditorView } | null>(null)
  const markdownUpdateTimer = useRef<number | null>(null)
  const assistUpdateTimer = useRef<number | null>(null)
  const lastSelectionText = useRef('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [hoverTable, setHoverTable] = useState<TableOverlayState | null>(null)
  const [tableContextMenu, setTableContextMenu] = useState<TableContextState | null>(null)
  const tableFilter = useRef<TableFilterState | null>(null)
  const rowResize = useRef<{ row: HTMLTableRowElement; startY: number; startHeight: number; pointerId: number; changed: boolean } | null>(null)
  const [tableFilterView, setTableFilterView] = useState<TableFilterState | null>(null)
  const [tableRevision, setTableRevision] = useState(0)
  const [tableCopied, setTableCopied] = useState(false)
  const [assistPanel, setAssistPanel] = useState<AssistPanel>(null)
  const [assistRevision, setAssistRevision] = useState(0)
  const [headings, setHeadings] = useState<HeadingEntry[]>([])
  const [foldedHeadings, setFoldedHeadings] = useState<Set<string>>(() => new Set())
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [activeFindMatch, setActiveFindMatch] = useState(-1)
  const [comments, setComments] = useState<InlineComment[]>([])
  const [commentDraft, setCommentDraft] = useState('')
  const [pendingCommentRange, setPendingCommentRange] = useState<TextMatch | null>(null)
  const [shortcuts, setShortcuts] = useState<EditorShortcutMap>(readShortcuts)
  const [capturingShortcut, setCapturingShortcut] = useState<ShortcutAction | null>(null)
  const [validationOptions, setValidationOptions] = useState(readValidationOptions)
  const [focusMode, setFocusMode] = useState(false)
  const [initialDocument] = useState(() => ({ markdown, assets, attachments }))
  const lastMarkdown = useRef(initialDocument.markdown)

  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange }, [onSelectionChange])
  useEffect(() => { onOpenNoteRef.current = onOpenNote }, [onOpenNote])
  useEffect(() => { onOpenAttachmentRef.current = onOpenAttachment }, [onOpenAttachment])
  useEffect(() => { notesRef.current = notes; assetsRef.current = allAssets }, [notes, allAssets])
  useEffect(() => {
    const style = document.createElement('style')
    style.dataset.noTieTableFilterStyle = ''
    document.head.append(style)
    tableFilterStyle.current = style
    return () => {
      style.remove()
      tableFilterStyle.current = null
    }
  }, [])

  useEffect(() => {
    if (!root.current) return
    lastMarkdown.current = initialDocument.markdown
    const editor = Editor.make()
      .config(ctx => {
        ctx.set(rootCtx, root.current!)
        ctx.set(defaultValueCtx, markdownForEditor(wikiLinksToMarkdown(stripTableWidthMetadata(initialDocument.markdown)), initialDocument.assets, initialDocument.attachments))
        ctx.get(listenerCtx).markdownUpdated((_ctx, updated) => {
          pendingMarkdownUpdate.current = { markdown: updated, view: _ctx.get(editorViewCtx) }
          if (markdownUpdateTimer.current !== null) window.clearTimeout(markdownUpdateTimer.current)
          markdownUpdateTimer.current = window.setTimeout(() => flushPendingMarkdownUpdate(), 180)
        })
      })
      .use([...commonmark, columnResizingPlugin, ...gfm, ...markdownMarkupPlugins, ...noteEmbedPlugins, listener])
    void editor.create().then(() => {
      editorRef.current = editor
      const editorView = editor.ctx.get(editorViewCtx)
      editorView.setProps({ editable: () => !readOnly })
      editorView.dom.setAttribute('spellcheck', String(validationOptions.spelling))
      editorView.dom.setAttribute('aria-label', 'Treść notatki')
      editorView.dom.setAttribute('aria-readonly', String(readOnly))
      const widths = parseTableColumnWidths(initialDocument.markdown)
      if (widths.length) applyTableColumnWidths(editor.ctx.get(editorViewCtx), widths)
      applyTableRowHeights(editor.ctx.get(editorViewCtx), parseTableRowHeights(initialDocument.markdown))
      refreshNoteEmbeds(root.current, notesRef.current, assetsRef.current, note => onOpenNoteRef.current(note.title || note.id))
      setAssistRevision(value => value + 1)
    }).catch(error => console.error('Nie udało się uruchomić edytora Markdown', error))
    return () => {
      flushPendingMarkdownUpdate(false)
      if (assistUpdateTimer.current !== null) window.clearTimeout(assistUpdateTimer.current)
      assistUpdateTimer.current = null
      editorRef.current = null
      void editor.destroy()
    }
  }, [noteId, revision, initialDocument, readOnly])

  useEffect(() => {
    try { localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(shortcuts)) } catch { /* Browser storage can be disabled. */ }
  }, [shortcuts])

  useEffect(() => {
    try { localStorage.setItem(VALIDATION_STORAGE_KEY, JSON.stringify(validationOptions)) } catch { /* Browser storage can be disabled. */ }
    editorRef.current?.ctx.get(editorViewCtx).dom.setAttribute('spellcheck', String(validationOptions.spelling))
  }, [validationOptions])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) {
      setHeadings([])
      setComments([])
      return
    }
    const view = editor.ctx.get(editorViewCtx)
    setHeadings(headingEntries(view))
    setComments(inlineComments(view))
  }, [assistRevision, noteId, readOnly])

  useEffect(() => {
    const editor = editorRef.current
    const proseMirror = root.current?.querySelector('.ProseMirror')
    if (!editor || !proseMirror) return
    const blocks = Array.from(proseMirror.children) as HTMLElement[]
    const headingMap = new Map<string, HeadingEntry[]>()
    for (const heading of headings) {
      const key = `${heading.level}:${heading.text}`
      headingMap.set(key, [...(headingMap.get(key) ?? []), heading])
    }
    let foldedLevel: number | null = null
    let hiddenByFold = false
    for (const block of blocks) {
      const match = /^H([1-6])$/.exec(block.tagName)
      if (match) {
        const level = Number(match[1])
        if (foldedLevel !== null && level <= foldedLevel) foldedLevel = null
        hiddenByFold = foldedLevel !== null
        const key = `${level}:${block.textContent?.trim() || 'Pusty nagłówek'}`
        const entry = headingMap.get(key)?.shift()
        if (entry) {
          block.dataset.noTieHeadingId = entry.id
          if (foldedHeadings.has(entry.id) && foldedLevel === null) foldedLevel = level
        }
      } else hiddenByFold = foldedLevel !== null
      block.hidden = hiddenByFold
    }
    return () => { for (const block of blocks) { block.hidden = false; delete block.dataset.noTieHeadingId } }
  }, [headings, foldedHeadings, assistRevision, noteId])

  useEffect(() => {
    const appShell = root.current?.closest('.app-shell')
    appShell?.classList.toggle('note-focus-mode', focusMode)
    return () => { appShell?.classList.remove('note-focus-mode') }
  }, [focusMode, noteId])

  useEffect(() => {
    if (!capturingShortcut) return
    const capture = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setCapturingShortcut(null); return }
      if (!(event.ctrlKey || event.metaKey || event.altKey)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      setShortcuts(current => ({ ...current, [capturingShortcut]: shortcutFromEvent(event) }))
      setCapturingShortcut(null)
    }
    window.addEventListener('keydown', capture, true)
    return () => window.removeEventListener('keydown', capture, true)
  }, [capturingShortcut])

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      const target = event.target
      if (readOnly || !(target instanceof Element) || !root.current?.parentElement?.contains(target)) return
      if (target instanceof HTMLElement && ((target.isContentEditable && !target.closest('.ProseMirror')) || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      const pressed = shortcutFromEvent(event)
      const action = (Object.keys(shortcuts) as ShortcutAction[]).find(key => shortcuts[key].toLocaleLowerCase() === pressed.toLocaleLowerCase())
      if (!action) return
      event.preventDefault()
      event.stopPropagation()
      if (action === 'focus') setFocusMode(current => !current)
      else setAssistPanel(current => current === action ? null : action)
    }
    window.addEventListener('keydown', onShortcut, true)
    return () => window.removeEventListener('keydown', onShortcut, true)
  }, [shortcuts, readOnly])

  useEffect(() => {
    refreshNoteEmbeds(root.current, notes, allAssets, note => onOpenNoteRef.current(note.title || note.id))
  }, [notes, allAssets])

  useEffect(() => {
    const moveRowResize = (event: PointerEvent) => {
      const active = rowResize.current
      if (!active || event.pointerId !== active.pointerId) return
      if (event.cancelable) event.preventDefault()
      const height = Math.max(28, Math.round(active.startHeight + event.clientY - active.startY))
      active.row.style.height = `${height}px`
      active.row.dataset.noTieRowHeight = String(height)
      active.changed = true
    }
    const finishRowResize = (event: PointerEvent) => {
      const active = rowResize.current
      if (!active || event.pointerId !== active.pointerId) return
      rowResize.current = null
      document.body.classList.remove('table-row-resizing')
      if (active.changed && editorRef.current) saveEditorMarkdown(editorRef.current)
    }
    window.addEventListener('pointermove', moveRowResize, { passive: false })
    window.addEventListener('pointerup', finishRowResize)
    window.addEventListener('pointercancel', finishRowResize)
    return () => {
      window.removeEventListener('pointermove', moveRowResize)
      window.removeEventListener('pointerup', finishRowResize)
      window.removeEventListener('pointercancel', finishRowResize)
      document.body.classList.remove('table-row-resizing')
    }
  }, [])

  useEffect(() => {
    const insertWikiLink = (event: Event) => {
      const detail = (event as CustomEvent<WikiLinkInsertDetail>).detail
      if (detail?.noteId !== noteId || !detail.target) return
      const editor = editorRef.current
      if (!editor) return
      const view = editor.ctx.get(editorViewCtx)
      const current = view.state.selection
      const { from, to } = contextRange.current
      const max = view.state.doc.content.size
      const safeFrom = Math.max(0, Math.min(from, max))
      const safeTo = Math.max(safeFrom, Math.min(to, max))
      if (current.from !== safeFrom || current.to !== safeTo) {
        const selection = safeFrom === safeTo ? TextSelection.near(view.state.doc.resolve(safeFrom)) : TextSelection.create(view.state.doc, safeFrom, safeTo)
        view.dispatch(view.state.tr.setSelection(selection))
      }
      const { from: selectionFrom, to: selectionTo, empty } = view.state.selection
      const label = empty ? detail.target : view.state.doc.textBetween(selectionFrom, selectionTo, '\n')
      const linkMark = view.state.schema.marks.link
      if (!linkMark) view.dispatch(view.state.tr.insertText(`[[${detail.target}]]`, selectionFrom, selectionTo))
      else {
        const transaction = view.state.tr
        if (empty) transaction.insertText(label, selectionFrom, selectionTo)
        transaction.addMark(selectionFrom, selectionFrom + label.length, linkMark.create({ href: wikiNoteHref(detail.target) }))
        view.dispatch(transaction)
      }
      view.focus()
    }
    window.addEventListener(WIKI_LINK_INSERT_EVENT, insertWikiLink)
    return () => window.removeEventListener(WIKI_LINK_INSERT_EVENT, insertWikiLink)
  }, [noteId])

  useEffect(() => {
    const insertEmbed = (event: Event) => {
      const detail = (event as CustomEvent<WikiEmbedInsertDetail>).detail
      if (detail?.noteId !== noteId) return
      const editor = editorRef.current
      if (!editor) return
      const view = editor.ctx.get(editorViewCtx)
      const captured = contextRange.current
      const max = view.state.doc.content.size
      const from = Math.max(0, Math.min(captured.from, max))
      const to = Math.max(from, Math.min(captured.to, max))
      const current = view.state.selection
      if (current.from !== from || current.to !== to) {
        const selection = from === to ? TextSelection.near(view.state.doc.resolve(from)) : TextSelection.create(view.state.doc, from, to)
        view.dispatch(view.state.tr.setSelection(selection))
      }
      const nodeType = view.state.schema.nodes.noTieEmbed
      if (!nodeType) return
      const selection = view.state.selection
      let depth = selection.$from.depth
      while (depth > 0 && !selection.$from.node(depth).isTextblock) depth--
      const insertion = depth > 0 ? selection.$from.after(depth) : selection.to
      const embed = nodeType.create({ target: detail.target })
      const transaction = view.state.tr.insert(insertion, embed)
      const after = Math.min(insertion + embed.nodeSize, transaction.doc.content.size)
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(after)))
      view.dispatch(transaction)
      refreshNoteEmbeds(root.current, notesRef.current, assetsRef.current, note => onOpenNoteRef.current(note.title || note.id))
      saveEditorMarkdown(editor)
      view.focus()
    }
    window.addEventListener(WIKI_EMBED_INSERT_EVENT, insertEmbed)
    return () => window.removeEventListener(WIKI_EMBED_INSERT_EVENT, insertEmbed)
  }, [noteId])

  useEffect(() => {
    const replaceSelection = (event: Event) => {
      const detail = (event as CustomEvent<AiReplaceSelectionDetail>).detail
      if (detail?.noteId !== noteId) return
      const editor = editorRef.current
      if (!editor) return
      const view = editor.ctx.get(editorViewCtx)
      const captured = contextRange.current
      const max = view.state.doc.content.size
      const from = Math.max(0, Math.min(captured.from, max))
      const to = Math.max(from, Math.min(captured.to, max))
      const current = view.state.selection
      if (current.from !== from || current.to !== to) {
        const selection = from === to ? TextSelection.near(view.state.doc.resolve(from)) : TextSelection.create(view.state.doc, from, to)
        view.dispatch(view.state.tr.setSelection(selection))
      }
      view.dispatch(view.state.tr.insertText(detail.replacement, from, to))
      view.focus()
    }
    window.addEventListener(AI_REPLACE_SELECTION_EVENT, replaceSelection)
    return () => window.removeEventListener(AI_REPLACE_SELECTION_EVENT, replaceSelection)
  }, [noteId])

  useEffect(() => {
    function updateSelection() {
      const activeElement = document.activeElement
      if (activeElement instanceof Element && activeElement.closest('.markdown-table-tools')) return
      const selection = window.getSelection()
      const container = root.current
      const editor = editorRef.current
      if (selection && container?.contains(selection.anchorNode) && editor) {
        const range = editor.ctx.get(editorViewCtx).state.selection
        selectedRange.current = { from: range.from, to: range.to }
        const text = selection.toString()
        if (text !== lastSelectionText.current) {
          lastSelectionText.current = text
          onSelectionChangeRef.current(text)
        }
      } else if (lastSelectionText.current) {
        lastSelectionText.current = ''
        onSelectionChangeRef.current('')
      }
    }
    document.addEventListener('selectionchange', updateSelection)
    return () => document.removeEventListener('selectionchange', updateSelection)
  }, [])

  function tableTargetAt(view: EditorView, table: HTMLTableElement, row: number, column: number, clientX?: number, clientY?: number): TableTarget | null {
    let position: number | undefined
    if (clientX !== undefined && clientY !== undefined) position = view.posAtCoords({ left: clientX, top: clientY })?.pos
    if (position === undefined) {
      try { position = view.posAtDOM(table, 0) } catch { /* Use the table's last known document position. */ }
    }
    const tablePos = position === undefined ? undefined : tablePositionAt(view.state.doc, position)
    if (tablePos === undefined) return null
    return { tablePos, row: Math.max(0, row), column: Math.max(0, column), element: table }
  }

  function filterStateFor(target: TableTarget) {
    const filter = tableFilter.current
    return filter?.tablePos === target.tablePos && filter.column === target.column ? filter : null
  }

  function showFilterForTarget(target: TableTarget) {
    const filter = tableFilter.current
    if (filter && (filter.tablePos !== target.tablePos || filter.column !== target.column)) {
      tableFilter.current = null
      if (tableFilterStyle.current) tableFilterStyle.current.textContent = ''
    }
    setTableFilterView(filterStateFor(target))
  }

  function showTableContextMenu(event: ReactMouseEvent<HTMLDivElement>, table: HTMLTableElement) {
    const editor = editorRef.current
    if (!editor) return
    const view = editor.ctx.get(editorViewCtx)
    const hit = view.posAtCoords({ left: event.clientX, top: event.clientY })
    if (hit) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(hit.pos))))
    const cell = (event.target as Element).closest('th, td') as HTMLTableCellElement | null
    const row = cell?.parentElement instanceof HTMLTableRowElement ? Array.from(table.rows).indexOf(cell.parentElement) : 0
    const target = tableTargetAt(view, table, row, cell?.cellIndex ?? 0, event.clientX, event.clientY)
    if (!target) return
    activeTableElement.current = table
    showFilterForTarget(target)
    setHoverTable({ ...target, left: Math.max(8, Math.min(table.getBoundingClientRect().left, window.innerWidth - 320)), top: Math.max(8, table.getBoundingClientRect().top) })
    setContextMenu(null)
    setTableContextMenu({
      ...target,
      left: Math.max(8, Math.min(event.clientX, window.innerWidth - 278)),
      top: Math.max(8, Math.min(event.clientY, window.innerHeight - 520)),
    })
  }

  function updateTableHover(event: ReactMouseEvent<HTMLDivElement>) {
    const eventTarget = event.target
    if (!(eventTarget instanceof Element)) return
    if (eventTarget.closest('.markdown-table-tools')) {
      if (tableToolbarDismissTimer.current !== null) window.clearTimeout(tableToolbarDismissTimer.current)
      tableToolbarDismissTimer.current = null
      return
    }
    const table = eventTarget.closest('table') as HTMLTableElement | null
    const cell = eventTarget.closest('th, td') as HTMLTableCellElement | null
    if (!table || !cell) return
    const editor = editorRef.current
    if (!editor) return
    const view = editor.ctx.get(editorViewCtx)
    const row = cell.parentElement instanceof HTMLTableRowElement ? Array.from(table.rows).indexOf(cell.parentElement) : 0
    const target = tableTargetAt(view, table, row, cell.cellIndex, event.clientX, event.clientY)
    if (!target) return
    const rect = table.getBoundingClientRect()
    activeTableElement.current = table
    setHoverTable(current => current?.tablePos === target.tablePos && current.row === target.row && current.column === target.column && current.element === table
      ? current
      : { ...target, left: Math.max(8, Math.min(rect.left, window.innerWidth - 320)), top: Math.max(8, rect.top) })
    showFilterForTarget(target)
  }

  function dismissTableToolbar(event: ReactMouseEvent<HTMLDivElement>) {
    const related = event.relatedTarget
    if (!(related instanceof Element) || !related.closest('.markdown-editor')) document.body.classList.remove('table-row-cursor')
    if (related instanceof Element && (activeTableElement.current?.contains(related) || related.closest('.markdown-table-tools'))) {
      if (tableToolbarDismissTimer.current !== null) window.clearTimeout(tableToolbarDismissTimer.current)
      tableToolbarDismissTimer.current = null
      return
    }
    if (tableToolbarDismissTimer.current !== null) window.clearTimeout(tableToolbarDismissTimer.current)
    tableToolbarDismissTimer.current = window.setTimeout(() => {
      tableToolbarDismissTimer.current = null
      activeTableElement.current = null
      setHoverTable(null)
    }, 180)
  }

  function showContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest('.markdown-assist')) return
    event.preventDefault()
    const target = event.target
    if (target instanceof Element) {
      const table = target.closest('table') as HTMLTableElement | null
      if (table) {
        showTableContextMenu(event, table)
        return
      }
    }
    const editor = editorRef.current
    if (!editor) return
    const view = editor.ctx.get(editorViewCtx)
    if (view.state.selection.empty) {
      const hit = view.posAtCoords({ left: event.clientX, top: event.clientY })
      if (hit) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(hit.pos))))
    }
    const { from, to } = view.state.selection
    contextRange.current = { from, to }
    selectedRange.current = { from, to }

    const rootWidth = 214
    const menuHeight = 150
    setContextMenu({
      left: Math.max(8, Math.min(event.clientX, window.innerWidth - rootWidth - 8)),
      top: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
      opensLeft: event.clientX > window.innerWidth - 486,
      opensUp: event.clientY > window.innerHeight - 320,
    })
  }

  function startRowResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const target = event.target
    if (!(target instanceof Element) || target.closest('.markdown-table-tools')) return
    const cell = target.closest('td, th') as HTMLTableCellElement | null
    const row = cell?.parentElement
    if (!(row instanceof HTMLTableRowElement) || !cell) return
    const cellBounds = cell.getBoundingClientRect()
    if (event.clientY < cellBounds.bottom - 6 || event.clientY > cellBounds.bottom + 2) return
    event.preventDefault()
    event.stopPropagation()
    rowResize.current = { row, startY: event.clientY, startHeight: row.getBoundingClientRect().height, pointerId: event.pointerId, changed: false }
    document.body.classList.add('table-row-resizing')
  }

  function updateRowResizeCursor(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target
    if (!(target instanceof Element) || target.closest('.markdown-table-tools')) {
      document.body.classList.remove('table-row-cursor')
      return
    }
    const cell = target.closest('td, th') as HTMLTableCellElement | null
    const bounds = cell?.getBoundingClientRect()
    document.body.classList.toggle('table-row-cursor', Boolean(bounds && event.clientY >= bounds.bottom - 6 && event.clientY <= bounds.bottom + 2))
  }

  function currentTablePosition(view: EditorView, target: TableTarget) {
    if (target.element.isConnected) {
      try {
        const fromDom = tablePositionAt(view.state.doc, view.posAtDOM(target.element, 0))
        if (fromDom !== undefined) return fromDom
      } catch { /* Use the captured position if the current DOM cannot be mapped. */ }
    }
    return target.tablePos
  }

  function tableElementForTarget(view: EditorView, target: TableTarget) {
    const tablePos = currentTablePosition(view, target)
    const node = view.nodeDOM(tablePos)
    if (node instanceof HTMLTableElement) return node
    if (node instanceof Element) {
      const table = node.querySelector('table')
      if (table instanceof HTMLTableElement) return table
    }
    return target.element.isConnected ? target.element : null
  }

  function selectorFromAncestor(ancestor: HTMLElement, element: HTMLElement) {
    const parts: string[] = []
    let current: HTMLElement | null = element
    while (current && current !== ancestor) {
      const parent: HTMLElement | null = current.parentElement
      if (!parent) return null
      parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${Array.from(parent.children).indexOf(current) + 1})`)
      current = parent
    }
    return current === ancestor ? parts.join(' > ') : null
  }

  function updateTableFilterStyle(table: HTMLTableElement, column: number, value: string) {
    const container = root.current
    const style = tableFilterStyle.current
    if (!container || !style) return
    const tablePath = selectorFromAncestor(container, table)
    if (!tablePath) return
    const rules: string[] = []
    const normalized = value.trim().toLocaleLowerCase()
    if (normalized) Array.from(table.rows).forEach((row, index) => {
      if (index === 0) return
      const cellValue = row.cells[column]?.textContent?.trim().toLocaleLowerCase() ?? ''
      if (cellValue.includes(normalized)) return
      const rowPath = selectorFromAncestor(table, row)
      if (rowPath) rules.push(`.markdown-editor-canvas > ${tablePath} > ${rowPath} { display: none !important; }`)
    })
    style.textContent = rules.join('\n')
  }

  function saveEditorMarkdown(editor: Editor) {
    flushPendingMarkdownUpdate()
    const view = editor.ctx.get(editorViewCtx)
    const updated = markdownWithTableColumnWidths(markdownToWikiLinks(markdownFromEditor(editor.action(getMarkdown()), initialDocument.assets, initialDocument.attachments)), view)
    if (updated === lastMarkdown.current) return
    lastMarkdown.current = updated
    setAssistRevision(value => value + 1)
    onChangeRef.current(updated)
  }

  function flushPendingMarkdownUpdate(refreshAssist = true) {
    if (markdownUpdateTimer.current !== null) {
      window.clearTimeout(markdownUpdateTimer.current)
      markdownUpdateTimer.current = null
    }
    const pending = pendingMarkdownUpdate.current
    pendingMarkdownUpdate.current = null
    if (!pending) return
    const next = markdownWithTableColumnWidths(
      markdownToWikiLinks(markdownFromEditor(pending.markdown, initialDocument.assets, initialDocument.attachments)),
      pending.view,
    )
    if (next === lastMarkdown.current) return
    lastMarkdown.current = next
    onChangeRef.current(next)
    if (!refreshAssist) return
    if (assistUpdateTimer.current !== null) window.clearTimeout(assistUpdateTimer.current)
    assistUpdateTimer.current = window.setTimeout(() => {
      assistUpdateTimer.current = null
      setAssistRevision(value => value + 1)
    }, 300)
  }

  function navigateToHeading(heading: HeadingEntry) {
    const editor = editorRef.current
    if (!editor) return
    const view = editor.ctx.get(editorViewCtx)
    const stack: HeadingEntry[] = []
    for (const current of headings) {
      if (current.id === heading.id) break
      while (stack.length && stack.at(-1)!.level >= current.level) stack.pop()
      stack.push(current)
    }
    const collapsedAncestors = stack.filter(parent => parent.level < heading.level && foldedHeadings.has(parent.id))
    const move = () => {
      if (!view.dom.isConnected) return
      const selection = TextSelection.near(view.state.doc.resolve(Math.min(heading.pos + 1, view.state.doc.content.size)))
      view.dispatch(view.state.tr.setSelection(selection).scrollIntoView())
      view.focus()
    }
    if (collapsedAncestors.length) {
      const ids = new Set(collapsedAncestors.map(parent => parent.id))
      setFoldedHeadings(current => new Set([...current].filter(id => !ids.has(id))))
      window.requestAnimationFrame(move)
    } else move()
  }

  function goToNextMatch() {
    const editor = editorRef.current
    if (!editor || !findText.trim()) return
    const view = editor.ctx.get(editorViewCtx)
    const matches = textMatches(view.state.doc, findText)
    if (!matches.length) { setActiveFindMatch(-1); return }
    const start = view.state.selection.to
    let index = matches.findIndex(match => match.from >= start)
    if (index < 0) index = 0
    const match = matches[index]
    if (!match) return
    setActiveFindMatch(index)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, match.from, match.to)).scrollIntoView())
    view.focus()
  }

  function replaceCurrentMatch() {
    const editor = editorRef.current
    if (!editor || !findText.trim()) return
    const view = editor.ctx.get(editorViewCtx)
    const matches = textMatches(view.state.doc, findText)
    const selected = matches.find(match => match.from === view.state.selection.from && match.to === view.state.selection.to)
    if (!selected) { goToNextMatch(); return }
    view.dispatch(view.state.tr.insertText(replaceText, selected.from, selected.to).scrollIntoView())
    saveEditorMarkdown(editor)
    setActiveFindMatch(-1)
    view.focus()
  }

  function replaceEveryMatch() {
    const editor = editorRef.current
    if (!editor || !findText.trim()) return
    const view = editor.ctx.get(editorViewCtx)
    const matches = textMatches(view.state.doc, findText)
    if (!matches.length) return
    let transaction = view.state.tr
    for (const match of [...matches].reverse()) transaction = transaction.insertText(replaceText, match.from, match.to)
    view.dispatch(transaction)
    saveEditorMarkdown(editor)
    setActiveFindMatch(-1)
    view.focus()
  }

  function toggleCommentResolved(comment: InlineComment) {
    const editor = editorRef.current
    if (!editor) return
    const view = editor.ctx.get(editorViewCtx)
    const markType = view.state.schema.marks.noteComment
    if (!markType) return
    const transaction = view.state.tr
    const nextResolved = !comment.resolved
    view.state.doc.nodesBetween(comment.from, comment.to, (node, pos) => {
      if (!node.isText) return
      const mark = node.marks.find(item => item.type === markType && (comment.id.startsWith('legacy:') ? !item.attrs.id : item.attrs.id === comment.id))
      if (!mark) return
      transaction.removeMark(pos, pos + node.nodeSize, markType)
      transaction.addMark(pos, pos + node.nodeSize, markType.create({ ...mark.attrs, resolved: nextResolved }))
    })
    if (!transaction.docChanged) return
    view.dispatch(transaction)
    saveEditorMarkdown(editor)
  }

  function focusComment(comment: InlineComment) {
    const editor = editorRef.current
    if (!editor) return
    const view = editor.ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, comment.from, comment.to)).scrollIntoView())
    view.focus()
  }

  function addComment() {
    const editor = editorRef.current
    const text = commentDraft.trim()
    if (!editor || !text || !pendingCommentRange) return
    const view = editor.ctx.get(editorViewCtx)
    const max = view.state.doc.content.size
    const from = Math.max(0, Math.min(pendingCommentRange.from, max))
    const to = Math.max(from, Math.min(pendingCommentRange.to, max))
    if (from === to) return
    const commentMark = noteCommentSchema.type(editor.ctx).create({ id: crypto.randomUUID(), text, resolved: false })
    view.dispatch(view.state.tr.addMark(from, to, commentMark))
    saveEditorMarkdown(editor)
    setCommentDraft('')
    setPendingCommentRange(null)
    view.focus()
  }

  function applyTableAction(action: MarkdownTableAction, target: TableTarget, fromContextMenu: boolean) {
    const editor = editorRef.current
    if (!editor) return
    if (action === 'clear-filter') {
      tableFilter.current = null
      setTableFilterView(null)
      if (tableFilterStyle.current) tableFilterStyle.current.textContent = ''
      if (fromContextMenu) setTableContextMenu(null)
      return
    }
    let copiedMarkdown = ''
    let changedDocument = false
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      const tablePos = currentTablePosition(view, target)
      const table = view.state.doc.nodeAt(tablePos)
      if (!table || table.type.name !== 'table') return

      if (action === 'copy-table') {
        copiedMarkdown = getMarkdown({ from: tablePos, to: tablePos + table.nodeSize })(ctx).trim() || markdownForTable(table)
        return
      }
      if (action === 'add-row-before' || action === 'add-row-after' || action === 'add-column-before' || action === 'add-column-after') {
        const rows: import('@milkdown/kit/prose/model').Node[] = []
        table.forEach(row => rows.push(row))
        if (action === 'add-row-before' || action === 'add-row-after') {
          if (target.row === 0 && action === 'add-row-before') return
          const insertAfter = action === 'add-row-after'
          const insertAt = target.row + (insertAfter ? 1 : 0)
          const template = rows[target.row === 0 ? 1 : target.row] ?? rows[1]
          if (!template) return
          const cells: import('@milkdown/kit/prose/model').Node[] = []
          for (let column = 0; column < template.childCount; column++) {
            const reference = template.child(column)
            const blankCell = reference.type.createAndFill(reference.attrs, undefined, reference.marks)
            if (!blankCell) return
            cells.push(blankCell)
          }
          const blankRow = template.type.create(template.attrs, Fragment.fromArray(cells), template.marks)
          rows.splice(insertAt, 0, blankRow)
        } else {
          const insertAfter = action === 'add-column-after'
          const nextRows = rows.map(row => {
            const cells: import('@milkdown/kit/prose/model').Node[] = []
            row.forEach((cell, _offset, column) => {
              if (!insertAfter && column === target.column) {
                const blankCell = cell.type.createAndFill(cell.attrs, undefined, cell.marks)
                if (blankCell) cells.push(blankCell)
              }
              cells.push(cell)
              if (insertAfter && column === target.column) {
                const blankCell = cell.type.createAndFill(cell.attrs, undefined, cell.marks)
                if (blankCell) cells.push(blankCell)
              }
            })
            return row.copy(Fragment.fromArray(cells))
          })
          rows.splice(0, rows.length, ...nextRows)
        }
        view.dispatch(view.state.tr.replaceWith(tablePos, tablePos + table.nodeSize, table.copy(Fragment.fromArray(rows))))
        changedDocument = true
        return
      }

      const rows: import('@milkdown/kit/prose/model').Node[] = []
      table.forEach(row => rows.push(row))
      if (action === 'delete-row') {
        if (target.row === 0 || rows.length <= 2) return
        const nextRows = rows.filter((_row, index) => index !== target.row)
        view.dispatch(view.state.tr.replaceWith(tablePos, tablePos + table.nodeSize, table.copy(Fragment.fromArray(nextRows))))
        changedDocument = true
        return
      }
      if (action === 'delete-column') {
        const columnCount = rows[0]?.childCount ?? 0
        if (columnCount <= 1) return
        const nextRows = rows.map(row => {
          const cells: import('@milkdown/kit/prose/model').Node[] = []
          row.forEach((cell, _offset, column) => { if (column !== target.column) cells.push(cell) })
          return row.copy(Fragment.fromArray(cells))
        })
        view.dispatch(view.state.tr.replaceWith(tablePos, tablePos + table.nodeSize, table.copy(Fragment.fromArray(nextRows))))
        changedDocument = true
        return
      }
      if (action === 'sort-ascending' || action === 'sort-descending') {
        if (rows.length <= 2 || target.column >= (rows[0]?.childCount ?? 0)) return
        const direction = action === 'sort-ascending' ? 1 : -1
        const collator = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' })
        const sortedRows = [...rows.slice(1)].sort((left, right) => direction * collator.compare(left.child(target.column).textContent.trim(), right.child(target.column).textContent.trim()))
        view.dispatch(view.state.tr.replaceWith(tablePos, tablePos + table.nodeSize, table.copy(Fragment.fromArray([rows[0], ...sortedRows]))))
        changedDocument = true
      }
    })

    if (fromContextMenu) setTableContextMenu(null)
    if (changedDocument) {
      setTableRevision(value => value + 1)
      saveEditorMarkdown(editor)
    }
    if (copiedMarkdown) {
      void copyMarkdownToClipboard(copiedMarkdown).then(copied => {
        setTableCopied(copied)
        window.setTimeout(() => setTableCopied(false), 1500)
      })
    }
  }

  function applyTableCellColor(color: string, target: TableTarget, fromContextMenu: boolean) {
    const editor = editorRef.current
    if (!editor) return
    let changedDocument = false
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      const tablePos = currentTablePosition(view, target)
      const table = view.state.doc.nodeAt(tablePos)
      if (!table || table.type.name !== 'table') return
      const cellPos = cellPositionAt(table, tablePos, target.row, target.column)
      if (cellPos === undefined) return
      const cell = view.state.doc.nodeAt(cellPos)
      if (!cell) return
      const markType = highlightSchema.type(ctx)
      const transaction = view.state.tr
      const from = cellPos + 2
      const to = cellPos + cell.nodeSize - 2
      if (to <= from && color) {
        transaction.insert(cellPos + 2, view.state.schema.text('\u200b', [markType.create({ color })]))
      } else {
        if (to <= from) return
        transaction.removeMark(from, to, markType)
        if (color) transaction.addMark(from, to, markType.create({ color }))
        else if (cell.textContent === '\u200b') transaction.delete(from, to)
      }
      if (transaction.docChanged) {
        view.dispatch(transaction)
        changedDocument = true
      }
    })
    if (fromContextMenu) setTableContextMenu(null)
    if (changedDocument) saveEditorMarkdown(editor)
  }

  function setFilterForTable(value: string, target: TableTarget) {
    tableFilter.current = { tablePos: target.tablePos, column: target.column, value }
    setTableFilterView(tableFilter.current)
    const editor = editorRef.current
    if (!editor) return
    const table = tableElementForTarget(editor.ctx.get(editorViewCtx), target)
    if (!table) return
    updateTableFilterStyle(table, target.column, value)
  }

  function openWikiLink(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target
    if (!(target instanceof Element)) return
    const attachmentAnchor = target.closest<HTMLAnchorElement>('a[href^="no-tie-attachment:"]')
    if (attachmentAnchor) {
      event.preventDefault()
      try {
        const reference = attachmentAnchor.getAttribute('href')?.slice('no-tie-attachment:'.length) ?? ''
        const suffixIndex = reference.search(/[?#]/)
        const encodedName = suffixIndex < 0 ? reference : reference.slice(0, suffixIndex)
        const suffix = suffixIndex < 0 ? '' : reference.slice(suffixIndex + 1)
        const parameters = new URLSearchParams(suffix)
        const page = Number(parameters.get('page'))
        const fragment = parameters.get('search') ?? parameters.get('fragment') ?? ''
        onOpenAttachmentRef.current(decodeURIComponent(encodedName), Number.isFinite(page) && page > 0 ? page : undefined, fragment)
      } catch { /* Ignore malformed attachment references. */ }
      return
    }
    const anchor = target.closest<HTMLAnchorElement>('a[href^="#no-tie-note/"], a[href^="notie-note:"]')
    if (!anchor) return
    const noteTarget = wikiNoteTargetFromHref(anchor.getAttribute('href') ?? '')
    if (noteTarget === null) return
    event.preventDefault()
    onOpenNoteRef.current(noteTarget)
  }

  useEffect(() => {
    const filter = tableFilter.current
    const editor = editorRef.current
    if (!filter || !filter.value.trim() || !editor) {
      if (tableFilterStyle.current) tableFilterStyle.current.textContent = ''
      return
    }
    const view = editor.ctx.get(editorViewCtx)
    const dom = view.nodeDOM(filter.tablePos)
    const table = dom instanceof HTMLTableElement ? dom : dom instanceof Element ? dom.querySelector('table') : null
    if (!(table instanceof HTMLTableElement)) return
    const apply = () => updateTableFilterStyle(table, filter.column, filter.value)
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(table, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
    }
  }, [noteId, tableFilterView, tableRevision])

  useEffect(() => {
    if (!hoverTable) return
    const syncPosition = () => {
      const rect = hoverTable.element.getBoundingClientRect()
      if (!hoverTable.element.isConnected) {
        setHoverTable(null)
        return
      }
      setHoverTable(current => current ? { ...current, left: Math.max(8, Math.min(rect.left, window.innerWidth - 320)), top: Math.max(8, rect.top) } : current)
    }
    window.addEventListener('scroll', syncPosition, true)
    window.addEventListener('resize', syncPosition)
    return () => {
      window.removeEventListener('scroll', syncPosition, true)
      window.removeEventListener('resize', syncPosition)
    }
  }, [hoverTable])

  function applyAction(action: MarkdownMenuAction) {
    const editor = editorRef.current
    if (!editor) return
    const savedRange = contextRange.current
    setContextMenu(null)

    editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      const max = view.state.doc.content.size
      const from = Math.max(0, Math.min(savedRange.from, max))
      const to = Math.max(from, Math.min(savedRange.to, max))
      const current = view.state.selection
      if (current.from !== from || current.to !== to) {
        const selection = from === to
          ? TextSelection.near(view.state.doc.resolve(from))
          : TextSelection.create(view.state.doc, from, to)
        view.dispatch(view.state.tr.setSelection(selection))
      }

      const range = { from: view.state.selection.from, to: view.state.selection.to }
      const selectedText = view.state.doc.textBetween(range.from, range.to, '\n')
      const replace = (source: string, replacementRange = range) => replaceRange(source, replacementRange)(ctx)
      const toggle = (mark: ReturnType<typeof strongSchema.type>, attrs?: Record<string, string>) => {
        toggleProseMark(mark, attrs)(view.state, transaction => view.dispatch(transaction), view)
      }
      const commands = ctx.get(commandsCtx)

      switch (action) {
        case 'bold': commands.call(toggleStrongCommand.key); break
        case 'italic': commands.call(toggleEmphasisCommand.key); break
        case 'strike': commands.call(toggleStrikethroughCommand.key); break
        case 'underline': toggle(underlineSchema.type(ctx)); break
        case 'highlight': toggle(highlightSchema.type(ctx), { color: '#fff176' }); break
        case 'code': commands.call(toggleInlineCodeCommand.key); break
        case 'inline-math': replace(`$${selectedText || 'x'}$`); break
        case 'comment': {
          if (range.from === range.to) {
            window.alert('Zaznacz tekst, do którego ma być przypięty komentarz.')
            break
          }
          setPendingCommentRange(range)
          setCommentDraft('')
          setAssistPanel('comments')
          break
        }
        case 'clear-format': {
          const transaction = view.state.tr
          if (range.from === range.to) transaction.setStoredMarks([])
          else Object.values(view.state.schema.marks).forEach(mark => transaction.removeMark(range.from, range.to, mark))
          view.dispatch(transaction)
          break
        }
        case 'bullet-list': commands.call(wrapInBulletListCommand.key); break
        case 'ordered-list': commands.call(wrapInOrderedListCommand.key); break
        case 'task-list': {
          const listItemType = view.state.schema.nodes.list_item
          if (!listItemType) break
          const markSelectedItemsAsTasks = () => {
            const { from: selectedFrom, to: selectedTo } = view.state.selection
            const transaction = view.state.tr
            let updatedItems = 0
            view.state.doc.descendants((node, position) => {
              if (node.type !== listItemType) return true
              const overlapsSelection = selectedFrom === selectedTo
                ? position <= selectedFrom && position + node.nodeSize >= selectedFrom
                : position < selectedTo && position + node.nodeSize > selectedFrom
              if (overlapsSelection) {
                transaction.setNodeMarkup(position, undefined, { ...node.attrs, checked: false })
                updatedItems++
                return false
              }
              return true
            })
            if (transaction.docChanged) view.dispatch(transaction)
            return updatedItems
          }
          if (!markSelectedItemsAsTasks()) {
            commands.call(wrapInBulletListCommand.key)
            markSelectedItemsAsTasks()
          }
          break
        }
        case 'heading-1': commands.call(wrapInHeadingCommand.key, 1); break
        case 'heading-2': commands.call(wrapInHeadingCommand.key, 2); break
        case 'heading-3': commands.call(wrapInHeadingCommand.key, 3); break
        case 'paragraph': commands.call(turnIntoTextCommand.key); break
        case 'blockquote': commands.call(wrapInBlockquoteCommand.key); break
        case 'footnote': {
          const referenceType = view.state.schema.nodes.footnote_reference
          const definitionType = view.state.schema.nodes.footnote_definition
          const paragraphType = view.state.schema.nodes.paragraph
          if (!referenceType || !definitionType || !paragraphType) break
          const usedLabels = new Set<string>()
          view.state.doc.descendants(node => {
            if (node.type === referenceType || node.type === definitionType) usedLabels.add(String(node.attrs.label ?? ''))
            return true
          })
          let number = 1
          while (usedLabels.has(String(number))) number++
          const label = String(number)
          const reference = referenceType.create({ label })
          const definitionText = view.state.schema.text('Treść przypisu')
          const definition = definitionType.create({ label }, paragraphType.create(null, definitionText))
          let transaction = view.state.tr.insert(range.to, reference)
          const cursor = range.to + reference.nodeSize
          transaction = transaction.insert(transaction.doc.content.size, definition)
          transaction = transaction.setSelection(TextSelection.near(transaction.doc.resolve(Math.min(cursor, transaction.doc.content.size))))
          view.dispatch(transaction)
          break
        }
        case 'table': {
          const firstHeader = selectedText.trim().replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ') || 'Kolumna 1'
          replace(`\n\n| ${firstHeader} | Kolumna 2 |\n| --- | --- |\n|  |  |\n\n`)
          break
        }
        case 'callout': {
          const lines = (selectedText || 'Wyróżniony tekst').split('\n').map(line => `> ${line}`).join('\n')
          replace(`\n\n> **Wyróżnienie**\n>\n${lines}\n\n`)
          break
        }
        case 'horizontal-rule': replace('\n\n---\n\n'); break
        case 'code-block': commands.call(createCodeBlockCommand.key); break
        case 'math-block': replace(`\n\n$$\n${selectedText || 'x'}\n$$\n\n`); break
      }
      view.focus()
    })
    const updated = markdownWithTableColumnWidths(markdownToWikiLinks(markdownFromEditor(editor.action(getMarkdown()), initialDocument.assets, initialDocument.attachments)), editor.ctx.get(editorViewCtx))
    if (updated !== lastMarkdown.current) {
      lastMarkdown.current = updated
      setAssistRevision(value => value + 1)
      onChangeRef.current(updated)
    }
  }

  const currentFindMatches = assistPanel === 'find' && editorRef.current && findText.trim()
    ? textMatches(editorRef.current.ctx.get(editorViewCtx).state.doc, findText)
    : []
  const currentMarkdownWarnings = assistPanel === 'validation' && validationOptions.markdown ? markdownWarnings(markdown, notes) : []

  return <div
    className="markdown-editor"
    aria-label="Treść notatki"
    aria-readonly={readOnly}
    onPointerDown={readOnly ? undefined : startRowResize}
    onContextMenu={readOnly ? undefined : showContextMenu}
    onMouseOver={readOnly ? undefined : updateTableHover}
    onMouseMove={readOnly ? undefined : updateRowResizeCursor}
    onMouseOut={readOnly ? undefined : dismissTableToolbar}
    onClick={readOnly ? undefined : openWikiLink}
  >
    {!readOnly && <div className="markdown-assist">
      <div className="markdown-assist-toolbar" role="toolbar" aria-label="Narzędzia edytora">
        <button type="button" className={assistPanel === 'outline' ? 'active' : ''} onClick={() => setAssistPanel(current => current === 'outline' ? null : 'outline')}>Spis nagłówków</button>
        <button type="button" className={assistPanel === 'find' ? 'active' : ''} onClick={() => setAssistPanel(current => current === 'find' ? null : 'find')}>Znajdź i zamień</button>
        <button type="button" className={assistPanel === 'comments' ? 'active' : ''} onClick={() => {
          const range = selectedRange.current
          if (range.to > range.from) setPendingCommentRange(range)
          setAssistPanel(current => current === 'comments' ? null : 'comments')
        }}>Komentarze{comments.length ? ` · ${comments.filter(comment => !comment.resolved).length}` : ''}</button>
        <button type="button" className={assistPanel === 'validation' ? 'active' : ''} onClick={() => setAssistPanel(current => current === 'validation' ? null : 'validation')}>Sprawdzanie</button>
        <button type="button" className={assistPanel === 'shortcuts' ? 'active' : ''} onClick={() => setAssistPanel(current => current === 'shortcuts' ? null : 'shortcuts')}>Skróty</button>
        <button type="button" className={`markdown-focus-toggle ${focusMode ? 'active' : ''}`} onClick={() => setFocusMode(value => !value)}>{focusMode ? 'Wyjdź ze skupienia' : 'Tryb skupienia'}</button>
      </div>
      {assistPanel === 'outline' && <section className="markdown-assist-panel markdown-outline-panel" aria-label="Spis nagłówków">
        <strong>Nagłówki w tej notatce</strong>
        {headings.length ? headings.map(heading => <div className={`markdown-outline-row level-${heading.level}`} key={heading.id}>
          <button type="button" className="markdown-outline-jump" onClick={() => navigateToHeading(heading)} title="Przejdź do nagłówka">{heading.text}</button>
          <button type="button" className="markdown-fold-toggle" aria-label={`${foldedHeadings.has(heading.id) ? 'Rozwiń' : 'Zwiń'} sekcję ${heading.text}`} title={`${foldedHeadings.has(heading.id) ? 'Rozwiń' : 'Zwiń'} sekcję`} onClick={() => {
            const editor = editorRef.current
            if (editor) navigateToHeading(heading)
            setFoldedHeadings(current => { const next = new Set(current); if (next.has(heading.id)) next.delete(heading.id); else next.add(heading.id); return next })
          }}>{foldedHeadings.has(heading.id) ? '＋' : '−'}</button>
        </div>) : <span className="markdown-assist-empty">Dodaj nagłówki Markdown, aby zbudować spis.</span>}
      </section>}
      {assistPanel === 'find' && <section className="markdown-assist-panel markdown-find-panel" aria-label="Znajdź i zamień">
        <label>Szukaj<input value={findText} onChange={event => { setFindText(event.target.value); setActiveFindMatch(-1) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); goToNextMatch() } }} placeholder="Tekst w tej notatce" /></label>
        <label>Zamień na<input value={replaceText} onChange={event => setReplaceText(event.target.value)} placeholder="Nowy tekst" /></label>
        <div className="markdown-assist-actions"><span>{currentFindMatches.length ? `${currentFindMatches.length} wyników${activeFindMatch >= 0 ? ` · ${activeFindMatch + 1} z ${currentFindMatches.length}` : ''}` : 'Brak wyników'}</span><button type="button" onClick={goToNextMatch} disabled={!currentFindMatches.length}>Następny</button><button type="button" onClick={replaceCurrentMatch} disabled={!currentFindMatches.length}>Zamień</button><button type="button" onClick={replaceEveryMatch} disabled={!currentFindMatches.length}>Zamień wszystkie</button></div>
      </section>}
      {assistPanel === 'comments' && <section className="markdown-assist-panel markdown-comments-panel" aria-label="Komentarze do zaznaczeń">
        <strong>Komentarze przypięte do tekstu</strong>
        <div className="markdown-comment-compose">
          <textarea value={commentDraft} onChange={event => setCommentDraft(event.target.value)} placeholder="Napisz komentarz do zaznaczonego fragmentu…" aria-label="Treść nowego komentarza" />
          <div><span>{pendingCommentRange ? `Fragment: „${editorRef.current?.ctx.get(editorViewCtx).state.doc.textBetween(pendingCommentRange.from, pendingCommentRange.to, ' ').slice(0, 100)}”` : 'Zaznacz tekst w notatce, aby przypiąć komentarz.'}</span><button type="button" onClick={addComment} disabled={!pendingCommentRange || !commentDraft.trim()}>Dodaj komentarz</button></div>
        </div>
        {comments.length ? comments.map(comment => <article className={`markdown-comment-card ${comment.resolved ? 'is-resolved' : ''}`} key={comment.id}>
          <button type="button" className="markdown-comment-anchor" onClick={() => focusComment(comment)}><span>„{comment.excerpt || 'zaznaczenie'}”</span><small>{comment.text || 'Starsze oznaczenie komentarza'}</small></button>
          <button type="button" onClick={() => toggleCommentResolved(comment)}>{comment.resolved ? 'Otwórz ponownie' : 'Rozwiąż'}</button>
        </article>) : <span className="markdown-assist-empty">Zaznacz fragment i wybierz „Komentarz” z menu kontekstowego.</span>}
      </section>}
      {assistPanel === 'shortcuts' && <section className="markdown-assist-panel markdown-shortcuts-panel" aria-label="Skróty klawiszowe">
        <strong>Ustaw skróty dla narzędzi edytora</strong>
        {([['find', 'Znajdź i zamień'], ['outline', 'Spis nagłówków'], ['comments', 'Komentarze'], ['focus', 'Tryb skupienia']] as [ShortcutAction, string][]).map(([action, label]) => <div className="markdown-shortcut-row" key={action}><span>{label}</span><kbd>{capturingShortcut === action ? 'Naciśnij skrót…' : shortcuts[action]}</kbd><button type="button" onClick={() => setCapturingShortcut(action)}>{capturingShortcut === action ? 'Oczekiwanie…' : 'Zmień'}</button></div>)}
        <small>Użyj Ctrl/⌘, Alt lub Shift razem z klawiszem. Esc anuluje zmianę.</small>
      </section>}
      {assistPanel === 'validation' && <section className="markdown-assist-panel markdown-validation-panel" aria-label="Sprawdzanie treści">
        <strong>Kontrola podczas pisania</strong>
        <label><input type="checkbox" checked={validationOptions.spelling} onChange={event => setValidationOptions(current => ({ ...current, spelling: event.target.checked }))} />Sprawdzanie pisowni systemu</label>
        <label><input type="checkbox" checked={validationOptions.markdown} onChange={event => setValidationOptions(current => ({ ...current, markdown: event.target.checked }))} />Kontroluj składnię Markdown i linki</label>
        {validationOptions.markdown && <ul>{currentMarkdownWarnings.map((warning, index) => <li key={`${warning}:${index}`} className={warning.startsWith('Nie znaleziono problemów') ? 'is-valid' : ''}>{warning}</li>)}</ul>}
      </section>}
    </div>}
    <div className="markdown-editor-canvas" ref={root} />
    {contextMenu && <MarkdownContextMenu {...contextMenu} noteActions={noteActions} onNoteAction={action => { setContextMenu(null); onNoteAction(action) }} onAction={applyAction} onDismiss={() => setContextMenu(null)} />}
    {!tableContextMenu && hoverTable && <MarkdownTableMenu
      key={`hover-${hoverTable.tablePos}-${hoverTable.row}-${hoverTable.column}`}
      mode="toolbar"
      left={hoverTable.left}
      top={hoverTable.top}
      row={hoverTable.row}
      column={hoverTable.column}
      filterValue={tableFilterView?.tablePos === hoverTable.tablePos && tableFilterView.column === hoverTable.column ? tableFilterView.value : ''}
      copied={tableCopied}
      onAction={action => applyTableAction(action, hoverTable, false)}
      onCellColor={color => applyTableCellColor(color, hoverTable, false)}
      onFilterChange={value => setFilterForTable(value, hoverTable)}
      onDismiss={() => { activeTableElement.current = null; setHoverTable(null) }}
    />}
    {tableContextMenu && <MarkdownTableMenu
      key={`context-${tableContextMenu.tablePos}-${tableContextMenu.row}-${tableContextMenu.column}`}
      mode="context"
      left={tableContextMenu.left}
      top={tableContextMenu.top}
      row={tableContextMenu.row}
      column={tableContextMenu.column}
      filterValue={tableFilterView?.tablePos === tableContextMenu.tablePos && tableFilterView.column === tableContextMenu.column ? tableFilterView.value : ''}
      copied={tableCopied}
      onAction={action => applyTableAction(action, tableContextMenu, true)}
      onCellColor={color => applyTableCellColor(color, tableContextMenu, true)}
      onFilterChange={value => setFilterForTable(value, tableContextMenu)}
      onDismiss={() => setTableContextMenu(null)}
    />}
  </div>
}
