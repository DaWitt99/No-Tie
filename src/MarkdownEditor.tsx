import { useEffect, useRef, useState } from 'react'
import { Editor, defaultValueCtx, rootCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { markdownForEditor, markdownFromEditor } from './content'
import type { NoteAsset } from './types'

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
  const onChangeRef = useRef(onChange)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const [initialDocument] = useState(() => ({ markdown, assets }))

  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange }, [onSelectionChange])

  useEffect(() => {
    if (!root.current) return
    const editor = Editor.make()
      .config(ctx => {
        ctx.set(rootCtx, root.current!)
        ctx.set(defaultValueCtx, markdownForEditor(initialDocument.markdown, initialDocument.assets))
        ctx.get(listenerCtx).markdownUpdated((_ctx, updated) => {
          onChangeRef.current(markdownFromEditor(updated, initialDocument.assets))
        })
      })
      .use(commonmark)
      .use(listener)
    void editor.create()
    return () => { void editor.destroy() }
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

  return <div className="markdown-editor" ref={root} aria-label="Treść notatki" />
}
