import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { commandsCtx, defaultValueCtx, editorViewCtx, Editor, rootCtx } from '@milkdown/kit/core'
import { Fragment } from '@milkdown/kit/prose/model'
import {
  commonmark,
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
import { getMarkdown, replaceAll, replaceRange } from '@milkdown/kit/utils'
import { markdownForEditor, markdownFromEditor } from './content'
import { MarkdownContextMenu, type MarkdownMenuAction } from './MarkdownContextMenu'
import { MarkdownTableMenu, type MarkdownTableAction } from './MarkdownTableMenu'
import { highlightSchema, markdownMarkupPlugins, noteCommentSchema, underlineSchema } from './markdownMarkup'
import { applyTableColumnWidths, markdownWithTableColumnWidths, parseTableColumnWidths, stripTableWidthMetadata } from './markdownTableWidths'
import { AI_REPLACE_SELECTION_EVENT, WIKI_EMBED_INSERT_EVENT, WIKI_LINK_INSERT_EVENT, markdownToWikiLinks, wikiLinksToMarkdown, wikiNoteHref, wikiNoteTargetFromHref, type AiReplaceSelectionDetail, type WikiEmbedInsertDetail, type WikiLinkInsertDetail } from './wikiLinks'
import type { NoteAsset, NoteAttachment } from './types'

type ContextMenuState = { left: number; top: number; opensLeft: boolean }
type TableTarget = { tablePos: number; row: number; column: number; element: HTMLTableElement }
type TableOverlayState = TableTarget & { left: number; top: number }
type TableContextState = TableTarget & { left: number; top: number }
type TableFilterState = { tablePos: number; column: number; value: string }

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
}: {
  noteId: string
  markdown: string
  assets: NoteAsset[]
  attachments: NoteAttachment[]
  revision: number
  onChange: (markdown: string) => void
  onSelectionChange: (text: string) => void
  onOpenNote: (target: string) => void
  onOpenAttachment: (fileName: string) => void
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
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [hoverTable, setHoverTable] = useState<TableOverlayState | null>(null)
  const [tableContextMenu, setTableContextMenu] = useState<TableContextState | null>(null)
  const tableFilter = useRef<TableFilterState | null>(null)
  const [tableFilterView, setTableFilterView] = useState<TableFilterState | null>(null)
  const [tableRevision, setTableRevision] = useState(0)
  const [tableCopied, setTableCopied] = useState(false)
  const [initialDocument] = useState(() => ({ markdown, assets, attachments }))
  const lastMarkdown = useRef(initialDocument.markdown)

  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange }, [onSelectionChange])
  useEffect(() => { onOpenNoteRef.current = onOpenNote }, [onOpenNote])
  useEffect(() => { onOpenAttachmentRef.current = onOpenAttachment }, [onOpenAttachment])
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
          const next = markdownWithTableColumnWidths(markdownToWikiLinks(markdownFromEditor(updated, initialDocument.assets, initialDocument.attachments)), _ctx.get(editorViewCtx))
          if (next === lastMarkdown.current) return
          lastMarkdown.current = next
          onChangeRef.current(next)
        })
      })
      .use([...commonmark, columnResizingPlugin, ...gfm, ...markdownMarkupPlugins, listener])
    void editor.create().then(() => {
      editorRef.current = editor
      const widths = parseTableColumnWidths(initialDocument.markdown)
      if (widths.length) applyTableColumnWidths(editor.ctx.get(editorViewCtx), widths)
    }).catch(error => console.error('Nie udało się uruchomić edytora Markdown', error))
    return () => {
      editorRef.current = null
      void editor.destroy()
    }
  }, [noteId, revision, initialDocument])

  useEffect(() => {
    const insertWikiLink = (event: Event) => {
      const detail = (event as CustomEvent<WikiLinkInsertDetail>).detail
      if (detail?.noteId !== noteId || !detail.target) return
      const editor = editorRef.current
      if (!editor) return
      const view = editor.ctx.get(editorViewCtx)
      const { from, to, empty } = view.state.selection
      const label = empty ? detail.target : view.state.doc.textBetween(from, to, '\n')
      const linkMark = view.state.schema.marks.link
      if (!linkMark) view.dispatch(view.state.tr.insertText(`[[${detail.target}]]`, from, to))
      else {
        const transaction = view.state.tr
        if (empty) transaction.insertText(label, from, to)
        transaction.addMark(from, from + label.length, linkMark.create({ href: wikiNoteHref(detail.target) }))
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
      const { from, to } = selectedRange.current
      view.dispatch(view.state.tr.insertText(`![[${detail.target}]]`, from, to))
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
      const { from, to } = selectedRange.current
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
        onSelectionChangeRef.current(selection.toString())
      } else onSelectionChangeRef.current('')
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

    const rootWidth = 214
    const menuHeight = 150
    setContextMenu({
      left: Math.max(8, Math.min(event.clientX, window.innerWidth - rootWidth - 8)),
      top: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
      opensLeft: event.clientX > window.innerWidth - 486,
    })
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
      if (rowPath) rules.push(`.markdown-editor > ${tablePath} > ${rowPath} { display: none !important; }`)
    })
    style.textContent = rules.join('\n')
  }

  function saveEditorMarkdown(editor: Editor) {
    const view = editor.ctx.get(editorViewCtx)
    const updated = markdownWithTableColumnWidths(markdownToWikiLinks(markdownFromEditor(editor.action(getMarkdown()), initialDocument.assets, initialDocument.attachments)), view)
    if (updated === lastMarkdown.current) return
    lastMarkdown.current = updated
    onChangeRef.current(updated)
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
      try { onOpenAttachmentRef.current(decodeURIComponent(attachmentAnchor.getAttribute('href')?.slice('no-tie-attachment:'.length) ?? '')) } catch { /* Ignore malformed attachment names. */ }
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
        case 'comment': toggle(noteCommentSchema.type(ctx)); break
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
          const items = (selectedText || 'Zadanie').split('\n').map(line => `- [ ] ${line}`)
          replace(items.join('\n'))
          break
        }
        case 'heading-1': commands.call(wrapInHeadingCommand.key, 1); break
        case 'heading-2': commands.call(wrapInHeadingCommand.key, 2); break
        case 'heading-3': commands.call(wrapInHeadingCommand.key, 3); break
        case 'paragraph': commands.call(turnIntoTextCommand.key); break
        case 'blockquote': commands.call(wrapInBlockquoteCommand.key); break
        case 'footnote': {
          const markdown = getMarkdown()(ctx)
          let number = 1
          while (markdown.includes(`[^nt${number}]`)) number++
          const insertion = range.to
          const prefix = getMarkdown({ from: 0, to: insertion })(ctx)
          const prefixWithoutTrailingLineBreaks = prefix.replace(/[\r\n]+$/, '')
          const markdownOffset = markdown.startsWith(prefixWithoutTrailingLineBreaks) ? prefixWithoutTrailingLineBreaks.length : markdown.length
          const withReference = `${markdown.slice(0, markdownOffset)}[^nt${number}]${markdown.slice(markdownOffset)}`
          const footerSeparator = withReference.endsWith('\n\n') ? '' : withReference.endsWith('\n') ? '\n' : '\n\n'
          replaceAll(`${withReference}${footerSeparator}[^nt${number}]: Treść przypisu\n`)(ctx)
          const cursor = Math.min(insertion + 1, view.state.doc.content.size)
          view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(cursor))))
          break
        }
        case 'table': replace('\n\n| Kolumna 1 | Kolumna 2 |\n| --- | --- |\n|  |  |\n\n'); break
        case 'callout': {
          const lines = (selectedText || 'Wyróżniony tekst').split('\n').map(line => `> ${line}`).join('\n')
          replace(`\n\n> **Wyróżnienie**\n>\n${lines}\n\n`)
          break
        }
        case 'horizontal-rule': replace('\n\n---\n\n'); break
        case 'code-block': replace(`\n\n\`\`\`\n${selectedText}\n\`\`\`\n\n`); break
        case 'math-block': replace(`\n\n$$\n${selectedText || 'x'}\n$$\n\n`); break
      }
      view.focus()
    })
    const updated = markdownWithTableColumnWidths(markdownToWikiLinks(markdownFromEditor(editor.action(getMarkdown()), initialDocument.assets, initialDocument.attachments)), editor.ctx.get(editorViewCtx))
    if (updated !== lastMarkdown.current) {
      lastMarkdown.current = updated
      onChangeRef.current(updated)
    }
  }

  return <div
    className="markdown-editor"
    ref={root}
    aria-label="Treść notatki"
    onContextMenu={showContextMenu}
    onMouseOver={updateTableHover}
    onMouseOut={dismissTableToolbar}
    onClick={openWikiLink}
  >
    {contextMenu && <MarkdownContextMenu {...contextMenu} onAction={applyAction} onDismiss={() => setContextMenu(null)} />}
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
