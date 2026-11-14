import { Channel, invoke, isTauri } from '@tauri-apps/api/core'
import { sanitizeSvg } from './content'

export type OllamaModel = {
  name: string
  size?: number
  modified_at?: string
}

export async function transcribeLocalAudio(endpoint: string, fileName: string, mimeType: string, dataUrl: string): Promise<unknown> {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('Plik audio ma nieprawidłowy format.')
  const binary = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  if (isTauri()) return invoke<unknown>('transcribe_local_audio', { endpoint, fileName, mimeType, bytes })
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: mimeType }), fileName)
  form.append('model', 'whisper-1')
  form.append('response_format', 'verbose_json')
  const response = await fetch(endpoint, { method: 'POST', body: form, signal: AbortSignal.timeout(15 * 60_000) })
  const result: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const detail = result && typeof result === 'object' && 'error' in result ? String((result as { error: unknown }).error) : `HTTP ${response.status}`
    throw new Error(`Lokalna usługa transkrypcji odrzuciła plik (${detail}).`)
  }
  return result
}

export async function embedOllamaTexts(baseUrl: string, model: string, input: string[]): Promise<number[][]> {
  if (!model.trim()) throw new Error('Wybierz model embeddingów Ollama.')
  if (isTauri()) {
    try { return await invoke<number[][]>('ollama_embed', { baseUrl, model, input }) }
    catch (error) {
      if (error instanceof Error) throw error
      if (typeof error === 'string' && error.trim()) throw new Error(error)
      throw new Error('Nie udało się uzyskać wektorów semantycznych z Ollama.')
    }
  }
  try {
    const response = await fetch(apiUrl(baseUrl, 'embed'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(120_000),
    })
    const result = await readJson<{ embeddings?: number[][] }>(response)
    if (!Array.isArray(result.embeddings)) throw new Error('Model nie zwrócił wektorów semantycznych.')
    return result.embeddings
  } catch (error) {
    throw connectionError(error, baseUrl)
  }
}

export type OllamaMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
  images?: string[]
}

export type OllamaGenerationOptions = {
  numPredict?: number
  numCtx?: number
}

export async function imageAttachmentToPngBase64(dataUrl: string): Promise<string> {
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Nie udało się odczytać obrazu z załącznika.'))
    image.src = dataUrl
  })
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('Obraz z załącznika ma nieprawidłowe wymiary.')
  const scale = Math.min(1.6, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Nie udało się przygotować obrazu z załącznika.')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png').split(',', 2)[1] ?? ''
}

export async function svgToPngBase64(svg: string): Promise<string> {
  const safeSvg = sanitizeSvg(svg)
  const parsedDocument = new DOMParser().parseFromString(safeSvg, 'image/svg+xml')
  const root = parsedDocument.documentElement
  const dimension = (value: string | null) => {
    if (!value || /%\s*$/.test(value)) return undefined
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }
  const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
  const hasValidViewBox = viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0
  const viewBoxWidth = hasValidViewBox ? viewBox[2] : undefined
  const viewBoxHeight = hasValidViewBox ? viewBox[3] : undefined
  const widthAttribute = dimension(root.getAttribute('width'))
  const heightAttribute = dimension(root.getAttribute('height'))
  const sourceWidth = widthAttribute ?? (heightAttribute && viewBoxWidth && viewBoxHeight
    ? heightAttribute * viewBoxWidth / viewBoxHeight
    : viewBoxWidth ?? 800)
  const sourceHeight = heightAttribute ?? (viewBoxWidth && viewBoxHeight
    ? sourceWidth * viewBoxHeight / viewBoxWidth
    : 500)
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('Grafika SVG ma nieprawidłowe wymiary.')
  }
  root.setAttribute('width', String(sourceWidth))
  root.setAttribute('height', String(sourceHeight))

  const objectUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Nie udało się przygotować schematu SVG dla modelu.'))
      image.src = objectUrl
    })
    const scale = Math.min(2, 1536 / Math.max(sourceWidth, sourceHeight))
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Nie udało się przygotować obrazu schematu.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    const dataUrl = canvas.toDataURL('image/png')
    return dataUrl.slice(dataUrl.indexOf(',') + 1)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function apiUrl(baseUrl: string, route: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  let parsed: URL
  try {
    parsed = new URL(base)
  } catch {
    throw new Error('Podaj prawidłowy adres Ollama, np. http://localhost:11434.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Adres Ollama musi zaczynać się od http:// lub https://.')
  }
  const root = base.endsWith('/api') ? base.slice(0, -4) : base
  return `${root}/api/${route}`
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message || `Ollama zwróciła błąd HTTP ${response.status}.`)
  }
  return response.json() as Promise<T>
}

function connectionError(error: unknown, baseUrl: string): Error {
  if (error instanceof Error && !(error instanceof TypeError)) return error
  const browserHint = isTauri() ? '' : ' W wersji przeglądarkowej Ollama musi zezwalać na adres strony w OLLAMA_ORIGINS.'
  return new Error(`Nie można połączyć się z Ollama pod adresem ${baseUrl}. Upewnij się, że aplikacja Ollama jest uruchomiona.${browserHint}`)
}

export async function listOllamaModels(baseUrl: string): Promise<OllamaModel[]> {
  if (isTauri()) return invoke<OllamaModel[]>('ollama_list_models', { baseUrl })
  try {
    const response = await fetch(apiUrl(baseUrl, 'tags'), { signal: AbortSignal.timeout(12_000) })
    const result = await readJson<{ models?: OllamaModel[] }>(response)
    return result.models ?? []
  } catch (error) {
    throw connectionError(error, baseUrl)
  }
}

function readOllamaStreamLine(line: string, onChunk: (content: string) => void): void {
  const trimmed = line.trim()
  if (!trimmed) return
  let item: { message?: { content?: unknown }; error?: unknown }
  try {
    item = JSON.parse(trimmed) as typeof item
  } catch {
    throw new Error('Ollama zwróciła nieprawidłowy fragment odpowiedzi.')
  }
  if (typeof item.error === 'string' && item.error) throw new Error(item.error)
  if (typeof item.message?.content === 'string' && item.message.content) onChunk(item.message.content)
}

async function consumeOllamaStream(response: Response, onChunk: (content: string) => void): Promise<void> {
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message || `Ollama zwróciła błąd HTTP ${response.status}.`)
  }
  if (!response.body) throw new Error('Ollama nie udostępniła strumienia odpowiedzi.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    pending += decoder.decode(value, { stream: true })
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) readOllamaStreamLine(line, onChunk)
  }
  pending += decoder.decode()
  if (pending.trim()) readOllamaStreamLine(pending, onChunk)
}

export async function streamOllamaMessage(baseUrl: string, model: string, messages: OllamaMessage[], onChunk: (content: string) => void, signal?: AbortSignal, generationOptions?: OllamaGenerationOptions): Promise<void> {
  if (!model.trim()) throw new Error('Wybierz model w ustawieniach Ollama.')
  if (signal?.aborted) return
  if (isTauri()) {
    const requestId = crypto.randomUUID()
    const cancelNativeRequest = () => { void invoke<void>('ollama_chat_cancel', { requestId }).catch(() => {}) }
    const onChunkChannel = new Channel<string>()
    onChunkChannel.onmessage = onChunk
    signal?.addEventListener('abort', cancelNativeRequest, { once: true })
    try {
      if (signal?.aborted) {
        cancelNativeRequest()
        return
      }
      await invoke<void>('ollama_chat_stream', { baseUrl, model, messages, requestId, onChunk: onChunkChannel, generationOptions: generationOptions ?? null })
    } catch (error) {
      if (signal?.aborted) return
      if (typeof error === 'string') throw new Error(error)
      throw connectionError(error, baseUrl)
    } finally {
      signal?.removeEventListener('abort', cancelNativeRequest)
    }
    return
  }
  try {
    const timeoutSignal = AbortSignal.timeout(generationOptions ? 15 * 60_000 : 5 * 60_000)
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    const response = await fetch(apiUrl(baseUrl, 'chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, options: generationOptions ? { num_predict: generationOptions.numPredict, num_ctx: generationOptions.numCtx } : undefined }),
      signal: requestSignal,
    })
    await consumeOllamaStream(response, onChunk)
  } catch (error) {
    if (signal?.aborted) return
    throw connectionError(error, baseUrl)
  }
}
