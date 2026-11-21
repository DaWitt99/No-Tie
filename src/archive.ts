import { invoke, isTauri } from '@tauri-apps/api/core'
import { AsyncUnzipInflate, AsyncZipDeflate, strFromU8, strToU8, Unzip, Zip, zipSync } from 'fflate'
import type { UnzipFile } from 'fflate'
import { stringify as stringifyYaml } from 'yaml'
import { markdownToNote, noteToMarkdown, sanitizeSvg } from './content'
import { markdownToWikiLinks } from './wikiLinks'
import { isFlashcardStudyMode, type Flashcard, type FlashcardTrashEntry, type Note, type NoteAsset, type NoteAttachment, type NoteAttachmentHistory, type NoteAttachmentReference, type NoteCollection, type NoteTemplate, type NoteVersion, type OrganizationSettings, type ReviewSession, type SavedSearch, type SavedWorkspaceLayout, type TrashEntry, type WorkspaceBackup } from './types'

const NOTE_VERSIONS_FILE = '.no-tie-versions.json'
const WORKSPACE_BACKUP_FILE = '.no-tie-workspace.json'
const ATTACHMENT_HISTORY_FILE = '.no-tie-attachment-history.json'
const ATTACHMENT_TRANSCRIPTS_FILE = '.no-tie-attachment-transcripts.json'
const ATTACHMENT_METADATA_FILE = '.no-tie-attachment-metadata.json'

export type ArchiveTransferProgress = { stage: 'unpack' | 'parse' | 'compress' | 'save'; completed: number; total: number; current: string; percent: number }
type ArchiveProgressHandler = (progress: ArchiveTransferProgress) => void

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

function groupByNoteId<T extends { noteId: string }>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  items.forEach(item => {
    const group = groups.get(item.noteId)
    if (group) group.push(item)
    else groups.set(item.noteId, [item])
  })
  return groups
}

async function bytesToDataUrlProgressively(bytes: Uint8Array, mimeType: string, onProgress?: (percent: number) => void): Promise<string> {
  const encoded: string[] = []
  const chunkSize = 1024 * 1024 - 1
  for (let start = 0; start < bytes.length; start += chunkSize) {
    const end = Math.min(bytes.length, start + chunkSize)
    let binary = ''
    for (let offset = start; offset < end; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(end, offset + 0x8000)))
    encoded.push(btoa(binary))
    onProgress?.(Math.round((end / Math.max(1, bytes.length)) * 100))
    if (end < bytes.length) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }
  return `data:${mimeType};base64,${encoded.join('')}`
}

async function fileFingerprintProgressively(bytes: Uint8Array, onProgress?: (percent: number) => void): Promise<string> {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  const chunkSize = 1024 * 1024
  for (let start = 0; start < bytes.length; start += chunkSize) {
    const end = Math.min(bytes.length, start + chunkSize)
    for (const byte of bytes.subarray(start, end)) {
      first = Math.imul(first ^ byte, 0x01000193)
      second = Math.imul(second ^ byte, 0x85ebca6b)
    }
    onProgress?.(Math.round((end / Math.max(1, bytes.length)) * 100))
    if (end < bytes.length) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }
  return `${bytes.byteLength}:${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`
}

function buildArchiveFiles(notes: Note[], assets: NoteAsset[], versions: NoteVersion[] = [], attachments: NoteAttachment[] = [], workspace?: WorkspaceBackup, attachmentHistory: NoteAttachmentHistory[] = []): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  const assetsByNote = groupByNoteId(assets)
  const attachmentsByNote = groupByNoteId(attachments)
  const versionsByNote = groupByNoteId(versions)
  notes.forEach(note => {
    const folder = `notatki/${safeFilePart(note.title)}-${note.id}`
    files[`${folder}/notatka.md`] = strToU8(noteToMarkdown(note))
    const noteVersions = versionsByNote.get(note.id) ?? []
    if (noteVersions.length) files[`${folder}/${NOTE_VERSIONS_FILE}`] = strToU8(JSON.stringify(noteVersions, null, 2))
    const noteAssets = assetsByNote.get(note.id) ?? []
    const noteAttachments = attachmentsByNote.get(note.id) ?? []
    noteAssets.forEach(asset => {
      files[`${folder}/assets/${asset.fileName}`] = strToU8(sanitizeSvg(asset.svg))
    })
    noteAttachments.forEach(attachment => {
      files[`${folder}/assets/${attachment.fileName}`] = attachmentBytes(attachment.dataUrl)
    })
    const transcripts = Object.fromEntries(noteAttachments.filter(attachment => attachment.transcript?.trim()).map(attachment => [attachment.fileName, attachment.transcript]))
    if (Object.keys(transcripts).length) files[`${folder}/${ATTACHMENT_TRANSCRIPTS_FILE}`] = strToU8(JSON.stringify(transcripts, null, 2))
    const attachmentMetadata = Object.fromEntries(noteAttachments.map(attachment => [attachment.fileName, { mimeType: attachment.mimeType, extractedText: attachment.extractedText, transcriptSegments: attachment.transcriptSegments, pdfAnnotations: attachment.pdfAnnotations, author: attachment.author, documentDate: attachment.documentDate, description: attachment.description }]))
    if (Object.keys(attachmentMetadata).length) files[`${folder}/${ATTACHMENT_METADATA_FILE}`] = strToU8(JSON.stringify(attachmentMetadata, null, 2))
  })
  if (workspace) files[WORKSPACE_BACKUP_FILE] = strToU8(JSON.stringify(workspace, null, 2))
  if (attachmentHistory.length) files[ATTACHMENT_HISTORY_FILE] = strToU8(JSON.stringify(attachmentHistory, null, 2))
  return files
}

export function buildArchive(notes: Note[], assets: NoteAsset[], versions: NoteVersion[] = [], attachments: NoteAttachment[] = [], workspace?: WorkspaceBackup, attachmentHistory: NoteAttachmentHistory[] = []): Uint8Array {
  return zipSync(buildArchiveFiles(notes, assets, versions, attachments, workspace, attachmentHistory), { level: 6 })
}

function zipArchiveProgressively(files: Record<string, Uint8Array>, onProgress?: ArchiveProgressHandler): Promise<Uint8Array> {
  const entries = Object.entries(files)
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let finishedEntries = 0
    let nextEntry = 0
    let activeStreams = 0
    let zipEnded = false
    let failed = false
    const zip = new Zip((error, chunk, final) => {
      if (error) { failed = true; reject(error); return }
      if (chunk?.length) chunks.push(chunk)
      if (final) {
        const total = chunks.reduce((sum, part) => sum + part.length, 0)
        const result = new Uint8Array(total)
        let offset = 0
        for (const part of chunks) { result.set(part, offset); offset += part.length }
        resolve(result)
      }
    })
    const addNextEntries = () => {
      if (failed) return
      let budget = 4
      while (activeStreams < 4 && nextEntry < entries.length && budget > 0) {
        budget -= 1
        const [fileName, bytes] = entries[nextEntry]
        nextEntry += 1
        activeStreams += 1
        const stream = new AsyncZipDeflate(fileName, { level: 6 })
        try {
          zip.add(stream)
          const ondata = stream.ondata
          stream.ondata = (error, chunk, final) => {
            ondata(error, chunk, final)
            if (failed || error) return
            if (final) {
              finishedEntries += 1
              activeStreams -= 1
              onProgress?.({ stage: 'compress', completed: finishedEntries, total: entries.length, current: fileName, percent: Math.round((finishedEntries / Math.max(1, entries.length)) * 100) })
              addNextEntries()
            }
          }
          stream.push(bytes, true)
        } catch (error) { failed = true; reject(error); zip.terminate(); return }
      }
      if (nextEntry === entries.length && !zipEnded) {
        zipEnded = true
        zip.end()
      }
    }
    addNextEntries()
  })
}

function safeObsidianSegment(value: string, fallback: string): string {
  const segment = value.normalize('NFC').trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').replace(/\s+/g, ' ').slice(0, 120)
  return segment && segment !== '.' && segment !== '..' ? segment : fallback
}

function normalizeObsidianTarget(value: string): string {
  let target = value.trim()
  try { target = decodeURIComponent(target) } catch { /* Retain a literal target with an incomplete escape. */ }
  target = target.split(/[＃#^]/, 1)[0].replace(/\\/g, '/').replace(/\.md$/i, '').replace(/^\/+|\/+$/g, '')
  return target.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pl')
}

function rewriteObsidianNoteLinks(content: string, targets: Map<string, string>): string {
  return markdownToWikiLinks(content).replace(/(!?)\[\[([^\]\n]+)\]\]/g, (whole, embed: string, raw: string) => {
    const [rawTarget, rawAlias] = raw.split('|', 2)
    const [targetPath, ...fragments] = (rawTarget ?? '').split(/(?=[#^])/)
    const resolved = targets.get(normalizeObsidianTarget(targetPath ?? ''))
    if (!resolved) return whole
    const label = rawAlias?.trim()
    return `${embed}[[${resolved}${fragments.join('')}${label ? `|${label}` : ''}]]`
  })
}

function rewriteObsidianAssetReferences(content: string, names: Map<string, { fileName: string; mimeType: string }>): string {
  const byName = (raw: string) => {
    let decoded = raw.trim()
    try { decoded = decodeURIComponent(decoded) } catch { /* Keep the path literal. */ }
    const baseName = decoded.replace(/\\/g, '/').split('/').at(-1)?.toLocaleLowerCase('pl') ?? ''
    return names.get(baseName)
  }
  const withWikiEmbeds = content.replace(/!\[\[([^\]\n]+)\]\]/g, (whole, raw: string) => {
    const [rawTarget, rawAlias] = raw.split('|', 2)
    const [targetPath, fragment] = (rawTarget ?? '').split('#', 2)
    const asset = byName(targetPath ?? '')
    if (!asset) return whole
    const label = rawAlias?.trim() || asset.fileName
    const url = `./assets/${encodeURIComponent(asset.fileName)}${fragment ? `#${fragment}` : ''}`
    return asset.mimeType.startsWith('image/') || asset.mimeType === 'image/svg+xml' ? `![${label}](${url})` : `[${label}](${url})`
  })
  return withWikiEmbeds.replace(/(!?\[[^\]]*\]\()((?:\.\/)?assets\/)([^)#?]+)([^)]*\))/g, (whole, prefix: string, folder: string, rawName: string, suffix: string) => {
    const asset = byName(rawName)
    return asset ? `${prefix}${folder}${encodeURIComponent(asset.fileName)}${suffix}` : whole
  })
}

function noteToObsidianMarkdown(note: Note): string {
  const metadata: Record<string, unknown> = {
    id: note.id,
    title: note.title,
    folder: note.folder,
    tags: note.tags,
    favorite: note.favorite,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }
  if (note.color && /^#[\da-f]{6}$/i.test(note.color)) metadata.color = note.color
  if (note.aliases?.length) metadata.aliases = note.aliases
  if (note.dailyDate && /^\d{4}-\d{2}-\d{2}$/.test(note.dailyDate)) metadata.dailyDate = note.dailyDate
  const reserved = new Set(Object.keys(metadata).concat('properties'))
  Object.entries(note.properties ?? {}).forEach(([key, value]) => {
    if (!reserved.has(key) && typeof value === 'string') Object.defineProperty(metadata, key, { value, enumerable: true, configurable: true, writable: true })
  })
  return `---\n${stringifyYaml(metadata).trimEnd()}\n---\n\n${note.content.trimStart()}\n`
}

function buildObsidianVaultFiles(notes: Note[], assets: NoteAsset[] = [], attachments: NoteAttachment[] = []): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  const assetsByNote = groupByNoteId(assets)
  const attachmentsByNote = groupByNoteId(attachments)
  const usedNotePaths = new Set<string>()
  const notePaths = new Map<string, string>()
  const targetPaths = new Map<string, string>()

  notes.forEach(note => {
    const folders = note.folder.replace(/\\/g, '/').split('/').filter(Boolean).map(part => safeObsidianSegment(part, 'Folder'))
    const title = safeObsidianSegment(note.title, 'Notatka')
    const folder = folders.join('/')
    const basePath = [...folders, title].filter(Boolean).join('/')
    let notePath = `${basePath}.md`
    let suffix = 2
    while (usedNotePaths.has(notePath.toLocaleLowerCase('pl'))) notePath = `${basePath} (${suffix++}).md`
    usedNotePaths.add(notePath.toLocaleLowerCase('pl'))
    notePaths.set(note.id, notePath.replace(/\.md$/i, ''))
    for (const target of [note.id, note.title, ...(note.aliases ?? []), `${folder}/${title}`, notePath.replace(/\.md$/i, '')]) {
      const normalized = normalizeObsidianTarget(target)
      if (normalized && !targetPaths.has(normalized)) targetPaths.set(normalized, notePath.replace(/\.md$/i, ''))
    }
  })

  notes.forEach(note => {
    const notePath = notePaths.get(note.id)
    if (!notePath) return
    const noteAssets = (assetsByNote.get(note.id) ?? []).map(asset => ({ fileName: asset.fileName, mimeType: 'image/svg+xml', svg: asset.svg }))
    const noteAttachments = (attachmentsByNote.get(note.id) ?? []).map(attachment => ({ fileName: attachment.fileName, mimeType: attachment.mimeType, dataUrl: attachment.dataUrl }))
    const usedAssetNames = new Set<string>()
    const assetNames = new Map<string, { fileName: string; mimeType: string }>()
    noteAssets.forEach(asset => {
      const originalName = asset.fileName.split(/[\\/]/).at(-1) || 'schemat.svg'
      const safeName = safeObsidianSegment(originalName, 'schemat.svg')
      const dot = safeName.lastIndexOf('.')
      const stem = dot > 0 ? safeName.slice(0, dot) : safeName
      const extension = dot > 0 ? safeName.slice(dot) : ''
      let fileName = safeName
      let suffix = 2
      while (usedAssetNames.has(fileName.toLocaleLowerCase('pl'))) fileName = `${stem} (${suffix++})${extension}`
      usedAssetNames.add(fileName.toLocaleLowerCase('pl'))
      assetNames.set(originalName.toLocaleLowerCase('pl'), { fileName, mimeType: asset.mimeType })
      files[`${notePath}/assets/${fileName}`] = strToU8(sanitizeSvg(asset.svg))
    })
    noteAttachments.forEach(attachment => {
      const originalName = attachment.fileName.split(/[\\/]/).at(-1) || 'zalacznik'
      const safeName = safeObsidianSegment(originalName, 'zalacznik')
      const dot = safeName.lastIndexOf('.')
      const stem = dot > 0 ? safeName.slice(0, dot) : safeName
      const extension = dot > 0 ? safeName.slice(dot) : ''
      let fileName = safeName
      let suffix = 2
      while (usedAssetNames.has(fileName.toLocaleLowerCase('pl'))) fileName = `${stem} (${suffix++})${extension}`
      usedAssetNames.add(fileName.toLocaleLowerCase('pl'))
      assetNames.set(originalName.toLocaleLowerCase('pl'), { fileName, mimeType: attachment.mimeType })
      files[`${notePath}/assets/${fileName}`] = attachmentBytes(attachment.dataUrl)
    })

    const content = rewriteObsidianAssetReferences(rewriteObsidianNoteLinks(note.content, targetPaths), assetNames)
    files[`${notePath}.md`] = strToU8(noteToObsidianMarkdown({ ...note, content }))
  })
  return files
}

export function buildObsidianVaultArchive(notes: Note[], assets: NoteAsset[] = [], attachments: NoteAttachment[] = []): Uint8Array {
  return zipSync(buildObsidianVaultFiles(notes, assets, attachments), { level: 6 })
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
        aliases: Array.isArray(snapshot.aliases) ? snapshot.aliases.filter((alias): alias is string => typeof alias === 'string') : [],
        properties: snapshot.properties && typeof snapshot.properties === 'object' && !Array.isArray(snapshot.properties) ? Object.fromEntries(Object.entries(snapshot.properties).filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string')) : {},
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
  const flashcards: Flashcard[] = Array.isArray(source.flashcards) ? source.flashcards.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const card = item as Partial<Flashcard>
    if (typeof card.id !== 'string' || typeof card.noteId !== 'string' || typeof card.question !== 'string' || typeof card.answer !== 'string') return []
    const imageOcclusion = card.imageOcclusion && typeof card.imageOcclusion.imageDataUrl === 'string' && Array.isArray(card.imageOcclusion.regions)
      ? { imageDataUrl: card.imageOcclusion.imageDataUrl, fileName: typeof card.imageOcclusion.fileName === 'string' ? card.imageOcclusion.fileName : 'obraz', regions: card.imageOcclusion.regions.flatMap(region => region && typeof region.id === 'string' && [region.x, region.y, region.width, region.height].every(value => typeof value === 'number' && Number.isFinite(value)) ? [{ id: region.id, x: Math.max(0, Math.min(1, region.x)), y: Math.max(0, Math.min(1, region.y)), width: Math.max(0, Math.min(1, region.width)), height: Math.max(0, Math.min(1, region.height)), label: typeof region.label === 'string' ? region.label : '' }] : []) }
      : undefined
    const kinds = ['basic', 'cloze', 'image-occlusion', 'sequence', 'numeric', 'audio', 'video']
    const numericAnswer = card.numericAnswer && Number.isFinite(card.numericAnswer.value) && Number.isFinite(card.numericAnswer.tolerance) ? { value: card.numericAnswer.value, tolerance: Math.max(0, card.numericAnswer.tolerance), unit: typeof card.numericAnswer.unit === 'string' ? card.numericAnswer.unit : '' } : undefined
    const mediaClip = card.mediaClip && typeof card.mediaClip.attachmentId === 'string' && Number.isFinite(card.mediaClip.startMs) ? { attachmentId: card.mediaClip.attachmentId, startMs: Math.max(0, card.mediaClip.startMs), endMs: Number.isFinite(card.mediaClip.endMs) ? Math.max(card.mediaClip.startMs, card.mediaClip.endMs!) : undefined } : undefined
    return [{ id: card.id, noteId: card.noteId, question: card.question, answer: card.answer, kind: kinds.includes(card.kind ?? '') ? card.kind : 'basic', studyMode: isFlashcardStudyMode(card.studyMode) ? card.studyMode : 'flip', trueFalseAnswer: typeof card.trueFalseAnswer === 'boolean' ? card.trueFalseAnswer : undefined, template: card.template, tags: Array.isArray(card.tags) ? card.tags.filter((tag): tag is string => typeof tag === 'string') : [], imageOcclusion, hints: Array.isArray(card.hints) ? card.hints.filter((hint): hint is string => typeof hint === 'string').slice(0, 10) : [], answerVariants: Array.isArray(card.answerVariants) ? card.answerVariants.filter((item): item is string => typeof item === 'string').slice(0, 20) : [], sequenceItems: Array.isArray(card.sequenceItems) ? card.sequenceItems.filter((item): item is string => typeof item === 'string').slice(0, 40) : [], numericAnswer, mediaClip, aiDistractors: Array.isArray(card.aiDistractors) ? card.aiDistractors.filter((item): item is string => typeof item === 'string').slice(0, 12) : [], difficulty: card.difficulty, example: typeof card.example === 'string' ? card.example : undefined, mnemonic: typeof card.mnemonic === 'string' ? card.mnemonic : undefined, relatedCardIds: Array.isArray(card.relatedCardIds) ? card.relatedCardIds.filter((id): id is string => typeof id === 'string') : [], glossaryTerms: Array.isArray(card.glossaryTerms) ? card.glossaryTerms.flatMap(item => item && typeof item.term === 'string' && typeof item.definition === 'string' ? [{ term: item.term, definition: item.definition }] : []) : [], suspended: card.suspended === true, dueAt: typeof card.dueAt === 'number' ? card.dueAt : Date.now(), intervalDays: typeof card.intervalDays === 'number' ? card.intervalDays : 0, ease: typeof card.ease === 'number' ? card.ease : 2.5, repetitions: typeof card.repetitions === 'number' ? card.repetitions : 0, lapses: typeof card.lapses === 'number' ? card.lapses : 0, lastReviewedAt: typeof card.lastReviewedAt === 'number' ? card.lastReviewedAt : undefined, reviewHistory: Array.isArray(card.reviewHistory) ? card.reviewHistory.flatMap(event => event && typeof event.at === 'number' && ['again', 'hard', 'good', 'easy'].includes(event.grade) ? [{ at: event.at, grade: event.grade as NonNullable<Flashcard['reviewHistory']>[number]['grade'], confidence: typeof event.confidence === 'number' ? Math.max(1, Math.min(5, Math.round(event.confidence))) : undefined, responseMs: typeof event.responseMs === 'number' ? Math.max(0, event.responseMs) : undefined }] : []).slice(-500) : [] }]
  }) : []
  const flashcardTrash: FlashcardTrashEntry[] = Array.isArray(source.flashcardTrash) ? source.flashcardTrash.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const entry = item as Partial<FlashcardTrashEntry>
    const card = entry.card
    if (typeof entry.id !== 'string' || typeof entry.deletedAt !== 'number' || !card || typeof card.id !== 'string' || typeof card.noteId !== 'string' || typeof card.question !== 'string' || typeof card.answer !== 'string') return []
    const normalized = flashcards.find(value => value.id === card.id) ?? {
      ...card,
      kind: ['basic', 'cloze', 'image-occlusion', 'sequence', 'numeric', 'audio', 'video'].includes(card.kind ?? '') ? card.kind : 'basic',
      studyMode: isFlashcardStudyMode(card.studyMode) ? card.studyMode : 'flip',
      trueFalseAnswer: typeof card.trueFalseAnswer === 'boolean' ? card.trueFalseAnswer : undefined,
      tags: Array.isArray(card.tags) ? card.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      dueAt: typeof card.dueAt === 'number' ? card.dueAt : Date.now(),
      intervalDays: typeof card.intervalDays === 'number' ? Math.max(0, card.intervalDays) : 0,
      ease: typeof card.ease === 'number' ? Math.max(1.3, card.ease) : 2.5,
      repetitions: typeof card.repetitions === 'number' ? Math.max(0, card.repetitions) : 0,
      lapses: typeof card.lapses === 'number' ? Math.max(0, card.lapses) : 0,
      reviewHistory: Array.isArray(card.reviewHistory) ? card.reviewHistory.slice(-500) : [],
    } as Flashcard
    return [{ id: entry.id, deletedAt: entry.deletedAt, card: normalized }]
  }) : []
  const trash: TrashEntry[] = Array.isArray(source.trash) ? source.trash.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const entry = item as Partial<TrashEntry>
    if (typeof entry.id !== 'string' || typeof entry.batchId !== 'string' || typeof entry.deletedAt !== 'number' || !entry.note || typeof entry.note.id !== 'string') return []
    return [{ id: entry.id, batchId: entry.batchId, deletedAt: entry.deletedAt, note: entry.note, assets: Array.isArray(entry.assets) ? entry.assets : [], attachments: Array.isArray(entry.attachments) ? entry.attachments : [] }]
  }) : []
  const organizationSource = source.organization && typeof source.organization === 'object' ? source.organization as Partial<OrganizationSettings> : undefined
  const organization: OrganizationSettings | undefined = organizationSource ? {
    noteOrder: Array.isArray(organizationSource.noteOrder) ? [...new Set(organizationSource.noteOrder.filter((id): id is string => typeof id === 'string'))] : [],
    folderOrder: Array.isArray(organizationSource.folderOrder) ? [...new Set(organizationSource.folderOrder.filter((folder): folder is string => typeof folder === 'string'))] : [],
    folderTemplateDefaults: organizationSource.folderTemplateDefaults && typeof organizationSource.folderTemplateDefaults === 'object' ? Object.fromEntries(Object.entries(organizationSource.folderTemplateDefaults).filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string')) : {},
    workspaces: Array.isArray(organizationSource.workspaces) ? organizationSource.workspaces.flatMap(item => {
      if (!item || typeof item !== 'object') return []
      const layout = item as Partial<SavedWorkspaceLayout>
      if (typeof layout.id !== 'string' || typeof layout.name !== 'string') return []
      return [{ id: layout.id, name: layout.name, selectedNoteId: typeof layout.selectedNoteId === 'string' ? layout.selectedNoteId : '', activeFilter: typeof layout.activeFilter === 'string' ? layout.activeFilter : 'all', activeReviewSessionId: typeof layout.activeReviewSessionId === 'string' ? layout.activeReviewSessionId : '', allNotesPreset: layout.allNotesPreset === 'favorites' || layout.allNotesPreset === 'recent' ? layout.allNotesPreset : 'all', allNotesFolderPreset: typeof layout.allNotesFolderPreset === 'string' ? layout.allNotesFolderPreset : '', noteGridEnabled: layout.noteGridEnabled === true, noteGridIds: Array.isArray(layout.noteGridIds) ? layout.noteGridIds.filter((id): id is string => typeof id === 'string').slice(0, 4) : [], editorMode: layout.editorMode === 'source' ? 'source' : 'rendered', showMainSidebar: layout.showMainSidebar !== false, showFoldersPanel: layout.showFoldersPanel !== false, showChat: layout.showChat === true, createdAt: typeof layout.createdAt === 'number' ? layout.createdAt : Date.now() }]
    }) : [],
    collections: Array.isArray(organizationSource.collections) ? organizationSource.collections.flatMap(item => {
      if (!item || typeof item !== 'object') return []
      const collection = item as Partial<NoteCollection>
      if (typeof collection.id !== 'string' || typeof collection.name !== 'string' || !collection.name.trim()) return []
      return [{ id: collection.id, name: collection.name.trim(), noteIds: Array.isArray(collection.noteIds) ? [...new Set(collection.noteIds.filter((id): id is string => typeof id === 'string'))] : [] }]
    }) : [],
  } : undefined
  return { reviewSessions, savedSearches, noteTemplates, folderColors, flashcards, flashcardTrash, trash, organization }
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

export type ParsedArchive = { notes: Note[]; assets: NoteAsset[]; versions: NoteVersion[]; attachments: NoteAttachment[]; attachmentHistory: NoteAttachmentHistory[]; workspace?: WorkspaceBackup }

function zipEntryCount(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const start = Math.max(0, bytes.byteLength - 65_557)
  for (let offset = bytes.byteLength - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue
    const count = view.getUint16(offset + 10, true)
    return count === 0xffff ? 0 : count
  }
  return 0
}

function unzipArchiveProgressively(bytes: Uint8Array, onProgress?: ArchiveProgressHandler): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    const files: Record<string, Uint8Array> = {}
    const activeFiles = new Set<{ terminate(): void }>()
    const pendingFiles: { file: UnzipFile; chunks: Uint8Array[]; expectedBytes: number; byteLength: number }[] = []
    const expectedTotal = zipEntryCount(bytes)
    let discovered = 0
    let completed = 0
    let activeCount = 0
    let parsingFinished = false
    let settled = false
    let startScheduled = false
    let lastPercent = 0

    const report = (current: string, currentFraction = 0) => {
      const total = expectedTotal || discovered
      if (!total) { onProgress?.({ stage: 'unpack', completed, total: 0, current, percent: 0 }); return }
      const rawPercent = Math.floor(((completed + currentFraction) / total) * 100)
      lastPercent = Math.max(lastPercent, Math.min(99, rawPercent))
      onProgress?.({ stage: 'unpack', completed, total, current, percent: lastPercent })
    }
    const finish = () => {
      if (!settled && parsingFinished && completed === discovered) {
        settled = true
        onProgress?.({ stage: 'unpack', completed, total: expectedTotal || discovered, current: '', percent: 100 })
        resolve(files)
      }
    }
    const scheduleStart = () => {
      if (settled || startScheduled || activeCount >= 4 || !pendingFiles.length) return
      startScheduled = true
      window.setTimeout(() => {
        startScheduled = false
        let budget = 4
        while (!settled && activeCount < 4 && pendingFiles.length && budget > 0) {
          budget -= 1
          const entry = pendingFiles.shift()!
          activeCount += 1
          activeFiles.add(entry.file)
          entry.file.ondata = (error, chunk, final) => {
            if (error) { fail(error); return }
            if (chunk?.length) { entry.chunks.push(chunk); entry.byteLength += chunk.length }
            const currentFraction = entry.expectedBytes > 0 ? Math.min(0.99, entry.byteLength / entry.expectedBytes) : 0
            if (final) {
              const output = new Uint8Array(entry.byteLength)
              let offset = 0
              for (const part of entry.chunks) { output.set(part, offset); offset += part.length }
              files[entry.file.name] = output
              completed += 1
              activeCount -= 1
              activeFiles.delete(entry.file)
              report(entry.file.name)
              scheduleStart()
              finish()
            } else report(entry.file.name, currentFraction)
          }
          try { entry.file.start() } catch (error) { activeCount -= 1; activeFiles.delete(entry.file); fail(error) }
        }
        if (pendingFiles.length && activeCount < 4) scheduleStart()
        finish()
      }, 0)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      activeFiles.forEach(file => file.terminate())
      reject(error instanceof Error ? error : new Error(String(error)))
    }

    const unzipper = new Unzip(file => {
      discovered += 1
      pendingFiles.push({ file, chunks: [], expectedBytes: file.originalSize ?? 0, byteLength: 0 })
      report(file.name)
      scheduleStart()
    })

    unzipper.register(AsyncUnzipInflate)
    try {
      unzipper.push(bytes, true)
      parsingFinished = true
      scheduleStart()
      finish()
    } catch (error) { fail(error) }
  })
}

export async function parseArchive(bytes: Uint8Array, onProgress?: ArchiveProgressHandler): Promise<ParsedArchive> {
  const files = await unzipArchiveProgressively(bytes, onProgress)
  onProgress?.({ stage: 'parse', completed: 0, total: 0, current: '', percent: 0 })
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  return parseUnzippedArchive(files, onProgress)
}

async function parseUnzippedArchive(unzipped: Record<string, Uint8Array>, onProgress?: ArchiveProgressHandler): Promise<ParsedArchive> {
  const unzippedPaths = Object.keys(unzipped)
  const firstPathParts = unzippedPaths[0]?.split('/') ?? []
  const commonRoot = firstPathParts.length > 1 && firstPathParts[0] !== 'notatki' && unzippedPaths.every(path => path.startsWith(`${firstPathParts[0]}/`)) ? `${firstPathParts[0]}/` : ''
  const files = commonRoot ? Object.fromEntries(unzippedPaths.map(path => [path.slice(commonRoot.length), unzipped[path]])) : unzipped
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
  const markdownPaths = Object.keys(files).filter(path => path.toLowerCase().endsWith('.md') && !path.split('/').some(part => part === '.obsidian' || part === '.trash'))
  const allArchivePaths = Object.keys(files)
  const archivePathByNormalized = new Map(allArchivePaths.map(path => [path.toLocaleLowerCase('pl'), path]))
  const archivePathsByDirectory = new Map<string, string[]>()
  const archivePathsByBaseName = new Map<string, string[]>()
  const markdownTargetSuffixes = new Set<string>()
  const notesByDirectory = new Map<string, number>()
  for (const path of allArchivePaths) {
    const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const directoryPaths = archivePathsByDirectory.get(directory)
    if (directoryPaths) directoryPaths.push(path)
    else archivePathsByDirectory.set(directory, [path])
    if (!path.toLowerCase().endsWith('.md')) {
      const baseName = path.split('/').at(-1)?.toLocaleLowerCase('pl') ?? ''
      const namePaths = archivePathsByBaseName.get(baseName)
      if (namePaths) namePaths.push(path)
      else archivePathsByBaseName.set(baseName, [path])
    }
  }
  markdownPaths.forEach(path => {
    const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    notesByDirectory.set(directory, (notesByDirectory.get(directory) ?? 0) + 1)
    const parts = path.toLocaleLowerCase('pl').split('/')
    for (let index = 0; index < parts.length; index += 1) markdownTargetSuffixes.add(parts.slice(index).join('/'))
  })
  const noTieNotePaths = markdownPaths.filter(path => /^notatki\/[^/]+\/notatka\.md$/i.test(path))
  const noTieLayout = Boolean(files[WORKSPACE_BACKUP_FILE]) || noTieNotePaths.length > 0 && noTieNotePaths.length === markdownPaths.length
  const supportedAttachment = (name: string) => {
    const ext = name.toLowerCase().split('.').at(-1)
    return ({
      pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
      mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/opus', '3gp': 'audio/3gpp', amr: 'audio/amr',
      mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
      txt: 'text/plain', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', xml: 'application/xml', rtf: 'application/rtf',
      doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', odt: 'application/vnd.oasis.opendocument.text',
      xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ods: 'application/vnd.oasis.opendocument.spreadsheet',
      ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', odp: 'application/vnd.oasis.opendocument.presentation',
      zip: 'application/zip', epub: 'application/epub+zip', yaml: 'application/yaml', yml: 'application/yaml',
    } as Record<string, string>)[ext ?? ''] ?? ''
  }

  for (let noteIndex = 0; noteIndex < markdownPaths.length; noteIndex += 1) {
    const path = markdownPaths[noteIndex]
    const markdown = strFromU8(files[path])
    const baseName = path.split('/').at(-1)?.replace(/\.md$/i, '') || 'Notatka'
    const idFromPath = noTieLayout ? path.split('/').at(-2) ?? crypto.randomUUID() : crypto.randomUUID()
    const note = markdownToNote(markdown, idFromPath)
    if (!noTieLayout) {
      const firstHeading = note.content.match(/^\s*#\s+(.+)$/m)?.[1]?.trim()
      if (!note.title || note.title === 'Importowana notatka') note.title = firstHeading || baseName.replace(/[-_]+/g, ' ').replace(/\s+[0-9a-f]{6,}$/i, '')
      const relativeParent = path.slice(0, Math.max(0, path.lastIndexOf('/'))).split('/').filter(Boolean).filter(part => !/^(?:assets?|attachments?|media)$/i.test(part))
      note.folder = ['Importowane', ...relativeParent].join('/')
      note.id = idFromPath
    }
    notes.push(note)
    const lastSlash = path.lastIndexOf('/')
    const baseDirectory = lastSlash < 0 ? '' : path.slice(0, lastSlash)
    const basePrefix = baseDirectory ? `${baseDirectory}/` : ''
    let attachmentTranscripts: Record<string, string> = {}
    let attachmentMetadata: Record<string, Partial<Pick<NoteAttachment, 'mimeType' | 'extractedText' | 'transcriptSegments' | 'pdfAnnotations' | 'author' | 'documentDate' | 'description'>>> = {}
    const transcriptFile = files[`${basePrefix}${ATTACHMENT_TRANSCRIPTS_FILE}`]
    if (transcriptFile) {
      try {
        const parsed = JSON.parse(strFromU8(transcriptFile)) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) attachmentTranscripts = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string'))
      } catch { /* An invalid optional transcript manifest does not block note import. */ }
    }
    const metadataFile = files[`${basePrefix}${ATTACHMENT_METADATA_FILE}`]
    if (metadataFile) {
      try {
        const parsed = JSON.parse(strFromU8(metadataFile)) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) attachmentMetadata = parsed as typeof attachmentMetadata
      } catch { /* Ignore optional attachment indexing metadata. */ }
    }
    const notesInSameDirectory = notesByDirectory.get(baseDirectory) ?? 0
    const externalPathMappings: [string, string][] = []
    const referencedFiles = new Map<string, string[]>()
    const obsidianEmbedReferences: { raw: string; path: string; alias: string; fragment: string; embed: boolean }[] = []
    const noteSpecificAssetPrefix = `${path.replace(/\.md$/i, '')}/assets/`
    if (!noTieLayout) {
      const normalizeVaultPath = (value: string) => {
        const normalized: string[] = []
        value.replace(/\\/g, '/').split('/').forEach(segment => {
          if (!segment || segment === '.') return
          if (segment === '..') normalized.pop()
          else normalized.push(segment)
        })
        return normalized.join('/')
      }
      for (const match of note.content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
        const raw = match[1].trim().split(/[?#]/, 1)[0]
        if (!raw || raw.startsWith('#') || /^(?:[a-z]+:|\/\/)/i.test(raw)) continue
        let decoded = raw
        try { decoded = decodeURIComponent(raw) } catch { /* Keep literal spaces in legacy Markdown paths. */ }
        const canonical = normalizeVaultPath(decoded.startsWith('/') ? decoded.slice(1) : `${baseDirectory}/${decoded}`)
        if (!canonical || canonical.toLowerCase().endsWith('.md')) continue
        const basename = canonical.split('/').at(-1)?.toLocaleLowerCase('pl')
        const noteSpecificPath = normalizeVaultPath(`${path.replace(/\.md$/i, '')}/assets/${basename ?? ''}`)
        const rootPath = normalizeVaultPath(`${baseDirectory}/${canonical}`)
        const directPath = archivePathByNormalized.get(canonical.toLocaleLowerCase('pl')) ?? archivePathByNormalized.get(rootPath.toLocaleLowerCase('pl'))
        const noteSpecificArchivePath = archivePathByNormalized.get(noteSpecificPath.toLocaleLowerCase('pl'))
        const nameMatches = archivePathsByBaseName.get(basename ?? '') ?? []
        const matchedPath = directPath || noteSpecificArchivePath || [...nameMatches]
          .sort((first, second) => Number(second.startsWith(noteSpecificAssetPrefix)) - Number(first.startsWith(noteSpecificAssetPrefix)) || Number(/(?:^|\/)(?:assets?|attachments?|media)\//i.test(second)) - Number(/(?:^|\/)(?:assets?|attachments?|media)\//i.test(first)))[0]
        if (matchedPath) referencedFiles.set(matchedPath, [...(referencedFiles.get(matchedPath) ?? []), raw])
      }
      for (const match of note.content.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
        const raw = match[2].trim()
        const [rawTarget, rawAlias] = raw.split('|', 2)
        const [target, fragment = ''] = (rawTarget ?? '').split('#', 2)
        if (!target?.trim()) continue
        let decoded = target.trim()
        try { decoded = decodeURIComponent(decoded) } catch { /* Keep the literal Obsidian path. */ }
        const rootTarget = normalizeVaultPath(decoded.startsWith('/') ? decoded.slice(1) : decoded)
        const relativeTarget = normalizeVaultPath(`${baseDirectory}/${decoded}`)
        const candidates = [relativeTarget, rootTarget]
        let matchingMarkdown = candidates.some(candidate => archivePathByNormalized.has((candidate.toLowerCase().endsWith('.md') ? candidate : `${candidate}.md`).toLocaleLowerCase('pl')))
        if (!matchingMarkdown && !/\.[a-z\d]{1,8}$/i.test(rootTarget)) matchingMarkdown = markdownTargetSuffixes.has(`${rootTarget}.md`.toLocaleLowerCase('pl'))
        if (matchingMarkdown) continue
        const targetBaseName = rootTarget.split('/').at(-1)?.toLocaleLowerCase('pl') ?? ''
        const noteSpecificTarget = `${path.replace(/\.md$/i, '')}/assets/${target.split(/[\\/]/).at(-1) ?? ''}`
        const matchedPath = candidates.map(candidate => archivePathByNormalized.get(candidate.toLocaleLowerCase('pl'))).find(candidate => candidate && !candidate.toLowerCase().endsWith('.md'))
          ?? archivePathByNormalized.get(noteSpecificTarget.toLocaleLowerCase('pl'))
          ?? [...(archivePathsByBaseName.get(targetBaseName) ?? [])]
            .sort((first, second) => Number(second.startsWith(noteSpecificAssetPrefix)) - Number(first.startsWith(noteSpecificAssetPrefix)) || Number(/(?:^|\/)(?:assets?|attachments?|media)\//i.test(second)) - Number(/(?:^|\/)(?:assets?|attachments?|media)\//i.test(first)))[0]
        if (!matchedPath) continue
        referencedFiles.set(matchedPath, [...(referencedFiles.get(matchedPath) ?? []), raw])
        obsidianEmbedReferences.push({ raw, path: matchedPath, alias: rawAlias?.trim() ?? '', fragment, embed: match[1] === '!' })
      }
    }
    const versionsFile = files[`${basePrefix}${NOTE_VERSIONS_FILE}`]
    if (versionsFile) {
      try { versions.push(...archivedNoteVersions(JSON.parse(strFromU8(versionsFile)), note.id)) } catch { /* Ignore an invalid optional history sidecar. */ }
    }
    const importedObsidianFiles = new Map<string, { fileName: string; mimeType: string }>()
    const assetCandidates = new Set(referencedFiles.keys())
    const noteSpecificAssetDirectory = noteSpecificAssetPrefix.slice(0, -1)
    if (noTieLayout) {
      ;(archivePathsByDirectory.get(`${baseDirectory}/assets`) ?? []).forEach(assetPath => assetCandidates.add(assetPath))
      ;(archivePathsByDirectory.get(`${baseDirectory}/attachments`) ?? []).forEach(assetPath => assetCandidates.add(assetPath))
      ;(archivePathsByDirectory.get(baseDirectory) ?? []).forEach(assetPath => assetCandidates.add(assetPath))
    } else {
      ;(archivePathsByDirectory.get(noteSpecificAssetDirectory) ?? []).forEach(assetPath => assetCandidates.add(assetPath))
      if (notesInSameDirectory === 1) (archivePathsByDirectory.get(baseDirectory) ?? []).forEach(assetPath => assetCandidates.add(assetPath))
    }
    for (const assetPath of assetCandidates) {
      if (assetPath.toLowerCase().endsWith('.md') || assetPath === path) continue
      const fileName = assetPath.split('/').at(-1)
      if (!fileName) continue
      if (fileName.toLowerCase().endsWith('.svg')) {
        assets.push({ id: `${note.id}:${fileName}`, noteId: note.id, fileName, svg: sanitizeSvg(strFromU8(files[assetPath])) })
        importedObsidianFiles.set(assetPath, { fileName, mimeType: 'image/svg+xml' })
        if (!noTieLayout) {
          const referenceNames = referencedFiles.get(assetPath) ?? [assetPath.startsWith(basePrefix) ? assetPath.slice(basePrefix.length) : assetPath]
          referenceNames.forEach(reference => externalPathMappings.push([reference, `./assets/${fileName}`]))
        }
      } else {
        const mimeType = attachmentMetadata[fileName]?.mimeType ?? supportedAttachment(fileName)
        if (mimeType) {
          const bytes = files[assetPath]
          const reportAttachmentProgress = (percent: number, start = 0, span = 100) => {
            const noteProgress = ((noteIndex + (start + (percent / 100) * span) / 100) / Math.max(1, markdownPaths.length)) * 100
            onProgress?.({ stage: 'parse', completed: noteIndex, total: markdownPaths.length, current: `${path} · ${fileName}`, percent: Math.floor(noteProgress) })
          }
          const dataUrl = await bytesToDataUrlProgressively(bytes, mimeType, percent => reportAttachmentProgress(percent, 0, 50))
          const contentHash = await fileFingerprintProgressively(bytes, percent => reportAttachmentProgress(percent, 50, 50))
          attachments.push({ ...attachmentMetadata[fileName], id: `${note.id}:${fileName}`, noteId: note.id, fileName, mimeType, dataUrl, size: bytes.byteLength, contentHash, transcript: attachmentTranscripts[fileName] })
          importedObsidianFiles.set(assetPath, { fileName, mimeType })
          if (!noTieLayout) {
            const referenceNames = referencedFiles.get(assetPath) ?? [assetPath.startsWith(basePrefix) ? assetPath.slice(basePrefix.length) : assetPath]
            referenceNames.forEach(reference => externalPathMappings.push([reference, `./assets/${fileName}`]))
          }
        }
      }
    }
    if (!noTieLayout) for (const [externalPath, internalPath] of externalPathMappings) {
      const escaped = externalPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      note.content = note.content.replace(new RegExp(`\\((?:\\./)?${escaped}(#[^)]*)?\\)`, 'g'), (_whole, fragment = '') => `(${internalPath}${fragment})`)
    }
    if (!noTieLayout) for (const reference of obsidianEmbedReferences) {
      const importedFile = importedObsidianFiles.get(reference.path)
      if (!importedFile) continue
      const label = reference.alias || importedFile.fileName
      const url = `./assets/${encodeURIComponent(importedFile.fileName)}${reference.fragment ? `#${reference.fragment}` : ''}`
      const replacement = reference.embed && (importedFile.mimeType.startsWith('image/') || importedFile.mimeType === 'image/svg+xml') ? `![${label}](${url})` : `[${label}](${url})`
      note.content = note.content.replaceAll(`${reference.embed ? '!' : ''}[[${reference.raw}]]`, replacement)
    }
    onProgress?.({ stage: 'parse', completed: noteIndex + 1, total: markdownPaths.length, current: path, percent: Math.round(((noteIndex + 1) / markdownPaths.length) * 100) })
    if ((noteIndex + 1) % 4 === 0 && noteIndex + 1 < markdownPaths.length) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
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
  downloadZipArchive(archive, archiveFileName())
}

function downloadZipArchive(archive: Uint8Array, fileName: string) {
  const blob = archiveBlob(archive)
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = fileName
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

export async function exportArchiveToFolder(notes: Note[], assets: NoteAsset[], versions: NoteVersion[] = [], attachments: NoteAttachment[] = [], workspace?: WorkspaceBackup, attachmentHistory: NoteAttachmentHistory[] = [], onProgress?: ArchiveProgressHandler): Promise<string | null> {
  const files = buildArchiveFiles(notes, assets, versions, attachments, workspace, attachmentHistory)
  const archive = await zipArchiveProgressively(files, onProgress)
  const fileName = archiveFileName()
  onProgress?.({ stage: 'save', completed: 0, total: 0, current: fileName, percent: 100 })
  return exportZipToFolder(archive, fileName)
}

function obsidianArchiveFileName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19)
  return `obsidian-vault-${stamp}.zip`
}

export function downloadObsidianVault(notes: Note[], assets: NoteAsset[] = [], attachments: NoteAttachment[] = []) {
  downloadZipArchive(buildObsidianVaultArchive(notes, assets, attachments), obsidianArchiveFileName())
}

export async function exportObsidianVaultToFolder(notes: Note[], assets: NoteAsset[] = [], attachments: NoteAttachment[] = [], onProgress?: ArchiveProgressHandler): Promise<string | null> {
  const archive = await zipArchiveProgressively(buildObsidianVaultFiles(notes, assets, attachments), onProgress)
  const fileName = obsidianArchiveFileName()
  onProgress?.({ stage: 'save', completed: 0, total: 0, current: fileName, percent: 100 })
  return exportZipToFolder(archive, fileName)
}

async function exportZipToFolder(archive: Uint8Array, fileName: string): Promise<string | null> {
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

  downloadZipArchive(archive, fileName)
  return fileName
}
