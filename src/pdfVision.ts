import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export type PdfVisionPage = { base64: string; pageNumber: number; totalPages: number }
export type PdfVisionResult = { pages: PdfVisionPage[]; totalPages: number }

function dataUrlBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('Załączony PDF ma nieprawidłowy format.')
  const binary = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export async function pdfAttachmentToVisionPages(dataUrl: string, pageLimit: number, pageStart = 1): Promise<PdfVisionResult> {
  const loadingTask = getDocument({ data: dataUrlBytes(dataUrl) })
  const document = await loadingTask.promise
  try {
    const firstPage = Math.min(document.numPages + 1, Math.max(1, Math.floor(pageStart)))
    const lastPage = Math.min(document.numPages, firstPage + Math.max(0, Math.floor(pageLimit)) - 1)
    const pages: PdfVisionPage[] = []
    for (let pageNumber = firstPage; pageNumber <= lastPage; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const baseViewport = page.getViewport({ scale: 1 })
      const scale = Math.min(1.6, 1600 / Math.max(baseViewport.width, baseViewport.height))
      const viewport = page.getViewport({ scale })
      const canvas = window.document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(viewport.width))
      canvas.height = Math.max(1, Math.ceil(viewport.height))
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('Nie udało się przygotować strony PDF dla modelu.')
      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: context, viewport }).promise
      pages.push({ base64: canvas.toDataURL('image/png').split(',', 2)[1] ?? '', pageNumber, totalPages: document.numPages })
      page.cleanup()
      canvas.width = 1
      canvas.height = 1
    }
    return { pages, totalPages: document.numPages }
  } finally {
    await loadingTask.destroy()
  }
}
