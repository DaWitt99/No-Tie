import { isTauri } from '@tauri-apps/api/core'
import { documentDir, join } from '@tauri-apps/api/path'
import { exists, mkdir, readDir, readFile, readTextFile, remove, rename, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { markdownToNote, noteToMarkdown, sanitizeSvg } from './content'
import type { Note, NoteAsset, NoteAttachment, NoteTemplate, NoteVersion, ReviewSession, ReviewSessionStatus, SavedSearch } from './types'

const DATABASE = 'no-tie-notes'
const DATABASE_VERSION = 4
const NATIVE_NOTES_FOLDER = 'Notatki'
const FOLDER_COLORS_FILE = '.no-tie-folder-colors.json'
const REVIEW_SESSIONS_FILE = '.no-tie-review-sessions.json'
const NOTE_VERSIONS_FILE = '.no-tie-versions.json'
const SAVED_SEARCHES_FILE = '.no-tie-saved-searches.json'
const NOTE_TEMPLATES_FILE = '.no-tie-templates.json'
const MAX_NOTE_VERSIONS = 80

let databasePromise: Promise<IDBDatabase> | undefined
let nativeNotesRoot: Promise<string> | undefined
const nativeNoteDirectories = new Map<string, string>()
const noteVersionQueues = new Map<string, Promise<void>>()

export const usesNativeFiles = isTauri()
export const storageLocationLabel = usesNativeFiles ? 'Dokumenty/No-Tie' : 'Ta przeglądarka'

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('notes')) {
        database.createObjectStore('notes', { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains('assets')) {
        const assets = database.createObjectStore('assets', { keyPath: 'id' })
        assets.createIndex('noteId', 'noteId', { unique: false })
      }
      if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings')
      if (!database.objectStoreNames.contains('attachments')) {
        const attachments = database.createObjectStore('attachments', { keyPath: 'id' })
        attachments.createIndex('noteId', 'noteId', { unique: false })
      }
      if (!database.objectStoreNames.contains('noteVersions')) {
        const versions = database.createObjectStore('noteVersions', { keyPath: 'id' })
        versions.createIndex('noteId', 'noteId', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  return databasePromise
}

async function withStore<T>(
  storeName: 'notes' | 'assets' | 'settings' | 'noteVersions' | 'attachments',
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    const request = action(transaction.objectStore(storeName))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

function safeFilePart(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'notatka'
}

function safeAssetFileName(value: string): string {
  const base = value.split(/[\\/]/).at(-1)?.trim() ?? ''
  const safe = Array.from(base, character => {
    const code = character.charCodeAt(0)
    return /[<>:"|?*]/.test(character) || code < 32 ? '-' : character
  }).join('').replace(/^\.+/, '').replace(/[. ]+$/g, '')
  if (!safe) return 'schemat.svg'
  return safe.toLowerCase().endsWith('.svg') ? safe : `${safe}.svg`
}

function safeAttachmentFileName(value: string): string {
  const base = value.split(/[\\/]/).at(-1)?.trim() ?? ''
  const safe = Array.from(base, character => {
    const code = character.charCodeAt(0)
    return /[<>:"|?*]/.test(character) || code < 32 ? '-' : character
  }).join('').replace(/^\.+/, '').replace(/[. ]+$/g, '')
  return safe || 'zalacznik.bin'
}

async function getNativeNotesRoot(): Promise<string> {
  if (!nativeNotesRoot) {
    nativeNotesRoot = (async () => {
      const root = await join(await documentDir(), 'No-Tie', NATIVE_NOTES_FOLDER)
      await mkdir(root, { recursive: true })
      return root
    })()
  }
  return nativeNotesRoot
}

async function folderDirectory(folder: string): Promise<string> {
  const segments = folder.split('/').map(part => part.trim()).filter(Boolean).map(safeFilePart)
  return join(await getNativeNotesRoot(), ...segments)
}

async function noteDirectory(note: Note): Promise<string> {
  return join(await folderDirectory(note.folder), `${safeFilePart(note.title)}-${safeFilePart(note.id)}`)
}

async function removeEmptyParents(directory: string): Promise<void> {
  const root = await getNativeNotesRoot()
  const separator = Math.max(directory.lastIndexOf('/'), directory.lastIndexOf('\\'))
  let current = separator > 0 ? directory.slice(0, separator) : ''
  while (current && current !== root && current.startsWith(root)) {
    if (!await exists(current) || (await readDir(current)).length) break
    await remove(current)
    const parentSeparator = Math.max(current.lastIndexOf('/'), current.lastIndexOf('\\'))
    current = parentSeparator > 0 ? current.slice(0, parentSeparator) : ''
  }
}

const FOLDER_MARKER = '.no-tie-folder'

async function collectFolderMarkers(directory: string): Promise<string[]> {
  const folders: string[] = []
  for (const entry of await readDir(directory)) {
    if (!entry.isDirectory) continue
    const path = await join(directory, entry.name)
    const marker = await join(path, FOLDER_MARKER)
    if (await exists(marker)) {
      try { folders.push((await readTextFile(marker)).trim()) } catch { /* ignore malformed folder marker */ }
    }
    folders.push(...await collectFolderMarkers(path))
  }
  return folders.filter(Boolean)
}

export async function getFolders(): Promise<string[]> {
  if (!usesNativeFiles) return (await withStore<string[] | undefined>('settings', 'readonly', store => store.get('folders'))) ?? []
  return collectFolderMarkers(await getNativeNotesRoot())
}

export async function saveFolders(folders: string[]): Promise<void> {
  const normalized = [...new Set(folders.map(folder => folder.trim().replace(/^\/+|\/+$/g, '')).filter(Boolean))]
  if (!usesNativeFiles) {
    await withStore<IDBValidKey>('settings', 'readwrite', store => store.put(normalized, 'folders'))
    return
  }
  const root = await getNativeNotesRoot()
  const current = await collectFolderMarkers(root)
  for (const folder of current) {
    if (!normalized.includes(folder)) {
      const marker = await join(await folderDirectory(folder), FOLDER_MARKER)
      if (await exists(marker)) await remove(marker)
    }
  }
  for (const folder of normalized) {
    const directory = await folderDirectory(folder)
    await mkdir(directory, { recursive: true })
    await writeTextFile(await join(directory, FOLDER_MARKER), folder)
  }
}

function normalizeFolderColors(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([folder, color]) => {
    const path = folder.trim().replace(/^\/+|\/+$/g, '')
    return path && typeof color === 'string' && /^#[\da-f]{6}$/i.test(color) ? [[path, color]] : []
  }))
}

export async function getFolderColors(): Promise<Record<string, string>> {
  if (!usesNativeFiles) {
    const stored = await withStore<unknown>('settings', 'readonly', store => store.get('folderColors'))
    return normalizeFolderColors(stored)
  }
  const path = await join(await getNativeNotesRoot(), FOLDER_COLORS_FILE)
  if (!await exists(path)) return {}
  try {
    return normalizeFolderColors(JSON.parse(await readTextFile(path)))
  } catch {
    return {}
  }
}

export async function saveFolderColors(colors: Record<string, string>): Promise<void> {
  const normalized = normalizeFolderColors(colors)
  if (!usesNativeFiles) {
    await withStore<IDBValidKey>('settings', 'readwrite', store => store.put(normalized, 'folderColors'))
    return
  }
  const root = await getNativeNotesRoot()
  await writeTextFile(await join(root, FOLDER_COLORS_FILE), JSON.stringify(normalized, null, 2))
}

function normalizeReviewSessions(value: unknown): ReviewSession[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): ReviewSession[] => {
    if (!entry || typeof entry !== 'object') return []
    const session = entry as Partial<ReviewSession>
    if (typeof session.id !== 'string' || !Array.isArray(session.noteIds)) return []
    const noteIds = [...new Set(session.noteIds.filter((id): id is string => typeof id === 'string'))]
    const noteTimes = session.noteTimesMs && typeof session.noteTimesMs === 'object' && !Array.isArray(session.noteTimesMs)
      ? Object.fromEntries(Object.entries(session.noteTimesMs as Record<string, unknown>)
        .filter(([id, milliseconds]) => noteIds.includes(id) && typeof milliseconds === 'number' && Number.isFinite(milliseconds) && milliseconds >= 0))
      : {}
    const status: ReviewSessionStatus = ['ready', 'running', 'paused', 'completed'].includes(session.status ?? '')
      ? session.status as ReviewSessionStatus
      : 'ready'
    return [{
      id: session.id,
      title: typeof session.title === 'string' ? session.title : 'Powtórka',
      noteIds,
      createdAt: typeof session.createdAt === 'number' ? session.createdAt : Date.now(),
      updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : Date.now(),
      totalTimeMs: typeof session.totalTimeMs === 'number' && Number.isFinite(session.totalTimeMs) ? Math.max(0, session.totalTimeMs) : 0,
      noteTimesMs: noteTimes as Record<string, number>,
      activeNoteId: typeof session.activeNoteId === 'string' && noteIds.includes(session.activeNoteId) ? session.activeNoteId : noteIds[0] ?? null,
      status: status === 'running' ? 'paused' : status,
    }]
  })
}

export async function getReviewSessions(): Promise<ReviewSession[]> {
  if (!usesNativeFiles) {
    const stored = await withStore<unknown>('settings', 'readonly', store => store.get('reviewSessions'))
    return normalizeReviewSessions(stored)
  }
  const path = await join(await getNativeNotesRoot(), REVIEW_SESSIONS_FILE)
  if (!await exists(path)) return []
  try {
    return normalizeReviewSessions(JSON.parse(await readTextFile(path)))
  } catch {
    return []
  }
}

export async function saveReviewSessions(sessions: ReviewSession[]): Promise<void> {
  const saved = sessions.map(session => ({
    ...session,
    status: session.status === 'running' ? 'paused' as const : session.status,
    runningSince: undefined,
  }))
  if (!usesNativeFiles) {
    await withStore<IDBValidKey>('settings', 'readwrite', store => store.put(saved, 'reviewSessions'))
    return
  }
  const root = await getNativeNotesRoot()
  await writeTextFile(await join(root, REVIEW_SESSIONS_FILE), JSON.stringify(saved, null, 2))
}

function normalizeSavedSearches(value: unknown): SavedSearch[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): SavedSearch[] => {
    if (!item || typeof item !== 'object') return []
    const entry = item as Partial<SavedSearch>
    if (typeof entry.id !== 'string' || typeof entry.name !== 'string') return []
    return [{ id: entry.id, name: entry.name, query: typeof entry.query === 'string' ? entry.query : '', tag: typeof entry.tag === 'string' ? entry.tag : '', folder: typeof entry.folder === 'string' ? entry.folder : '' }]
  })
}

export async function getSavedSearches(): Promise<SavedSearch[]> {
  if (!usesNativeFiles) return normalizeSavedSearches(await withStore<unknown>('settings', 'readonly', store => store.get('savedSearches')))
  const path = await join(await getNativeNotesRoot(), SAVED_SEARCHES_FILE)
  if (!await exists(path)) return []
  try { return normalizeSavedSearches(JSON.parse(await readTextFile(path))) } catch { return [] }
}

export async function saveSavedSearches(searches: SavedSearch[]): Promise<void> {
  const normalized = normalizeSavedSearches(searches)
  if (!usesNativeFiles) return withStore<IDBValidKey>('settings', 'readwrite', store => store.put(normalized, 'savedSearches')).then(() => {})
  await writeTextFile(await join(await getNativeNotesRoot(), SAVED_SEARCHES_FILE), JSON.stringify(normalized, null, 2))
}

function normalizeNoteTemplates(value: unknown): NoteTemplate[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): NoteTemplate[] => {
    if (!item || typeof item !== 'object') return []
    const entry = item as Partial<NoteTemplate>
    if (typeof entry.id !== 'string' || typeof entry.title !== 'string' || typeof entry.content !== 'string') return []
    return [{ id: entry.id, title: entry.title, content: entry.content, tags: Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === 'string') : [] }]
  })
}

export async function getNoteTemplates(): Promise<NoteTemplate[]> {
  if (!usesNativeFiles) return normalizeNoteTemplates(await withStore<unknown>('settings', 'readonly', store => store.get('noteTemplates')))
  const path = await join(await getNativeNotesRoot(), NOTE_TEMPLATES_FILE)
  if (!await exists(path)) return []
  try { return normalizeNoteTemplates(JSON.parse(await readTextFile(path))) } catch { return [] }
}

export async function saveNoteTemplates(templates: NoteTemplate[]): Promise<void> {
  const normalized = normalizeNoteTemplates(templates)
  if (!usesNativeFiles) return withStore<IDBValidKey>('settings', 'readwrite', store => store.put(normalized, 'noteTemplates')).then(() => {})
  await writeTextFile(await join(await getNativeNotesRoot(), NOTE_TEMPLATES_FILE), JSON.stringify(normalized, null, 2))
}

export async function removeFolderFromDisk(folder: string): Promise<void> {
  if (!usesNativeFiles || !folder.trim()) return
  const directory = await folderDirectory(folder)
  if (await exists(directory)) await remove(directory, { recursive: true })
}

async function collectMarkdownFiles(directory: string): Promise<string[]> {
  const paths: string[] = []
  for (const entry of await readDir(directory)) {
    const path = await join(directory, entry.name)
    if (entry.isDirectory) paths.push(...await collectMarkdownFiles(path))
    else if (entry.isFile && entry.name.toLowerCase().endsWith('.md')) paths.push(path)
  }
  return paths
}

async function getNativeNotes(): Promise<Note[]> {
  nativeNoteDirectories.clear()
  const root = await getNativeNotesRoot()
  const files = await collectMarkdownFiles(root)
  const notes: Note[] = []
  for (const path of files) {
    try {
      const markdown = await readTextFile(path)
      const parentDirectory = path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')))
      const fallbackId = parentDirectory.split(/[\\/]/).at(-1) ?? crypto.randomUUID()
      const note = markdownToNote(markdown, fallbackId)
      if (nativeNoteDirectories.has(note.id)) continue
      nativeNoteDirectories.set(note.id, parentDirectory)
      notes.push(note)
    } catch {
      // Keep malformed files on disk; valid notes should still open normally.
    }
  }
  return notes
}

async function readNativeAssets(noteId: string, directory: string): Promise<NoteAsset[]> {
  const assetsDirectory = await join(directory, 'assets')
  if (!await exists(assetsDirectory)) return []
  const assets: NoteAsset[] = []
  for (const entry of await readDir(assetsDirectory)) {
    if (!entry.isFile || !entry.name.toLowerCase().endsWith('.svg')) continue
    try {
      assets.push({
        id: `${noteId}:${entry.name}`,
        noteId,
        fileName: entry.name,
        svg: sanitizeSvg(await readTextFile(await join(assetsDirectory, entry.name))),
      })
    } catch {
      // An invalid SVG remains available as a file but is omitted from the editor.
    }
  }
  return assets
}

export async function getNotes(): Promise<Note[]> {
  return usesNativeFiles ? getNativeNotes() : withStore<Note[]>('notes', 'readonly', store => store.getAll())
}

export async function hasInitialized(): Promise<boolean> {
  if (usesNativeFiles) return exists(await join(await getNativeNotesRoot(), '.initialized'))
  return withStore<boolean | undefined>('settings', 'readonly', store => store.get('initialized')).then(value => value === true)
}

export async function markInitialized(): Promise<void> {
  if (usesNativeFiles) return writeTextFile(await join(await getNativeNotesRoot(), '.initialized'), '1')
  await withStore<IDBValidKey>('settings', 'readwrite', store => store.put(true, 'initialized'))
}

export async function saveNote(note: Note): Promise<IDBValidKey | void> {
  if (!usesNativeFiles) return withStore<IDBValidKey>('notes', 'readwrite', store => store.put(note))

  const newDirectory = await noteDirectory(note)
  const oldDirectory = nativeNoteDirectories.get(note.id)
  await mkdir(newDirectory.slice(0, Math.max(newDirectory.lastIndexOf('/'), newDirectory.lastIndexOf('\\'))), { recursive: true })
  if (oldDirectory && oldDirectory !== newDirectory && await exists(oldDirectory)) {
    if (await exists(newDirectory)) throw new Error(`Katalog notatki „${note.title}” już istnieje.`)
    await rename(oldDirectory, newDirectory)
    await removeEmptyParents(oldDirectory)
  } else {
    await mkdir(newDirectory, { recursive: true })
  }
  await writeTextFile(await join(newDirectory, 'notatka.md'), noteToMarkdown(note))
  nativeNoteDirectories.set(note.id, newDirectory)
}

function normalizeNoteVersions(value: unknown, noteId: string): NoteVersion[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): NoteVersion[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Partial<NoteVersion>
    const snapshot = record.note
    if (typeof record.id !== 'string' || record.noteId !== noteId || typeof record.createdAt !== 'number' || !snapshot || snapshot.id !== noteId) return []
    if (typeof snapshot.title !== 'string' || typeof snapshot.content !== 'string' || typeof snapshot.folder !== 'string') return []
    return [{
      id: record.id,
      noteId,
      createdAt: record.createdAt,
      note: {
        id: noteId,
        title: snapshot.title,
        content: snapshot.content,
        folder: snapshot.folder,
        color: typeof snapshot.color === 'string' && /^#[\da-f]{6}$/i.test(snapshot.color) ? snapshot.color : undefined,
        tags: Array.isArray(snapshot.tags) ? snapshot.tags.filter((tag): tag is string => typeof tag === 'string') : [],
        favorite: snapshot.favorite === true,
        createdAt: typeof snapshot.createdAt === 'number' ? snapshot.createdAt : record.createdAt,
        updatedAt: typeof snapshot.updatedAt === 'number' ? snapshot.updatedAt : record.createdAt,
        dailyDate: typeof snapshot.dailyDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.dailyDate) ? snapshot.dailyDate : undefined,
      },
    }]
  }).sort((a, b) => b.createdAt - a.createdAt)
}

async function readNoteVersions(noteId: string): Promise<NoteVersion[]> {
  if (usesNativeFiles) {
    const directory = nativeNoteDirectories.get(noteId)
    if (!directory) return []
    const path = await join(directory, NOTE_VERSIONS_FILE)
    if (!await exists(path)) return []
    try { return normalizeNoteVersions(JSON.parse(await readTextFile(path)), noteId) } catch { return [] }
  }
  return withStore<NoteVersion[]>('noteVersions', 'readonly', store => store.index('noteId').getAll(noteId))
    .then(versions => normalizeNoteVersions(versions, noteId))
}

export async function getNoteVersions(noteId: string): Promise<NoteVersion[]> {
  return readNoteVersions(noteId)
}

function sameVersionSnapshot(left: Note, right: Note) {
  return left.title === right.title && left.content === right.content && left.folder === right.folder && left.color === right.color
    && left.favorite === right.favorite && JSON.stringify(left.tags) === JSON.stringify(right.tags)
}

export async function saveNoteVersion(note: Note): Promise<void> {
  const previousQueue = noteVersionQueues.get(note.id) ?? Promise.resolve()
  const queue = previousQueue.catch(() => {}).then(async () => {
    const versions = await readNoteVersions(note.id)
    if (versions[0] && sameVersionSnapshot(versions[0].note, note)) return
    const version: NoteVersion = {
      id: crypto.randomUUID(),
      noteId: note.id,
      createdAt: Date.now(),
      note: { ...note, tags: [...note.tags] },
    }
    const next = [version, ...versions].slice(0, MAX_NOTE_VERSIONS)
    if (usesNativeFiles) {
      const directory = nativeNoteDirectories.get(note.id)
      if (!directory) return
      await writeTextFile(await join(directory, NOTE_VERSIONS_FILE), JSON.stringify(next, null, 2))
      return
    }
    const database = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('noteVersions', 'readwrite')
      const store = transaction.objectStore('noteVersions')
      const retained = new Set(next.map(item => item.id))
      store.put(version)
      versions.forEach(item => { if (!retained.has(item.id)) store.delete(item.id) })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  })
  noteVersionQueues.set(note.id, queue)
  try { await queue } finally {
    if (noteVersionQueues.get(note.id) === queue) noteVersionQueues.delete(note.id)
  }
}

export async function saveNoteVersions(noteId: string, importedVersions: NoteVersion[]): Promise<void> {
  const versions = normalizeNoteVersions(importedVersions, noteId).slice(0, MAX_NOTE_VERSIONS)
  const previousQueue = noteVersionQueues.get(noteId) ?? Promise.resolve()
  const queue = previousQueue.catch(() => {}).then(async () => {
    if (usesNativeFiles) {
      const directory = nativeNoteDirectories.get(noteId)
      if (!directory) return
      await writeTextFile(await join(directory, NOTE_VERSIONS_FILE), JSON.stringify(versions, null, 2))
      return
    }
    const database = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('noteVersions', 'readwrite')
      const store = transaction.objectStore('noteVersions')
      const request = store.index('noteId').getAll(noteId)
      request.onsuccess = () => {
        ;(request.result as NoteVersion[]).forEach(version => store.delete(version.id))
        versions.forEach(version => store.put(version))
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
      request.onerror = () => reject(request.error)
    })
  })
  noteVersionQueues.set(noteId, queue)
  try { await queue } finally {
    if (noteVersionQueues.get(noteId) === queue) noteVersionQueues.delete(noteId)
  }
}

export async function removeNote(id: string): Promise<void> {
  if (!usesNativeFiles) {
    await withStore<undefined>('notes', 'readwrite', store => store.delete(id))
    const versions = await readNoteVersions(id)
    if (!versions.length) return
    const database = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('noteVersions', 'readwrite')
      const store = transaction.objectStore('noteVersions')
      versions.forEach(version => store.delete(version.id))
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    return
  }
  const directory = nativeNoteDirectories.get(id)
  if (directory && await exists(directory)) await remove(directory, { recursive: true })
  nativeNoteDirectories.delete(id)
}

export async function getAssets(): Promise<NoteAsset[]> {
  if (!usesNativeFiles) return withStore<NoteAsset[]>('assets', 'readonly', store => store.getAll())
  const assets = await Promise.all([...nativeNoteDirectories.entries()].map(([noteId, directory]) => readNativeAssets(noteId, directory)))
  return assets.flat()
}

export async function getAssetsForNote(noteId: string): Promise<NoteAsset[]> {
  if (!usesNativeFiles) {
    const database = await openDatabase()
    return new Promise((resolve, reject) => {
      const request = database.transaction('assets', 'readonly').objectStore('assets').index('noteId').getAll(noteId)
      request.onsuccess = () => resolve(request.result as NoteAsset[])
      request.onerror = () => reject(request.error)
    })
  }
  const directory = nativeNoteDirectories.get(noteId)
  return directory ? readNativeAssets(noteId, directory) : []
}

const attachmentTypes: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  pdf: 'application/pdf',
}

function attachmentMimeType(fileName: string) {
  return attachmentTypes[fileName.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'application/octet-stream'
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  return btoa(binary)
}

function dataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function readNativeAttachments(noteId: string, directory: string): Promise<NoteAttachment[]> {
  const assetsDirectory = await join(directory, 'assets')
  if (!await exists(assetsDirectory)) return []
  const attachments: NoteAttachment[] = []
  for (const entry of await readDir(assetsDirectory)) {
    if (!entry.isFile || entry.name.toLowerCase().endsWith('.svg') || !attachmentMimeType(entry.name).startsWith('image/') && attachmentMimeType(entry.name) !== 'application/pdf') continue
    try {
      const bytes = await readFile(await join(assetsDirectory, entry.name))
      const mimeType = attachmentMimeType(entry.name)
      attachments.push({ id: `${noteId}:${entry.name}`, noteId, fileName: entry.name, mimeType, dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}`, size: bytes.byteLength })
    } catch { /* Skip unreadable user attachments and keep the rest of the note library available. */ }
  }
  return attachments
}

export async function getAttachments(): Promise<NoteAttachment[]> {
  if (!usesNativeFiles) return withStore<NoteAttachment[]>('attachments', 'readonly', store => store.getAll())
  return (await Promise.all([...nativeNoteDirectories.entries()].map(([noteId, directory]) => readNativeAttachments(noteId, directory)))).flat()
}

export async function saveAttachment(attachment: NoteAttachment): Promise<IDBValidKey | void> {
  if (!usesNativeFiles) return withStore<IDBValidKey>('attachments', 'readwrite', store => store.put(attachment))
  const directory = nativeNoteDirectories.get(attachment.noteId)
  if (!directory) throw new Error('Najpierw zapisz notatkę, do której dodajesz plik.')
  const assetsDirectory = await join(directory, 'assets')
  await mkdir(assetsDirectory, { recursive: true })
  await writeFile(await join(assetsDirectory, safeAttachmentFileName(attachment.fileName)), dataUrlBytes(attachment.dataUrl))
}

export async function removeAttachment(attachment: NoteAttachment): Promise<void> {
  if (!usesNativeFiles) {
    await withStore<undefined>('attachments', 'readwrite', store => store.delete(attachment.id))
    return
  }
  const directory = nativeNoteDirectories.get(attachment.noteId)
  const path = directory ? await join(directory, 'assets', attachment.fileName) : ''
  if (path && await exists(path)) await remove(path)
}

export async function removeAttachmentsForNote(noteId: string): Promise<void> {
  if (!usesNativeFiles) {
    const attachments = await withStore<NoteAttachment[]>('attachments', 'readonly', store => store.index('noteId').getAll(noteId))
    const database = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('attachments', 'readwrite')
      attachments.forEach(attachment => transaction.objectStore('attachments').delete(attachment.id))
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    return
  }
  const directory = nativeNoteDirectories.get(noteId)
  const assetsDirectory = directory ? await join(directory, 'assets') : undefined
  if (!assetsDirectory || !await exists(assetsDirectory)) return
  for (const entry of await readDir(assetsDirectory)) {
    if (entry.isFile && !entry.name.toLowerCase().endsWith('.svg') && attachmentMimeType(entry.name) !== 'application/octet-stream') await remove(await join(assetsDirectory, entry.name))
  }
}

export async function saveAsset(asset: NoteAsset): Promise<IDBValidKey | void> {
  if (!usesNativeFiles) return withStore<IDBValidKey>('assets', 'readwrite', store => store.put(asset))
  const directory = nativeNoteDirectories.get(asset.noteId)
  if (!directory) throw new Error('Najpierw zapisz notatkę, do której należy schemat.')
  const assetsDirectory = await join(directory, 'assets')
  await mkdir(assetsDirectory, { recursive: true })
  const fileName = safeAssetFileName(asset.fileName)
  await writeTextFile(await join(assetsDirectory, fileName), sanitizeSvg(asset.svg))
}

export async function removeAssetsForNote(noteId: string): Promise<void> {
  if (!usesNativeFiles) {
    const database = await openDatabase()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('assets', 'readwrite')
      const store = transaction.objectStore('assets')
      const request = store.index('noteId').openCursor(noteId)
      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        }
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  }
  const directory = nativeNoteDirectories.get(noteId)
  const assetsDirectory = directory ? await join(directory, 'assets') : undefined
  if (assetsDirectory && await exists(assetsDirectory)) await remove(assetsDirectory, { recursive: true })
}
