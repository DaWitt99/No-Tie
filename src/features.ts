export const featureModules = [
  { id: 'appLock', title: 'Blokada aplikacji', description: 'PIN i blokada po bezczynności.' },
  { id: 'semanticSearch', title: 'Wyszukiwanie semantyczne', description: 'Dopasowuje znaczenie zapytania do treści notatek.' },
  { id: 'advancedQuery', title: 'Zaawansowane zapytania', description: 'Operatory logiczne, daty i typy załączników.' },
  { id: 'smartFolders', title: 'Inteligentne foldery', description: 'Wirtualne foldery z zapisanych zapytań.' },
  { id: 'bulkActions', title: 'Operacje zbiorcze', description: 'Zaznaczanie wielu notatek i wspólne akcje.' },
  { id: 'duplicateManager', title: 'Wykrywanie duplikatów', description: 'Porównanie podobnych notatek i załączników.' },
  { id: 'attachmentIndex', title: 'Indeks załączników', description: 'Rozpoznany tekst z plików dostępny w wyszukiwaniu.' },
  { id: 'audioNotes', title: 'Notatki audio', description: 'Pokazuje nagrania i ich transkrypcje; pliki pozostają zapisane po wyłączeniu.' },
  { id: 'transcriptTimestamps', title: 'Znaczniki czasu i mówcy', description: 'Pokazuje transkrypcję w segmentach z czasem i etykietami mówców, jeśli zwraca je serwer.' },
  { id: 'pdfAnnotations', title: 'Adnotacje PDF', description: 'Notatki przypisane do stron dokumentu.' },
  { id: 'attachmentManager', title: 'Menedżer załączników', description: 'Przegląd załączników ze wszystkich notatek.' },
  { id: 'aiCitations', title: 'Źródła odpowiedzi AI', description: 'Wymaga od czatu wskazywania źródeł i stron.' },
  { id: 'aiContextPicker', title: 'Wybór kontekstu AI', description: 'Pozwala wybrać konkretne notatki do wiadomości.' },
  { id: 'aiTaskExtraction', title: 'Zadania z AI', description: 'Proponuje zadania na podstawie notatki.' },
  { id: 'aiSummaries', title: 'Podsumowania AI', description: 'Tworzy skróty i konspekty notatek.' },
  { id: 'aiFlashcards', title: 'Fiszki i quizy AI', description: 'Generuje fiszki lub quiz na podstawie treści notatki.' },
  { id: 'noteReminders', title: 'Przypomnienia o notatkach', description: 'Przypomina o ponownym otwarciu notatki.' },
  { id: 'noteBoard', title: 'Tablica statusów', description: 'Grupuje notatki według etapu pracy.' },
  { id: 'projectDashboard', title: 'Pulpit projektów', description: 'Podsumowuje notatki i zadania projektu.' },
] as const

export type FeatureId = typeof featureModules[number]['id']
export type FeatureFlags = Record<FeatureId, boolean>

export const defaultFeatureFlags = Object.fromEntries(featureModules.map(feature => [feature.id, true])) as FeatureFlags

export function readFeatureFlags(): FeatureFlags {
  try {
    const value = JSON.parse(localStorage.getItem('no-tie-feature-modules') ?? '{}') as Partial<FeatureFlags>
    return Object.fromEntries(featureModules.map(feature => [feature.id, typeof value[feature.id] === 'boolean' ? value[feature.id] : true])) as FeatureFlags
  } catch {
    return defaultFeatureFlags
  }
}
