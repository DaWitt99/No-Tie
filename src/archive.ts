import { invoke, isTauri } from '@tauri-apps/api/core'
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

function archiveBlob(archive: Uint8Array): Blob {
  const buffer = new ArrayBuffer(archive.byteLength)
  new Uint8Array(buffer).set(archive)
  return new Blob([buffer], { type: 'application/zip' })
}

export function downloadArchive(notes: Note[], assets: NoteAsset[]) {
  const archive = buildArchive(notes, assets)
  const blob = archiveBlob(archive)
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = archiveFileName()
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(href), 1000)
}

function archiveFileName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-')
  return `no-tie-notatki-${stamp.slice(0, 19)}.zip`
}

type WritableFile = {
  write(data: Blob): Promise<void>
  close(): Promise<void>
}

type DirectoryHandle = {
  name: string
  getFileHandle(name: string, options: { create: boolean }): Promise<{ createWritable(): Promise<WritableFile> }>
}

type FilePickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: 'readwrite' }) => Promise<DirectoryHandle>
  showSaveFilePicker?: (options?: { suggestedName?: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable(): Promise<WritableFile> }>
}

export async function exportArchiveToFolder(notes: Note[], assets: NoteAsset[]): Promise<string | null> {
  const archive = buildArchive(notes, assets)
  const fileName = archiveFileName()
  const blob = archiveBlob(archive)

  if (isTauri()) {
    return invoke<string | null>('save_archive_file', {
      fileName,
      bytes: Array.from(archive),
    })
  }

  const picker = window as FilePickerWindow
  if (picker.showDirectoryPicker) {
    const directory = await picker.showDirectoryPicker({ mode: 'readwrite' })
    const file = await directory.getFileHandle(fileName, { create: true })
    const writable = await file.createWritable()
    await writable.write(blob)
    await writable.close()
    return `${directory.name}/${fileName}`
  }

  if (picker.showSaveFilePicker) {
    const file = await picker.showSaveFilePicker({
      suggestedName: fileName,
      types: [{ description: 'Paczka ZIP', accept: { 'application/zip': ['.zip'] } }],
    })
    const writable = await file.createWritable()
    await writable.write(blob)
    await writable.close()
    return fileName
  }

  downloadArchive(notes, assets)
  return fileName
}
