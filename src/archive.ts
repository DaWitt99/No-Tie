import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { markdownToNote, noteToMarkdown, sanitizeSvg } from './content'
import type { Note, NoteAsset } from './types'

function safeFilePart(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'notatka'
}

export function buildArchive(notes: Note[], assets: NoteAsset[]): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  notes.forEach(note => {
    const folder = `notatki/${safeFilePart(note.title)}-${note.id}`
    files[`${folder}/notatka.md`] = strToU8(noteToMarkdown(note))
    assets.filter(asset => asset.noteId === note.id).forEach(asset => {
      files[`${folder}/assets/${asset.fileName}`] = strToU8(sanitizeSvg(asset.svg))
    })
  })
  return zipSync(files, { level: 6 })
}

export function parseArchive(bytes: Uint8Array): { notes: Note[]; assets: NoteAsset[] } {
  const files = unzipSync(bytes)
  const notes: Note[] = []
  const assets: NoteAsset[] = []
  const markdownPaths = Object.keys(files).filter(path => path.toLowerCase().endsWith('.md'))

  for (const path of markdownPaths) {
    const markdown = strFromU8(files[path])
    const idFromPath = path.split('/').at(-2) ?? crypto.randomUUID()
    const note = markdownToNote(markdown, idFromPath)
    notes.push(note)
    const baseDirectory = path.slice(0, path.lastIndexOf('/'))
    for (const assetPath of Object.keys(files)) {
      const prefix = `${baseDirectory}/assets/`
      if (!assetPath.startsWith(prefix) || !assetPath.toLowerCase().endsWith('.svg')) continue
      const fileName = assetPath.slice(prefix.length).split('/').at(-1)
      if (!fileName) continue
      assets.push({
        id: `${note.id}:${fileName}`,
        noteId: note.id,
        fileName,
        svg: sanitizeSvg(strFromU8(files[assetPath])),
      })
    }
  }
  if (!notes.length) throw new Error('W paczce nie znaleziono plików Markdown.')
  return { notes, assets }
}

export function downloadArchive(notes: Note[], assets: NoteAsset[]) {
  const archive = buildArchive(notes, assets)
  const buffer = new ArrayBuffer(archive.byteLength)
  new Uint8Array(buffer).set(archive)
  const blob = new Blob([buffer], { type: 'application/zip' })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = `no-tie-notatki-${new Date().toISOString().slice(0, 10)}.zip`
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(href), 1000)
}
