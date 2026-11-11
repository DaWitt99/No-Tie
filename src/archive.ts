import { invoke, isTauri } from '@tauri-apps/api/core'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { markdownToNote, noteToMarkdown, sanitizeSvg } from './content'
import { fileFingerprint } from './fileFingerprint'
import type { Note, NoteAsset, NoteAttachment, NoteAttachmentHistory, NoteAttachmentReference, NoteTemplate, NoteVersion, ReviewSession, SavedSearch, WorkspaceBackup } from './types'

const NOTE_VERSIONS_FILE = '.no-tie-versions.json'
const WORKSPACE_BACKUP_FILE = '.no-tie-workspace.json'
const ATTACHMENT_HISTORY_FILE = '.no-tie-attachment-history.json'

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

export function buildArchive(notes: Note[], assets: NoteAsset[], versions: NoteVersion[] = [], attachments: NoteAttachment[] = [], workspace?: WorkspaceBackup, attachmentHistory: NoteAttachmentHistory[] = []): Uint8Array {
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
  if (workspace) files[WORKSPACE_BACKUP_FILE] = strToU8(JSON.stringify(workspace, null, 2))
  if (attachmentHistory.length) files[ATTACHMENT_HISTORY_FILE] = strToU8(JSON.stringify(attachmentHistory, null, 2))
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
    const attachments = Array.isArray(version.attachments) ? version.attachments.flatMap((item): NoteAttachmentReference[] => {
      if (!item || typeof item !== 'object') return []
      const reference = item as Partial<NoteAttachmentReference>
      if (typeof reference.fileName !== 'string' || typeof reference.mimeType !== 'string' || typeof reference.size !== 'number') return []
      return [{ fileName: reference.fileName, mimeType: reference.mimeType, size: reference.size, contentHash: typeof reference.contentHash === 'string' ? reference.contentHash : undefined }]
    }) : undefined
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
      attachments,
    }]
  }).sort((a, b) => b.createdAt - a.createdAt)
}

function parseWorkspaceBackup(bytes: Uint8Array): WorkspaceBackup {
  const source = JSON.parse(strFromU8(bytes)) as Partial<WorkspaceBackup>
  const reviewSessions: ReviewSession[] = Array.isArray(source.reviewSessions) ? source.reviewSessions.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const session = item as Partial<ReviewSession>
    if (typeof session.id !== 'string' || typeof session.title !== 'string' || !Array.isArray(session.noteIds)) return []
    const noteIds = [...new Set(session.noteIds.filter((id): id is string => typeof id === 'string'))]
    const noteTimesMs = session.noteTimesMs && typeof session.noteTimesMs === 'object' ? Object.fromEntries(Object.entries(session.noteTimesMs).filter(([id, time]) => noteIds.includes(id) && typeof time === 'number' && Number.isFinite(time) && time >= 0)) : {}
    const status = ['ready', 'running', 'paused', 'completed'].includes(session.status ?? '') ? session.status as ReviewSession['status'] : 'ready'
    return [{
      id: session.id,
      title: session.title,
      noteIds,
      createdAt: typeof session.createdAt === 'number' ? session.createdAt : Date.now(),
      updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : Date.now(),
      totalTimeMs: typeof session.totalTimeMs === 'number' && Number.isFinite(session.totalTimeMs) ? Math.max(0, session.totalTimeMs) : 0,
      noteTimesMs: noteTimesMs as Record<string, number>,
      activeNoteId: typeof session.activeNoteId === 'string' && noteIds.includes(session.activeNoteId) ? session.activeNoteId : noteIds[0] ?? null,
      status: status === 'running' ? 'paused' : status,
    }]
  }) : []
  const savedSearches: SavedSearch[] = Array.isArray(source.savedSearches) ? source.savedSearches.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const search = item as Partial<SavedSearch>
    if (typeof search.id !== 'string' || typeof search.name !== 'string') return []
    return [{ id: search.id, name: search.name, query: typeof search.query === 'string' ? search.query : '', tag: typeof search.tag === 'string' ? search.tag : '', folder: typeof search.folder === 'string' ? search.folder : '' }]
  }) : []
  const noteTemplates: NoteTemplate[] = Array.isArray(source.noteTemplates) ? source.noteTemplates.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const template = item as Partial<NoteTemplate>
    if (typeof template.id !== 'string' || typeof template.title !== 'string' || typeof template.content !== 'string') return []
    return [{ id: template.id, title: template.title, content: template.content, tags: Array.isArray(template.tags) ? template.tags.filter((tag): tag is string => typeof tag === 'string') : [] }]
  }) : []
  const folderColors = source.folderColors && typeof source.folderColors === 'object' && !Array.isArray(source.folderColors)
    ? Object.fromEntries(Object.entries(source.folderColors).filter(([path, color]) => path.trim() && typeof color === 'string' && /^#[\da-f]{6}$/i.test(color))) as Record<string, string>
    : {}
  return { reviewSessions, savedSearches, noteTemplates, folderColors }
}

function parseAttachmentHistory(bytes: Uint8Array): NoteAttachmentHistory[] {
  const value: unknown = JSON.parse(strFromU8(bytes))
  if (!Array.isArray(value)) return []
  return value.flatMap((item): NoteAttachmentHistory[] => {
    if (!item || typeof item !== 'object') return []
    const attachment = item as Partial<NoteAttachmentHistory>
    if (typeof attachment.id !== 'string' || typeof attachment.noteId !== 'string' || typeof attachment.fileName !== 'string' || typeof attachment.mimeType !== 'string' || typeof attachment.dataUrl !== 'string' || typeof attachment.size !== 'number' || typeof attachment.deletedAt !== 'number') return []
    return [{ ...attachment, contentHash: typeof attachment.contentHash === 'string' ? attachment.contentHash : undefined } as NoteAttachmentHistory]
  })
}

export function parseArchive(bytes: Uint8Array): { notes: Note[]; assets: NoteAsset[]; versions: NoteVersion[]; attachments: NoteAttachment[]; attachmentHistory: NoteAttachmentHistory[]; workspace?: WorkspaceBackup } {
  const files = unzipSync(bytes)
  const notes: Note[] = []
  const assets: NoteAsset[] = []
  const versions: NoteVersion[] = []
  const attachments: NoteAttachment[] = []
  let attachmentHistory: NoteAttachmentHistory[] = []
  let workspace: WorkspaceBackup | undefined
  if (files[ATTACHMENT_HISTORY_FILE]) {
    try { attachmentHistory = parseAttachmentHistory(files[ATTACHMENT_HISTORY_FILE]) } catch { /* Ignore an invalid optional history file. */ }
  }
  if (files[WORKSPACE_BACKUP_FILE]) {
    try { workspace = parseWorkspaceBackup(files[WORKSPACE_BACKUP_FILE]) } catch { /* Ignore an invalid optional workspace file. */ }
  }
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
        if (mimeType) attachments.push({ id: `${note.id}:${fileName}`, noteId: note.id, fileName, mimeType, dataUrl: bytesToDataUrl(files[assetPath], mimeType), size: files[assetPath].byteLength, contentHash: fileFingerprint(files[assetPath]) })
      }
    }
  }
  if (!notes.length) throw new Error('W paczce nie znaleziono plików Markdown.')
  return { notes, assets, versions, attachments, attachmentHistory, workspace }
}

function archiveBlob(archive: Uint8Array): Blob {
  const buffer = new ArrayBuffer(archive.byteLength)
  new Uint8Array(buffer).set(archive)
  return new Blob([buffer], { type: 'application/zip' })
}

export function downloadArchive(notes: Note[], assets: NoteAsset[], versions: NoteVersion[] = [], attachments: NoteAttachment[] = [], workspace?: WorkspaceBackup, attachmentHistory: NoteAttachmentHistory[] = []) {
  const archive = buildArchive(notes, assets, versions, attachments, workspace, attachmentHistory)
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

export async function exportArchiveToFolder(notes: Note[], assets: NoteAsset[], versions: NoteVersion[] = [], attachments: NoteAttachment[] = [], workspace?: WorkspaceBackup, attachmentHistory: NoteAttachmentHistory[] = []): Promise<string | null> {
  const archive = buildArchive(notes, assets, versions, attachments, workspace, attachmentHistory)
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

  downloadArchive(notes, assets, versions, attachments, workspace, attachmentHistory)
  return fileName
}
