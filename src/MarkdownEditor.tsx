import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { commandsCtx, defaultValueCtx, editorViewCtx, Editor, rootCtx } from '@milkdown/kit/core'
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
import { gfm, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { toggleMark as toggleProseMark } from '@milkdown/kit/prose/commands'
import { TextSelection } from '@milkdown/kit/prose/state'
import { getMarkdown, replaceAll, replaceRange } from '@milkdown/kit/utils'
import { markdownForEditor, markdownFromEditor } from './content'
import { MarkdownContextMenu, type MarkdownMenuAction } from './MarkdownContextMenu'
import { highlightSchema, markdownMarkupPlugins, noteCommentSchema, underlineSchema } from './markdownMarkup'
import type { NoteAsset } from './types'

type ContextMenuState = { left: number; top: number; opensLeft: boolean }

export function MarkdownEditor({
  noteId,
  markdown,
  assets,
  revision,
  onChange,
  onSelectionChange,
}: {
  noteId: string
  markdown: string
  assets: NoteAsset[]
  revision: number
  onChange: (markdown: string) => void
  onSelectionChange: (text: string) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const contextRange = useRef({ from: 0, to: 0 })
  const onChangeRef = useRef(onChange)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [initialDocument] = useState(() => ({ markdown, assets }))
  const lastMarkdown = useRef(initialDocument.markdown)

  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange }, [onSelectionChange])

  useEffect(() => {
    if (!root.current) return
    lastMarkdown.current = initialDocument.markdown
    const editor = Editor.make()
      .config(ctx => {
        ctx.set(rootCtx, root.current!)
        ctx.set(defaultValueCtx, markdownForEditor(initialDocument.markdown, initialDocument.assets))
        ctx.get(listenerCtx).markdownUpdated((_ctx, updated) => {
          const next = markdownFromEditor(updated, initialDocument.assets)
          if (next === lastMarkdown.current) return
          lastMarkdown.current = next
          onChangeRef.current(next)
        })
      })
      .use([...commonmark, ...gfm, ...markdownMarkupPlugins, listener])
    void editor.create().then(() => { editorRef.current = editor }).catch(error => console.error('Nie udało się uruchomić edytora Markdown', error))
    return () => {
      editorRef.current = null
      void editor.destroy()
    }
  }, [noteId, revision, initialDocument])

  useEffect(() => {
    function updateSelection() {
      const selection = window.getSelection()
      const container = root.current
      if (selection && container?.contains(selection.anchorNode)) onSelectionChangeRef.current(selection.toString())
      else onSelectionChangeRef.current('')
    }
    document.addEventListener('selectionchange', updateSelection)
    return () => document.removeEventListener('selectionchange', updateSelection)
  }, [])

  function showContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault()
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
    const updated = markdownFromEditor(editor.action(getMarkdown()), initialDocument.assets)
    if (updated !== lastMarkdown.current) {
      lastMarkdown.current = updated
      onChangeRef.current(updated)
    }
  }

  return <div className="markdown-editor" ref={root} aria-label="Treść notatki" onContextMenu={showContextMenu}>
    {contextMenu && <MarkdownContextMenu {...contextMenu} onAction={applyAction} onDismiss={() => setContextMenu(null)} />}
  </div>
}
