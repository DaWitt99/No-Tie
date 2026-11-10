import { invoke, isTauri } from '@tauri-apps/api/core'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { markdownToNote, noteToMarkdown, sanitizeSvg } from './content'
import type { Note, NoteAsset, NoteAttachment, NoteVersion } from './types'

const NOTE_VERSIONS_FILE = '.no-tie-versions.json'

function safeFilePart(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'notatka'
}

function attachmentBytes(dataUrl: string): Uint8Array {
  const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  return `data:${mimeType};base64,${btoa(binary)}`
}

export function buildArchive(notes: Note[], assets: NoteAsset[], versions: NoteVersion[] = [], attachments: NoteAttachment[] = []): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  notes.forEach(note => {
    const folder = `notatki/${safeFilePart(note.title)}-${note.id}`
    files[`${folder}/notatka.md`] = strToU8(noteToMarkdown(note))
    const noteVersions = versions.filter(version => version.noteId === note.id)
    if (noteVersions.length) files[`${folder}/${NOTE_VERSIONS_FILE}`] = strToU8(JSON.stringify(noteVersions, null, 2))
    assets.filter(asset => asset.noteId === note.id).forEach(asset => {
      files[`${folder}/assets/${asset.fileName}`] = strToU8(sanitizeSvg(asset.svg))
    })
    attachments.filter(attachment => attachment.noteId === note.id).forEach(attachment => {
      files[`${folder}/assets/${attachment.fileName}`] = attachmentBytes(attachment.dataUrl)
    })
  })
  return zipSync(files, { level: 6 })
}

function archivedNoteVersions(value: unknown, noteId: string): NoteVersion[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): NoteVersion[] => {
    if (!item || typeof item !== 'object') return []
    const version = item as Partial<NoteVersion>
    const snapshot = version.note
    if (version.noteId !== noteId || typeof version.id !== 'string' || typeof version.createdAt !== 'number' || !snapshot || snapshot.id !== noteId) return []
    if (typeof snapshot.title !== 'string' || typeof snapshot.content !== 'string' || typeof snapshot.folder !== 'string') return []
    return [{
      id: version.id,
      noteId,
      createdAt: version.createdAt,
      note: {
        id: noteId,
        title: snapshot.title,
        content: snapshot.content,
        folder: snapshot.folder,
        color: typeof snapshot.color === 'string' && /^#[\da-f]{6}$/i.test(snapshot.color) ? snapshot.color : undefined,
        tags: Array.isArray(snapshot.tags) ? snapshot.tags.filter((tag): tag is string => typeof tag === 'string') : [],
        favorite: snapshot.favorite === true,
        createdAt: typeof snapshot.createdAt === 'number' ? snapshot.createdAt : version.createdAt,
        updatedAt: typeof snapshot.updatedAt === 'number' ? snapshot.updatedAt : version.createdAt,
        dailyDate: typeof snapshot.dailyDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.dailyDate) ? snapshot.dailyDate : undefined,
      },
    }]
  }).sort((a, b) => b.createdAt - a.createdAt)
}

export function parseArchive(bytes: Uint8Array): { notes: Note[]; assets: NoteAsset[]; versions: NoteVersion[]; attachments: NoteAttachment[] } {
  const files = unzipSync(bytes)
  const notes: Note[] = []
  const assets: NoteAsset[] = []
  const versions: NoteVersion[] = []
  const attachments: NoteAttachment[] = []
  const markdownPaths = Object.keys(files).filter(path => path.toLowerCase().endsWith('.md'))

  for (const path of markdownPaths) {
    const markdown = strFromU8(files[path])
    const idFromPath = path.split('/').at(-2) ?? crypto.randomUUID()
    const note = markdownToNote(markdown, idFromPath)
    notes.push(note)
    const baseDirectory = path.slice(0, path.lastIndexOf('/'))
    const versionsFile = files[`${baseDirectory}/${NOTE_VERSIONS_FILE}`]
    if (versionsFile) {
      try { versions.push(...archivedNoteVersions(JSON.parse(strFromU8(versionsFile)), note.id)) } catch { /* Ignore an invalid optional history sidecar. */ }
    }
    for (const assetPath of Object.keys(files)) {
      const prefix = `${baseDirectory}/assets/`
      if (!assetPath.startsWith(prefix)) continue
      const fileName = assetPath.slice(prefix.length).split('/').at(-1)
      if (!fileName) continue
      if (fileName.toLowerCase().endsWith('.svg')) {
        assets.push({ id: `${note.id}:${fileName}`, noteId: note.id, fileName, svg: sanitizeSvg(strFromU8(files[assetPath])) })
      } else {
        const mimeType = fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf'
          : fileName.toLowerCase().endsWith('.png') ? 'image/png'
            : fileName.toLowerCase().endsWith('.jpg') || fileName.toLowerCase().endsWith('.jpeg') ? 'image/jpeg'
              : fileName.toLowerCase().endsWith('.gif') ? 'image/gif'
                : fileName.toLowerCase().endsWith('.webp') ? 'image/webp'
                  : fileName.toLowerCase().endsWith('.avif') ? 'image/avif' : ''
        if (mimeType) attachments.push({ id: `${note.id}:${fileName}`, noteId: note.id, fileName, mimeType, dataUrl: bytesToDataUrl(files[assetPath], mimeType), size: files[assetPath].byteLength })
      }
    }
  }
  if (!notes.length) throw new Error('W paczce nie znaleziono plików Markdown.')
  return { notes, assets, versions, attachments }
}

function archiveBlob(archive: Uint8Array): Blob {
  const buffer = new ArrayBuffer(archive.byteLength)
  new Uint8Array(buffer).set(archive)
  return new Blob([buffer], { type: 'application/zip' })
}

export function downloadArchive(notes: Note[], assets: NoteAsset[], versions: NoteVersion[] = [], attachments: NoteAttachment[] = []) {
  const archive = buildArchive(notes, assets, versions, attachments)
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

export async function exportArchiveToFolder(notes: Note[], assets: NoteAsset[], versions: NoteVersion[] = [], attachments: NoteAttachment[] = []): Promise<string | null> {
  const archive = buildArchive(notes, assets, versions, attachments)
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

  downloadArchive(notes, assets, versions, attachments)
  return fileName
}
