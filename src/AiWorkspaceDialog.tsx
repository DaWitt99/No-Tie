import { useState } from 'react'
import { Plus, Settings2, Sparkles, Trash2, X } from 'lucide-react'
import type { AiPreferences, AiPromptProfile, AiTaskType, AiOutputTemplate } from './types'

const taskOptions: { id: AiTaskType; label: string }[] = [
  { id: 'chat', label: 'Czat' }, { id: 'summary', label: 'Podsumowanie' }, { id: 'tasks', label: 'Zadania' },
  { id: 'flashcards', label: 'Fiszki' }, { id: 'quiz', label: 'Quiz' }, { id: 'selection-edit', label: 'Edycja zaznaczenia' },
  { id: 'metadata', label: 'Tagi i właściwości' }, { id: 'flashcard-assist', label: 'Pomoc przy fiszkach' },
  { id: 'ocr', label: 'OCR załączników' },
]

export function AiWorkspaceDialog({ preferences, folders, availableModels, onChange, onClose }: {
  preferences: AiPreferences
  folders: string[]
  availableModels: string[]
  onChange: (preferences: AiPreferences) => void
  onClose: () => void
}) {
  const [profileTask, setProfileTask] = useState<AiTaskType>('summary')
  const [templateDraft, setTemplateDraft] = useState<AiOutputTemplate | null>(null)
  const profiles = preferences.promptProfiles

  function patch(patch: Partial<AiPreferences>) { onChange({ ...preferences, ...patch }) }
  function addProfile() {
    const profile: AiPromptProfile = { id: crypto.randomUUID(), task: profileTask, name: 'Nowy profil', prompt: '' }
    patch({ promptProfiles: [...profiles, profile] })
  }
  function updateProfile(id: string, update: Partial<AiPromptProfile>) {
    patch({ promptProfiles: profiles.map(profile => profile.id === id ? { ...profile, ...update } : profile) })
  }
  function addTemplate() { setTemplateDraft({ id: crypto.randomUUID(), name: '', format: 'markdown', instruction: '' }) }
  function saveTemplate() {
    if (!templateDraft?.name.trim() || !templateDraft.instruction.trim()) return
    const exists = preferences.outputTemplates.some(template => template.id === templateDraft.id)
    patch({ outputTemplates: exists ? preferences.outputTemplates.map(template => template.id === templateDraft.id ? templateDraft : template) : [...preferences.outputTemplates, templateDraft] })
    setTemplateDraft(null)
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="ai-workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-workspace-title">
      <header><span className="folder-dialog-mark"><Settings2 size={18} /></span><div><h2 id="ai-workspace-title">Ustawienia AI</h2><p>Profile promptów, zakres dostępu, formaty odpowiedzi i diagnostyka.</p></div><button type="button" className="icon-button" aria-label="Zamknij" onClick={onClose}><X size={17} /></button></header>
      <div className="ai-workspace-content">
        <section className="ai-workspace-section">
          <div className="ai-workspace-section-heading"><div><strong>Dostęp do folderów</strong><small>Ograniczenie obejmuje kontekst notatek, załączniki i narzędzia AI.</small></div><label className="ai-workspace-switch"><input type="checkbox" checked={preferences.folderAccessRestricted} onChange={event => patch({ folderAccessRestricted: event.target.checked })} /><span>Ogranicz dostęp</span></label></div>
          {preferences.folderAccessRestricted && <div className="ai-workspace-folder-list">{folders.length ? folders.map(folder => <label key={folder}><input type="checkbox" checked={preferences.allowedFolders.includes(folder)} onChange={event => patch({ allowedFolders: event.target.checked ? [...new Set([...preferences.allowedFolders, folder])] : preferences.allowedFolders.filter(item => item !== folder) })} /><span>{folder || 'Bez folderu'}</span></label>) : <small>Nie ma jeszcze folderów. Notatki bez folderu są dostępne.</small>}<label><input type="checkbox" checked={preferences.allowedFolders.includes('')} onChange={event => patch({ allowedFolders: event.target.checked ? [...preferences.allowedFolders, ''] : preferences.allowedFolders.filter(folder => folder !== '') })} /><span>Notatki bez folderu</span></label></div>}
          {preferences.folderAccessRestricted && <small className="ai-workspace-help">Gdy lista jest pusta, AI nie otrzymuje treści żadnej notatki.</small>}
        </section>

        <section className="ai-workspace-section">
          <div className="ai-workspace-section-heading"><div><strong>Model zapasowy</strong><small>Uruchomi się, jeśli model główny zwróci błąd albo pustą odpowiedź.</small></div></div>
          <input className="ai-workspace-text-input" list="ai-fallback-model-options" value={preferences.fallbackModel} onChange={event => patch({ fallbackModel: event.target.value })} placeholder="Wyłączony" aria-label="Model zapasowy" />
          <datalist id="ai-fallback-model-options">{availableModels.map(model => <option key={model} value={model} />)}</datalist>
        </section>

        <section className="ai-workspace-section">
          <div className="ai-workspace-section-heading"><div><strong>Profile promptów</strong><small>Dodaj własne wskazówki dla wybranego rodzaju zadania.</small></div><div className="ai-workspace-add-control"><select aria-label="Rodzaj zadania profilu" value={profileTask} onChange={event => setProfileTask(event.target.value as AiTaskType)}>{taskOptions.map(task => <option key={task.id} value={task.id}>{task.label}</option>)}</select><button className="button secondary" type="button" onClick={addProfile}><Plus size={13} />Dodaj profil</button></div></div>
          <div className="ai-workspace-profile-list">{profiles.map(profile => <article key={profile.id}><div className="ai-workspace-profile-top"><select aria-label="Zadanie profilu" value={profile.task} onChange={event => updateProfile(profile.id, { task: event.target.value as AiTaskType })}>{taskOptions.map(task => <option key={task.id} value={task.id}>{task.label}</option>)}</select><input aria-label="Nazwa profilu" value={profile.name} onChange={event => updateProfile(profile.id, { name: event.target.value })} placeholder="Nazwa profilu" /><button className="icon-button danger-icon" aria-label="Usuń profil" onClick={() => patch({ promptProfiles: profiles.filter(item => item.id !== profile.id) })}><Trash2 size={14} /></button></div><textarea aria-label={`Instrukcja profilu ${profile.name}`} value={profile.prompt} onChange={event => updateProfile(profile.id, { prompt: event.target.value })} placeholder="Dodatkowe instrukcje, które AI zastosuje przy tym zadaniu…" rows={3} /></article>)}{!profiles.length && <p className="ai-workspace-empty">Nie ma jeszcze własnych profili. Domyślne ustawienia każdej funkcji nadal działają.</p>}</div>
        </section>

        <section className="ai-workspace-section">
          <div className="ai-workspace-section-heading"><div><strong>Szablony wyników</strong><small>Wybieraj format przy generowaniu podsumowań, zadań, quizów i metadanych.</small></div><button className="button secondary" type="button" onClick={addTemplate}><Plus size={13} />Dodaj szablon</button></div>
          <div className="ai-workspace-template-list">{preferences.outputTemplates.map(template => <article key={template.id}><div><strong>{template.name}</strong><small>{template.format.toUpperCase()}</small></div><button className="link-button" type="button" onClick={() => setTemplateDraft({ ...template })}>Edytuj</button>{!template.id.startsWith('default-') && <button className="icon-button danger-icon" aria-label={`Usuń szablon ${template.name}`} onClick={() => patch({ outputTemplates: preferences.outputTemplates.filter(item => item.id !== template.id) })}><Trash2 size={14} /></button>}</article>)}</div>
          {templateDraft && <div className="ai-workspace-template-editor"><input autoFocus value={templateDraft.name} onChange={event => setTemplateDraft({ ...templateDraft, name: event.target.value })} placeholder="Nazwa szablonu" aria-label="Nazwa szablonu" /><select value={templateDraft.format} onChange={event => setTemplateDraft({ ...templateDraft, format: event.target.value as AiOutputTemplate['format'] })} aria-label="Format szablonu"><option value="markdown">Markdown</option><option value="bullets">Lista punktowana</option><option value="json">JSON</option><option value="table">Tabela</option></select><textarea value={templateDraft.instruction} onChange={event => setTemplateDraft({ ...templateDraft, instruction: event.target.value })} placeholder="Instrukcja określająca strukturę i zawartość wyniku" rows={3} aria-label="Instrukcja szablonu" /><div><button type="button" className="button secondary" onClick={() => setTemplateDraft(null)}>Anuluj</button><button type="button" className="button primary" disabled={!templateDraft.name.trim() || !templateDraft.instruction.trim()} onClick={saveTemplate}>Zapisz szablon</button></div></div>}
        </section>

        <section className="ai-workspace-section">
          <div className="ai-workspace-section-heading"><div><strong>Diagnostyka modelu</strong><small>Ostatni kontekst, użyty model i czas odpowiedzi.</small></div></div>
          {preferences.lastDiagnostic ? <div className="ai-diagnostic-grid"><span>Zadanie<strong>{taskOptions.find(task => task.id === preferences.lastDiagnostic?.task)?.label ?? preferences.lastDiagnostic.task}</strong></span><span>Model<strong>{preferences.lastDiagnostic.model || 'nieznany'}</strong></span><span>Kontekst<strong>{preferences.lastDiagnostic.contextCharacters.toLocaleString('pl-PL')} znaków · {preferences.lastDiagnostic.contextImages} obrazów</strong></span><span>Czas<strong>{(preferences.lastDiagnostic.durationMs / 1000).toFixed(1)} s</strong></span><span>Wykonano<strong>{new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeStyle: 'short' }).format(preferences.lastDiagnostic.createdAt)}</strong></span>{preferences.lastDiagnostic.error && <span className="ai-diagnostic-error">Błąd<strong>{preferences.lastDiagnostic.error}</strong></span>}</div> : <p className="ai-workspace-empty">Diagnostyka pojawi się po zakończeniu zadania AI.</p>}
        </section>

        <section className="ai-workspace-section">
          <div className="ai-workspace-section-heading"><div><strong>Zapamiętane oceny</strong><small>Oceny i komentarze są dołączane do promptów tego samego rodzaju zadań.</small></div></div>
          {preferences.ratings.length ? <div className="ai-workspace-ratings">{preferences.ratings.slice(-8).reverse().map((rating, index) => <article key={`${rating.createdAt}-${index}`}><span className={rating.rating > 0 ? 'positive' : 'negative'}>{rating.rating > 0 ? 'Dobra odpowiedź' : 'Do poprawy'}</span><small>{taskOptions.find(task => task.id === rating.task)?.label ?? rating.task}</small>{rating.comment && <p>{rating.comment}</p>}</article>)}</div> : <p className="ai-workspace-empty">Oceń odpowiedź w oknie AI, aby zapisać swoje preferencje.</p>}
        </section>
      </div>
      <footer><span><Sparkles size={13} />Ustawienia zapisują się automatycznie.</span><button className="button primary" type="button" onClick={onClose}>Gotowe</button></footer>
    </section>
  </div>
}
