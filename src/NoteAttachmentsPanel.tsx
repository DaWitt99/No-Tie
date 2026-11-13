import { useRef, useState } from 'react'
import { AudioLines, FileText, ImagePlus, Link2, Mic, MicOff, ScanText, Trash2 } from 'lucide-react'
import type { NoteAttachment } from './types'

const sizeLabel = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
type SpeechRecognitionLike = { continuous: boolean; interimResults: boolean; lang: string; start: () => void; stop: () => void; onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null }
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

export function NoteAttachmentsPanel({ attachments, onAdd, onRemove, onOcr, onTranscribe, onInsertText, onSaveTranscript, onInsertAttachmentLink, onPreview, audioEnabled = true }: { attachments: NoteAttachment[]; onAdd: (files: File[]) => Promise<NoteAttachment[]>; onRemove: (attachment: NoteAttachment) => void; onOcr?: (attachment: NoteAttachment) => Promise<string>; onTranscribe?: (attachment: NoteAttachment) => Promise<string>; onInsertText: (text: string) => void; onSaveTranscript: (attachment: NoteAttachment, transcript: string) => void; onInsertAttachmentLink: (attachment: NoteAttachment) => void; onPreview: (attachment: NoteAttachment) => void; audioEnabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const speech = useRef<SpeechRecognitionLike | null>(null)
  const audioChunks = useRef<BlobPart[]>([])
  const transcriptSegments = useRef<string[]>([])
  const recordingActive = useRef(false)
  const speechShouldContinue = useRef(false)
  const speechSessionId = useRef(0)
  const speechRestartTimer = useRef<number | null>(null)
  const [ocrBusy, setOcrBusy] = useState('')
  const [transcriptionBusy, setTranscriptionBusy] = useState('')
  const [ocrResult, setOcrResult] = useState('')
  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [audioError, setAudioError] = useState('')
  const [showMicrophonePrompt, setShowMicrophonePrompt] = useState(false)
  const [microphoneRequesting, setMicrophoneRequesting] = useState(false)
  const [microphonePermissionExplained, setMicrophonePermissionExplained] = useState(() => {
    try { return sessionStorage.getItem('no-tie-microphone-explained') === 'true' } catch { return false }
  })
  const transcriptText = useRef('')
  const transcriptAttachment = useRef<NoteAttachment | null>(null)
  const persistedTranscript = useRef('')
  const [transcriptDrafts, setTranscriptDrafts] = useState<Record<string, string>>({})

  function saveFinalTranscript(attachment: NoteAttachment | null) {
    const value = transcriptText.current.trim()
    if (!attachment || !value || persistedTranscript.current === value) return
    persistedTranscript.current = value
    onSaveTranscript(attachment, value)
  }

  function updateSpeechTranscript(interim = '') {
    const complete = transcriptSegments.current.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
    transcriptText.current = complete
    setTranscript([complete, interim.trim()].filter(Boolean).join(' '))
  }

  function openMicrophonePrompt() {
    setAudioError('')
    setShowMicrophonePrompt(true)
  }

  function startRecording() {
    if (microphonePermissionExplained) void requestMicrophone()
    else openMicrophonePrompt()
  }

  async function requestMicrophone() {
    speechSessionId.current += 1
    setAudioError('')
    setTranscript('')
    transcriptText.current = ''
    transcriptSegments.current = []
    transcriptAttachment.current = null
    persistedTranscript.current = ''
    audioChunks.current = []
    recordingActive.current = false
    speechShouldContinue.current = false
    if (speechRestartTimer.current !== null) window.clearTimeout(speechRestartTimer.current)
    speechRestartTimer.current = null
    setMicrophoneRequesting(true)
    let stream: MediaStream | undefined
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Ta przeglądarka lub widok aplikacji nie udostępnia mikrofonu.')
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream = mediaStream
      if (typeof MediaRecorder === 'undefined') throw new Error('Nagrywanie audio nie jest obsługiwane przez to urządzenie.')
      const mediaRecorder = new MediaRecorder(mediaStream)
      recorder.current = mediaRecorder
      mediaRecorder.ondataavailable = event => { if (event.data.size) audioChunks.current.push(event.data) }
      mediaRecorder.onstop = async () => {
        const mimeType = mediaRecorder.mimeType || 'audio/webm'
        const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'webm'
        const file = new File(audioChunks.current, `nagranie-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`, { type: mimeType })
        try {
          const added = await onAdd([file])
          const audioAttachment = added.find(attachment => attachment.mimeType.startsWith('audio/'))
          if (audioAttachment) {
            transcriptAttachment.current = audioAttachment
            saveFinalTranscript(audioAttachment)
          }
        } catch (error) {
          setAudioError(error instanceof Error ? error.message : 'Nie udało się zapisać nagrania.')
        } finally { mediaStream.getTracks().forEach(track => track.stop()) }
      }
      mediaRecorder.start()
      recordingActive.current = true
      setRecording(true)

      const browser = window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }
      const Speech = browser.SpeechRecognition ?? browser.webkitSpeechRecognition
      if (Speech) {
        try {
          const SpeechRecognition = Speech
          const currentSessionId = speechSessionId.current
          let retryCount = 0
          let restartDelay = 350
          let recognitionCycle = 0
          const isCurrentSession = () => currentSessionId === speechSessionId.current
          const isRecognitionActive = () => isCurrentSession() && speechShouldContinue.current && recordingActive.current
          const scheduleRecognitionRestart = () => {
            if (!isRecognitionActive()) return
            if (speechRestartTimer.current !== null) window.clearTimeout(speechRestartTimer.current)
            speechRestartTimer.current = window.setTimeout(() => {
              speechRestartTimer.current = null
              if (!isRecognitionActive()) return
              try { startRecognition() } catch {
                retryCount += 1
                restartDelay = Math.min(500 * 2 ** Math.min(retryCount - 1, 3), 4000)
                setAudioError('Nie udało się wznowić transkrypcji. Ponawiam próbę; nagranie audio nadal trwa.')
                scheduleRecognitionRestart()
              }
            }, restartDelay)
          }
          function startRecognition() {
            if (!isRecognitionActive()) return
            const recognizer = new SpeechRecognition()
            const currentCycle = ++recognitionCycle
            const isCurrentCycle = () => currentCycle === recognitionCycle
            recognizer.continuous = true
            recognizer.interimResults = true
            recognizer.lang = 'pl-PL'
            const sessionOffset = transcriptSegments.current.length
            recognizer.onresult = event => {
              if (!isCurrentSession() || !isCurrentCycle()) return
              let interim = ''
              for (let index = 0; index < event.results.length; index += 1) {
                const result = event.results[index]
                const words = result[0].transcript.trim()
                if (!words) continue
                if (result.isFinal) transcriptSegments.current[sessionOffset + index] = words
                else interim = words
              }
              if (interim || event.results.length) {
                retryCount = 0
                restartDelay = 350
                setAudioError(current => current.startsWith('Systemowe rozpoznawanie mowy zostało przerwane') || current.startsWith('Nie udało się wznowić transkrypcji') || current.startsWith('Nie udało się uruchomić transkrypcji') ? '' : current)
              }
              updateSpeechTranscript(interim)
            }
            recognizer.onerror = event => {
              if (!isRecognitionActive() || !isCurrentCycle()) return
              if (event.error !== 'no-speech') {
                retryCount += 1
                restartDelay = Math.min(500 * 2 ** Math.min(retryCount - 1, 3), 4000)
                setAudioError('Systemowe rozpoznawanie mowy zostało przerwane. Ponawiam próbę, dopóki trwa nagranie.')
              }
            }
            recognizer.onend = () => {
              if (!isCurrentSession() || !isCurrentCycle()) return
              updateSpeechTranscript()
              if (isRecognitionActive()) {
                scheduleRecognitionRestart()
                return
              }
              saveFinalTranscript(transcriptAttachment.current)
            }
            speech.current = recognizer
            recognizer.start()
          }
          speechShouldContinue.current = true
          try { startRecognition() } catch {
            retryCount = 1
            restartDelay = 500
            setAudioError('Nie udało się uruchomić transkrypcji. Ponawiam próbę; nagranie audio nadal trwa.')
            scheduleRecognitionRestart()
          }
        } catch {
          speechShouldContinue.current = false
          speech.current = null
          setAudioError('Nagranie audio będzie kontynuowane, ale systemowa transkrypcja nie jest dostępna.')
        }
      }
      setMicrophonePermissionExplained(true)
      try { sessionStorage.setItem('no-tie-microphone-explained', 'true') } catch { /* Permission remains granted for this component session. */ }
      setShowMicrophonePrompt(false)
    } catch (error) {
      recordingActive.current = false
      speechShouldContinue.current = false
      stream?.getTracks().forEach(track => track.stop())
      setShowMicrophonePrompt(true)
      const name = error instanceof DOMException ? error.name : ''
      if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(name)) {
        setAudioError('Dostęp do mikrofonu jest zablokowany. Zmień uprawnienie dla No-Tie w ustawieniach urządzenia lub przeglądarki i spróbuj ponownie.')
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setAudioError('Nie wykryto mikrofonu. Podłącz mikrofon lub sprawdź jego ustawienia.')
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setAudioError('Mikrofon jest niedostępny albo używa go inna aplikacja.')
      } else {
        setAudioError(error instanceof Error ? error.message : 'Nie udało się uruchomić mikrofonu.')
      }
    } finally { setMicrophoneRequesting(false) }
  }
  function stopRecording() {
    speechSessionId.current += 1
    recordingActive.current = false
    speechShouldContinue.current = false
    if (speechRestartTimer.current !== null) window.clearTimeout(speechRestartTimer.current)
    speechRestartTimer.current = null
    try { speech.current?.stop() } catch { /* Recognition may already have stopped between phrases. */ }
    try { if (recorder.current?.state === 'recording') recorder.current.stop() } catch { /* The recorder may already be stopping. */ }
    setRecording(false)
  }
  async function runOcr(attachment: NoteAttachment) {
    if (!onOcr) return
    setOcrBusy(attachment.id); setOcrResult('')
    try { setOcrResult(await onOcr(attachment)) } catch (error) { setAudioError(error instanceof Error ? error.message : 'Nie udało się odczytać tekstu.') }
    finally { setOcrBusy('') }
  }
  async function runTranscription(attachment: NoteAttachment) {
    if (!onTranscribe) return
    setTranscriptionBusy(attachment.id)
    setAudioError('')
    try {
      const transcript = await onTranscribe(attachment)
      setTranscriptDrafts(current => ({ ...current, [attachment.id]: transcript }))
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : 'Nie udało się transkrybować pliku audio.')
    } finally { setTranscriptionBusy('') }
  }

  return <section className="note-attachments-panel" aria-label="Załączniki notatki">
    <div className="note-attachments-heading"><div><strong>Załączniki</strong><span>{attachments.length} plików</span></div><button type="button" className="button secondary" onClick={() => input.current?.click()}><ImagePlus size={14} />Dodaj plik</button><input ref={input} type="file" accept={`image/*,application/pdf,.pdf,video/*,.mp4,.m4v,.mov,.webm${audioEnabled ? ',audio/*,.mp3,.m4a,.wav,.ogg' : ''}`} multiple hidden onChange={event => { if (event.currentTarget.files?.length) onAdd(Array.from(event.currentTarget.files)); event.currentTarget.value = '' }} /></div>
    {audioEnabled && <div className="audio-note-tools"><button type="button" className={`button ${recording ? 'danger' : 'secondary'}`} onClick={() => recording ? stopRecording() : startRecording()}>{recording ? <MicOff size={14} /> : <Mic size={14} />}{recording ? 'Zakończ nagranie' : 'Nagraj notatkę audio'}</button><span>{recording ? 'Nagrywanie…' : 'Audio zostanie zapisane jako załącznik.'}</span></div>}
    {audioEnabled && recording && transcript && <div className="audio-transcript"><strong>Transkrypcja na żywo</strong><p>{transcript}</p></div>}
    {audioError && !showMicrophonePrompt && <p className="audio-note-error" role="status">{audioError}</p>}
    {attachments.length ? <div className="note-attachments-grid">{attachments.map(attachment => {
      const isAudio = attachment.mimeType.startsWith('audio/')
      const isVideo = attachment.mimeType.startsWith('video/')
      const transcriptValue = transcriptDrafts[attachment.id] ?? attachment.transcript ?? ''
      return <article className={`attachment-card ${isAudio ? 'audio-attachment-card' : isVideo ? 'video-attachment-card' : ''}`} key={attachment.id}>
      {isAudio ? <div className="attachment-audio-card"><AudioLines size={20} /><span className="attachment-file-name">{attachment.fileName}</span><audio controls preload="none" src={attachment.dataUrl} aria-label={'Odtwórz ' + attachment.fileName} />{onTranscribe && <button type="button" className="button secondary audio-transcribe-button" disabled={transcriptionBusy === attachment.id} onClick={() => void runTranscription(attachment)}>{transcriptionBusy === attachment.id ? 'Transkrybuję lokalnie…' : 'Transkrybuj lokalnie'}</button>}<details className="audio-transcript-details" open={Boolean(attachment.transcript)}><summary>{attachment.transcript ? 'Transkrypcja' : 'Dodaj transkrypcję'}</summary><textarea aria-label={'Transkrypcja ' + attachment.fileName} value={transcriptValue} onChange={event => setTranscriptDrafts(current => ({ ...current, [attachment.id]: event.target.value }))} placeholder="Wpisz lub popraw transkrypcję nagrania" rows={4} /><div><button type="button" className="button secondary" disabled={!transcriptValue.trim()} onClick={() => onSaveTranscript(attachment, transcriptValue.trim())}>Zapisz transkrypcję</button></div></details><button type="button" className="button primary audio-transcript-insert" disabled={!transcriptValue.trim()} onClick={() => onInsertText(transcriptValue)}>Wstaw do notatki</button></div> : isVideo ? <div className="attachment-video-card"><video controls preload="metadata" src={attachment.dataUrl} aria-label={'Odtwórz ' + attachment.fileName} /><span className="attachment-file-name">{attachment.fileName}</span><small>{sizeLabel(attachment.size)}</small></div> : <button className="attachment-preview-button" type="button" onClick={() => onPreview(attachment)} aria-label={'Podgląd: ' + attachment.fileName}>{attachment.mimeType.startsWith('image/') ? <img src={attachment.dataUrl} alt={attachment.fileName} /> : <span className="attachment-pdf-icon"><FileText size={25} /><small>PDF</small></span>}<span className="attachment-file-name">{attachment.fileName}</span><small>{sizeLabel(attachment.size)}</small></button>}
      {attachment.mimeType.startsWith('image/') && onOcr && <button type="button" className="attachment-ocr" disabled={ocrBusy === attachment.id} onClick={() => void runOcr(attachment)}><ScanText size={13} />{ocrBusy === attachment.id ? 'Odczytuję…' : 'Odczytaj tekst'}</button>}
      <button type="button" className="attachment-insert-link" aria-label={`Wstaw link do notatki: ${attachment.fileName}`} title="Wstaw link do notatki" onClick={() => onInsertAttachmentLink(attachment)}><Link2 size={13} /><span>Wstaw link</span></button>
      <button className="attachment-delete" type="button" aria-label={`Usuń załącznik ${attachment.fileName}`} onClick={() => onRemove(attachment)}><Trash2 size={14} /></button>
    </article>})}</div> : <p className="attachment-empty">Dodaj obraz, PDF, nagranie audio lub wideo do tej notatki.</p>}
    {ocrResult && <div className="ocr-result"><strong>Rozpoznany tekst</strong><textarea value={ocrResult} onChange={event => setOcrResult(event.target.value)} rows={5} /><div><button type="button" className="button secondary" onClick={() => setOcrResult('')}>Odrzuć</button><button type="button" className="button primary" onClick={() => { onInsertText(ocrResult); setOcrResult('') }}>Wstaw do notatki</button></div></div>}
    {showMicrophonePrompt && <div className="modal-backdrop microphone-permission-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !microphoneRequesting) setShowMicrophonePrompt(false) }}><section className="folder-dialog microphone-permission-dialog" role="dialog" aria-modal="true" aria-labelledby="microphone-permission-title"><div className="folder-dialog-mark microphone-permission-mark"><Mic size={19} /></div><p className="eyebrow">NOTATKA GŁOSOWA</p><h2 id="microphone-permission-title">Dostęp do mikrofonu</h2><p>No-Tie nagra audio jako załącznik. Jeśli przeglądarka obsługuje rozpoznawanie mowy, pokaże też transkrypcję na żywo.</p><div className="microphone-permission-info"><AudioLines size={17} /><span>Po kontynuowaniu system lub przeglądarka pokaże własne pytanie o zgodę.</span></div>{audioError && <p className="microphone-permission-error" role="alert">{audioError}</p>}<div className="folder-dialog-actions"><button type="button" className="button secondary" disabled={microphoneRequesting} onClick={() => { setShowMicrophonePrompt(false); setAudioError('') }}>Anuluj</button><button type="button" className="button primary" disabled={microphoneRequesting} onClick={() => void requestMicrophone()}>{microphoneRequesting ? 'Proszę czekać…' : <><Mic size={14} />Zezwól i nagraj</>}</button></div></section></div>}
  </section>
}
