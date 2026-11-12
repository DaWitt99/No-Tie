import { useRef, useState } from 'react'
import { AudioLines, FileText, ImagePlus, Mic, MicOff, ScanText, Trash2, X } from 'lucide-react'
import type { NoteAttachment } from './types'

const sizeLabel = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
type SpeechRecognitionLike = { start: () => void; stop: () => void; onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null }
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

export function NoteAttachmentsPanel({ attachments, onAdd, onRemove, onOcr, onInsertText }: { attachments: NoteAttachment[]; onAdd: (files: File[]) => void; onRemove: (attachment: NoteAttachment) => void; onOcr: (attachment: NoteAttachment) => Promise<string>; onInsertText: (text: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const speech = useRef<SpeechRecognitionLike | null>(null)
  const audioChunks = useRef<BlobPart[]>([])
  const [preview, setPreview] = useState<NoteAttachment | null>(null)
  const [ocrBusy, setOcrBusy] = useState('')
  const [ocrResult, setOcrResult] = useState('')
  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [audioError, setAudioError] = useState('')

  async function startRecording() {
    setAudioError(''); setTranscript(''); audioChunks.current = []
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      recorder.current = mediaRecorder
      mediaRecorder.ondataavailable = event => { if (event.data.size) audioChunks.current.push(event.data) }
      mediaRecorder.onstop = () => {
        const mimeType = mediaRecorder.mimeType || 'audio/webm'
        const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'webm'
        const file = new File(audioChunks.current, `nagranie-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`, { type: mimeType })
        onAdd([file]); stream.getTracks().forEach(track => track.stop())
      }
      const browser = window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }
      const Speech = browser.SpeechRecognition ?? browser.webkitSpeechRecognition
      if (Speech) {
        const recognizer = new Speech()
        recognizer.onresult = event => setTranscript(current => current + [...Array.from(event.results)].filter(result => result.isFinal).map(result => result[0].transcript).join(' '))
        recognizer.onerror = () => setAudioError('Nagranie audio zapisze się, ale transkrypcja nie jest dostępna w tej przeglądarce.')
        try { recognizer.start(); speech.current = recognizer } catch { /* Recording still works without dictation. */ }
      }
      mediaRecorder.start()
      setRecording(true)
    } catch (error) { setAudioError(error instanceof Error ? error.message : 'Nie udało się uruchomić mikrofonu.') }
  }
  function stopRecording() { recorder.current?.stop(); speech.current?.stop(); setRecording(false) }
  async function runOcr(attachment: NoteAttachment) {
    setOcrBusy(attachment.id); setOcrResult('')
    try { setOcrResult(await onOcr(attachment)) } catch (error) { setAudioError(error instanceof Error ? error.message : 'Nie udało się odczytać tekstu.') }
    finally { setOcrBusy('') }
  }

  return <section className="note-attachments-panel" aria-label="Załączniki notatki">
    <div className="note-attachments-heading"><div><strong>Załączniki</strong><span>{attachments.length} plików</span></div><button type="button" className="button secondary" onClick={() => input.current?.click()}><ImagePlus size={14} />Dodaj plik</button><input ref={input} type="file" accept="image/*,application/pdf,audio/*,.pdf,.mp3,.m4a,.wav,.ogg,.webm" multiple hidden onChange={event => { if (event.currentTarget.files?.length) onAdd(Array.from(event.currentTarget.files)); event.currentTarget.value = '' }} /></div>
    <div className="audio-note-tools"><button type="button" className={`button ${recording ? 'danger' : 'secondary'}`} onClick={() => recording ? stopRecording() : void startRecording()}>{recording ? <MicOff size={14} /> : <Mic size={14} />}{recording ? 'Zakończ nagranie' : 'Nagraj notatkę audio'}</button><span>{recording ? 'Nagrywanie…' : 'Audio zostanie zapisane jako załącznik.'}</span></div>
    {transcript && <div className="audio-transcript"><strong>Transkrypcja</strong><p>{transcript}</p><button className="button secondary" type="button" onClick={() => { onInsertText(transcript); setTranscript('') }}>Wstaw do notatki</button></div>}
    {audioError && <p className="audio-note-error" role="status">{audioError}</p>}
    {attachments.length ? <div className="note-attachments-grid">{attachments.map(attachment => <article className="attachment-card" key={attachment.id}>
      {attachment.mimeType.startsWith('audio/') ? <div className="attachment-audio-card"><AudioLines size={20} /><span className="attachment-file-name">{attachment.fileName}</span><audio controls preload="none" src={attachment.dataUrl} aria-label={`Odtwórz ${attachment.fileName}`} /></div> : <button className="attachment-preview-button" type="button" onClick={() => setPreview(attachment)} aria-label={`Podgląd: ${attachment.fileName}`}>{attachment.mimeType.startsWith('image/') ? <img src={attachment.dataUrl} alt={attachment.fileName} /> : <span className="attachment-pdf-icon"><FileText size={25} /><small>PDF</small></span>}<span className="attachment-file-name">{attachment.fileName}</span><small>{sizeLabel(attachment.size)}</small></button>}
      {!attachment.mimeType.startsWith('audio/') && <button type="button" className="attachment-ocr" disabled={ocrBusy === attachment.id} onClick={() => void runOcr(attachment)}><ScanText size={13} />{ocrBusy === attachment.id ? 'Odczytuję…' : 'Odczytaj tekst'}</button>}
      <button className="attachment-delete" type="button" aria-label={`Usuń załącznik ${attachment.fileName}`} onClick={() => onRemove(attachment)}><Trash2 size={14} /></button>
    </article>)}</div> : <p className="attachment-empty">Dodaj obraz, PDF lub nagranie audio do tej notatki.</p>}
    {ocrResult && <div className="ocr-result"><strong>Rozpoznany tekst</strong><textarea value={ocrResult} onChange={event => setOcrResult(event.target.value)} rows={5} /><div><button type="button" className="button secondary" onClick={() => setOcrResult('')}>Odrzuć</button><button type="button" className="button primary" onClick={() => { onInsertText(ocrResult); setOcrResult('') }}>Wstaw do notatki</button></div></div>}
    {preview && <div className="modal-backdrop attachment-preview-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPreview(null) }}><section className="attachment-preview-dialog" role="dialog" aria-modal="true" aria-label={`Podgląd ${preview.fileName}`}><header><div><strong>{preview.fileName}</strong><span>{sizeLabel(preview.size)}</span></div><a href={preview.dataUrl} download={preview.fileName} className="button secondary">Pobierz</a><button type="button" className="icon-button" aria-label="Zamknij podgląd" onClick={() => setPreview(null)}><X size={17} /></button></header>{preview.mimeType.startsWith('image/') ? <img className="attachment-large-image" src={preview.dataUrl} alt={preview.fileName} /> : <iframe title={`Podgląd ${preview.fileName}`} src={preview.dataUrl} />}</section></div>}
  </section>
}
