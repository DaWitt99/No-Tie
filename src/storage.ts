import type { Note, NoteAsset } from './types'

const DATABASE = 'no-tie-notes'
const DATABASE_VERSION = 1

let databasePromise: Promise<IDBDatabase> | undefined

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
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  return databasePromise
}

async function withStore<T>(
  storeName: 'notes' | 'assets',
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

export const getNotes = () => withStore<Note[]>('notes', 'readonly', store => store.getAll())
export const saveNote = (note: Note) => withStore<IDBValidKey>('notes', 'readwrite', store => store.put(note))
export const removeNote = (id: string) => withStore<undefined>('notes', 'readwrite', store => store.delete(id))
export const getAssets = () => withStore<NoteAsset[]>('assets', 'readonly', store => store.getAll())
export const getAssetsForNote = async (noteId: string) => {
  const database = await openDatabase()
  return new Promise<NoteAsset[]>((resolve, reject) => {
    const request = database.transaction('assets', 'readonly').objectStore('assets').index('noteId').getAll(noteId)
    request.onsuccess = () => resolve(request.result as NoteAsset[])
    request.onerror = () => reject(request.error)
  })
}
export const saveAsset = (asset: NoteAsset) => withStore<IDBValidKey>('assets', 'readwrite', store => store.put(asset))
export const removeAssetsForNote = async (noteId: string) => {
  const database = await openDatabase()
  return new Promise<void>((resolve, reject) => {
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
