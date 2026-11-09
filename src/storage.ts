import { isTauri } from '@tauri-apps/api/core'
import { documentDir, join } from '@tauri-apps/api/path'
import { exists, mkdir, readDir, readTextFile, remove, rename, writeTextFile } from '@tauri-apps/plugin-fs'
import { markdownToNote, noteToMarkdown, sanitizeSvg } from './content'
import type { Note, NoteAsset } from './types'

const DATABASE = 'no-tie-notes'
const DATABASE_VERSION = 2
const NATIVE_NOTES_FOLDER = 'Notatki'

let databasePromise: Promise<IDBDatabase> | undefined
let nativeNotesRoot: Promise<string> | undefined
const nativeNoteDirectories = new Map<string, string>()

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
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  return databasePromise
}

async function withStore<T>(
  storeName: 'notes' | 'assets' | 'settings',
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

async function noteDirectory(note: Note): Promise<string> {
  return join(await getNativeNotesRoot(), safeFilePart(note.folder), `${safeFilePart(note.title)}-${safeFilePart(note.id)}`)
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
  } else {
    await mkdir(newDirectory, { recursive: true })
  }
  await writeTextFile(await join(newDirectory, 'notatka.md'), noteToMarkdown(note))
  nativeNoteDirectories.set(note.id, newDirectory)
}

export async function removeNote(id: string): Promise<void> {
  if (!usesNativeFiles) return withStore<undefined>('notes', 'readwrite', store => store.delete(id))
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
