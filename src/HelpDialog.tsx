import { useEffect, useMemo, useState } from 'react'
import { BookOpen, CheckSquare2, ChevronRight, CircleHelp, Search, X } from 'lucide-react'

type HelpSection = {
  id: string
  title: string
  summary: string
  steps: string[]
  tip?: string
  keywords?: string
}

const helpSections: HelpSection[] = [
  {
    id: 'start',
    title: 'Pierwsze kroki i zapis',
    summary: 'No-Tie zapisuje notatki lokalnie i działa bez konta. Zmiany w edytorze są zapisywane automatycznie.',
    steps: [
      'Kliknij „Nowa notatka” w lewym panelu albo przycisk w pustym widoku, aby utworzyć notatkę.',
      'Wpisz tytuł, treść i opcjonalne tagi. Wybierz folder w wierszu nad tytułem.',
      'Wskaźnik w górnym pasku pokazuje, czy trwa zapis. W aplikacji Tauri pliki znajdują się w Dokumenty/No-Tie/Notatki; wersja przeglądarkowa używa pamięci tej przeglądarki.',
      'Aby przenieść notatki na inne urządzenie, użyj eksportu i importu paczki ZIP z górnego paska.',
    ],
    tip: 'W przeglądarce dane są związane z konkretną przeglądarką i urządzeniem. Regularnie eksportuj paczkę jako kopię zapasową.',
    keywords: 'offline lokalnie automatycznie zapis dysk komputer folder pliki',
  },
  {
    id: 'library',
    title: 'Biblioteka, widoki i ulubione',
    summary: 'Biblioteka pozwala otwierać notatki, przeglądać ostatnie wpisy i wybierać sposób prezentacji listy.',
    steps: [
      'Kliknij „Wszystkie notatki”, „Ulubione” lub „Ostatnie” w lewym panelu, aby zmienić listę.',
      'W bibliotece wybierz „Treść i tagi”, „Nazwy i tagi” albo „Same nazwy”.',
      'Kliknij ikonę gwiazdki przy otwartej notatce, aby dodać ją do ulubionych lub ją z nich usunąć.',
      'Użyj przycisku panelu biblioteki w górnym pasku, aby ją schować albo ponownie wyświetlić.',
    ],
    keywords: 'panel lista widok karta ostatnie gwiazdka ulubione ukryj',
  },
  {
    id: 'organize',
    title: 'Foldery, kolory i porządkowanie',
    summary: 'Foldery, tagi i kolory pomagają organizować bibliotekę. Pliki i foldery można przenosić przeciąganiem.',
    steps: [
      'Kliknij plus obok nagłówka „Foldery”, wpisz nazwę i utwórz folder.',
      'Przeciągnij notatkę na folder, aby ją przenieść. Przeciągnij folder na inny folder, aby umieścić go wewnątrz; przeciągnij na „Bez folderu”, aby przenieść go do głównego poziomu.',
      'Kliknij menu z trzema kropkami przy pliku lub folderze, aby zmienić nazwę, ustawić kolor albo usunąć element.',
      'Dodaj tag w wierszu pod tytułem notatki, wpisując go i naciskając Enter. Kliknij tag, aby go usunąć.',
      'Kolor ustawiony dla folderu lub notatki jest widoczny w lewym panelu i w bibliotece.',
    ],
    tip: 'Usunięcie folderu usuwa również jego zawartość. Przed zatwierdzeniem aplikacja pokazuje podsumowanie operacji.',
    keywords: 'przenoszenie drag drop przeciągnij zmień nazwę usuń kolor etykieta tag',
  },
  {
    id: 'search',
    title: 'Wyszukiwanie, filtry i zapisane widoki',
    summary: 'Wyszukiwarka przeszukuje notatki i obsługuje filtry po tagach, folderach, tytułach oraz treści.',
    steps: [
      'Wpisz frazę w polu „Szukaj notatek…”. Szybkie wyszukiwanie otworzysz także skrótem Ctrl+K (⌘K na macOS).',
      'Użyj ikony filtrów, aby wybrać tag i folder. Możesz też wpisać operatory: tag:projekt, folder:Praca, title:spotkanie lub content:ustalenia.',
      'Otwórz „Zapisane widoki”, aby zapisać aktualne zapytanie i filtry pod własną nazwą, a potem szybko do nich wracać.',
    ],
    keywords: 'szukaj query filtr tag folder title content Ctrl K zapisane zapytanie widoki',
  },
  {
    id: 'markdown',
    title: 'Edytor Markdown i formatowanie',
    summary: 'Treść jest przechowywana jako Markdown. Możesz edytować ją w widoku wizualnym albo bezpośrednio w surowym tekście.',
    steps: [
      'Kliknij ikonę oka, aby pracować w widoku wizualnym, lub ikonę dokumentu, aby zobaczyć i edytować surowy Markdown.',
      'Zaznacz tekst i kliknij prawym przyciskiem w edytorze, aby otworzyć menu formatowania, akapitów i wstawek. Jeśli tekst jest zaznaczony, formatowanie obejmuje zaznaczenie; w innym wypadku działa w bieżącym miejscu.',
      'Menu pozwala m.in. pogrubić, pochylić, przekreślić, podkreślić, wyróżnić i sformatować tekst jako kod lub matematykę. Wstawisz też listy, nagłówki, cytaty, przypisy, tabele, bloki kodu, matematyki i wyróżnienia.',
      'Licznik pod edytorem pokazuje liczbę słów i znaków dokumentu oraz aktualnego zaznaczenia.',
      'Ctrl+Z cofa, a Ctrl+Y ponawia zmianę. Skróty mają odpowiedniki ⌘Z i ⌘Y na macOS.',
    ],
    tip: 'Markdown można również pisać ręcznie, np. „## Nagłówek”, „- punkt” albo „- [ ] zadanie”.',
    keywords: 'markdown surowy źródło widok wizualny menu kontekstowe formatowanie lista matematyka undo redo słowa znaki',
  },
  {
    id: 'tables',
    title: 'Tabele Markdown',
    summary: 'Tabele można rozbudowywać i porządkować z poziomu paska narzędzi lub menu kontekstowego tabeli.',
    steps: [
      'Wstaw tabelę z menu prawego przycisku w edytorze albo kliknij istniejącą tabelę, aby pokazać narzędzia.',
      'Przeciągnij krawędź kolumny, aby zmienić jej szerokość. Przyciski paska dodają wiersz lub kolumnę.',
      'Kliknij prawym przyciskiem w tabeli, aby otworzyć jej menu. Dodasz tam wiersz lub kolumnę przed bieżącą komórką, usuniesz wiersz lub kolumnę, skopiujesz całą tabelę albo zmienisz kolor komórki.',
      'Przyciski A–Z i Z–A sortują według kolumny; pole „Filtruj kolumnę…” ogranicza widoczne wiersze. Wyczyść filtr, aby ponownie pokazać całą tabelę.',
    ],
    tip: 'Kopiowanie tabeli umieszcza całą tabelę w schowku, gotową do wklejenia.',
    keywords: 'tabela kolumna wiersz rozmiar szerokość sort filtr kolor kopiuj',
  },
  {
    id: 'links',
    title: 'Łączenie notatek i mapa powiązań',
    summary: 'Linki wewnętrzne łączą notatki w sieć. Aplikacja wyświetla zarówno linki wychodzące, jak i odsyłacze zwrotne.',
    steps: [
      'Kliknij „Połącz notatkę” nad edytorem i wybierz notatkę docelową, aby wstawić odsyłacz.',
      'Możesz też wpisać w Markdown składnię [[Tytuł notatki]].',
      'Rozwiń sekcję „Powiązania” pod treścią, aby otworzyć notatki linkujące do bieżącej lub wskazywane przez nią.',
      'Kliknij „Mapa powiązań” w lewym panelu albo przycisk „Mapa” pod notatką, aby zobaczyć połączenia w całej bibliotece. Kliknij węzeł, aby otworzyć notatkę.',
    ],
    keywords: 'link wiki odsyłacz backlink graf mapa sieć powiązania [[ ]]',
  },
  {
    id: 'daily-tasks',
    title: 'Notatki dzienne i zadania',
    summary: 'Notatki dzienne tworzą regularny dziennik, a panel zadań zbiera pozycje z list kontrolnych Markdown.',
    steps: [
      'Otwórz „Notatki dzienne” w sekcji narzędzi, przejdź do wybranego miesiąca i kliknij datę. „Dzisiaj” szybko otwiera bieżący wpis.',
      'Wpisy dzienne są zwykłymi notatkami Markdown i pojawiają się w kalendarzu po utworzeniu.',
      'W treści notatki utwórz zadanie składnią „- [ ] Treść zadania”. W panelu „Zadania” możesz też dodać zadanie do wybranej notatki, termin i priorytet.',
      'Zaznacz pole, aby oznaczyć zadanie jako wykonane. Zmień termin i priorytet w wierszu zadania; opcja „Pokaż ukończone” wyświetla zamknięte pozycje.',
      'Kliknij tytuł źródłowej notatki przy zadaniu, aby do niej przejść.',
    ],
    keywords: 'kalendarz dziennik data zadanie checkbox termin priorytet wykonane',
  },
  {
    id: 'templates',
    title: 'Szablony notatek',
    summary: 'Szablony pozwalają szybko wstawiać powtarzalny układ treści i tagów.',
    steps: [
      'Wybierz szablon z listy „Szablon” nad edytorem. Wstawienie zastępuje tytuł i treść oraz dodaje tagi szablonu do notatki.',
      'Kliknij ikonę ołówka obok listy albo „Szablony” w lewym panelu, aby tworzyć i edytować własne układy.',
      'Podaj nazwę, tagi oddzielone przecinkami i treść Markdown, a następnie zapisz szablon.',
    ],
    keywords: 'wzór template układ notatki treść tags tworzenie spotkanie nauka projekt',
  },
  {
    id: 'svg',
    title: 'Edytor schematów SVG',
    summary: 'Edytor pozwala tworzyć wektorowe schematy bezpośrednio z notatki. Zapisany schemat pozostaje edytowalny.',
    steps: [
      'Kliknij „Dodaj schemat” nad edytorem. Aby zmienić istniejący rysunek, kliknij jego przycisk z nazwą pliku.',
      'Wybierz narzędzie zaznaczania, prostokąt, zaokrąglony prostokąt, elipsę, linię, strzałkę, wielokąt, symbol z biblioteki 40 kształtów, pędzel lub tekst.',
      'Narysuj element przeciągnięciem kursora. Po utworzeniu narzędzie wraca do zaznaczania; przytrzymaj Ctrl podczas rysowania, jeśli chcesz zostawić aktualne narzędzie aktywne.',
      'Zaznacz obiekt kliknięciem lub przeciągnij pusty fragment planszy, aby zaznaczyć kilka obiektów. Przesuwaj je kursorem, zmieniaj rozmiar uchwytami albo wpisz dokładne położenie X/Y i wymiary w polach.',
      'Ustaw kontur, wypełnienie, grubość linii/pędzla i rozmiar tekstu. Wielokąty wybierzesz z listy; symbole z rozwijanej biblioteki kategorii.',
      'Aby połączyć obiekty, wybierz linię lub strzałkę i przeciągnij ją od punktu styku jednej figury do punktu styku drugiej. Połączenie podąża za figurami.',
      'Włącz „Inteligentny rysunek”, aby skorygować odręczny kształt. Wybierz „Automatycznie rozpoznaj” albo konkretny symbol, do którego szkic ma zostać dopasowany.',
      'Ctrl+G grupuje zaznaczone obiekty, a Ctrl+Shift+G je rozgrupowuje. Ctrl+C/Ctrl+V kopiuje i wkleja, Ctrl+D duplikuje, Ctrl+Z/Ctrl+Y cofa i ponawia, Delete usuwa.',
      'Zaznacz „Przytnij SVG”, aby dopasować obszar grafiki do narysowanej treści. Kliknij „Zapisz grafikę”, aby dodać lub zaktualizować schemat w notatce.',
    ],
    tip: 'Edytor obsługuje też edycję tekstu po dwukrotnym kliknięciu pola tekstowego.',
    keywords: 'wektor rysunek diagram SVG figura kształt biblioteka pędzel auto korekta inteligentny punkt styku linia strzałka grupuj skala rozmiar przytnij',
  },
  {
    id: 'attachments',
    title: 'Załączniki',
    summary: 'Do notatki można dołączyć obrazy i pliki PDF, a obrazy wstawić także bezpośrednio do treści.',
    steps: [
      'Przewiń pod edytor do sekcji „Załączniki” i kliknij „Dodaj plik”. Możesz wybrać wiele obrazów lub plików PDF.',
      'Kliknij kafelek załącznika, aby otworzyć podgląd; przycisk „Pobierz” zapisuje kopię pliku.',
      'Usuń załącznik ikoną kosza przy jego kafelku. Obrazy są dostępne do użycia w treści notatki i w paczce eksportowej.',
    ],
    keywords: 'plik PDF obraz zdjęcie podgląd pobierz wstaw usuń',
  },
  {
    id: 'reviews',
    title: 'Powtórki i licznik czasu',
    summary: 'Sesja powtórki to zapisana kolejność notatek z licznikiem czasu całego spotkania i poszczególnych wpisów.',
    steps: [
      'Kliknij plus przy nagłówku „Powtórki” lub „Nowa powtórka”. Wybierz notatki z lewej listy; przenieś je na prawą listę, a następnie zapisz sesję.',
      'Otwórz sesję z lewego panelu. Kliknij aktywną notatkę, aby przypisywać jej mierzony czas; kliknij tytuł, aby otworzyć notatkę.',
      'Użyj „Odlicz czas”, „Wstrzymaj”, „Zakończ” i „Reset czasu” zgodnie z potrzebą. Podsumowanie pokazuje czas łączny oraz czas dla każdej notatki.',
      'Kliknij „Edytuj powtórkę”, aby zmienić nazwę i listę notatek. Przeciągnij uchwyt przy tytule albo użyj strzałek, aby zmienić kolejność.',
    ],
    keywords: 'sesja nauka timer stoper lista kolejność przeciąganie dodaj edytuj usuń notatki',
  },
  {
    id: 'ollama',
    title: 'Czat z lokalnym modelem Ollama',
    summary: 'Czat wysyła wiadomości do lokalnego serwera Ollama. Możesz dołączyć bieżącą notatkę lub wyszukiwać w bibliotece jako kontekście.',
    steps: [
      'Zainstaluj i uruchom Ollama oraz pobierz model. Otwórz czat ikoną dymku w górnym pasku, a potem ustaw adres serwera i model przyciskiem ustawień.',
      'Domyślny adres to http://localhost:11434. W ustawieniach możesz pobrać listę dostępnych modeli i zapisać wybrany model.',
      'Wpisz pytanie w panelu czatu i naciśnij Enter; Shift+Enter dodaje nowy wiersz. Odpowiedź pojawia się strumieniowo.',
      'Zaznacz „Bieżąca notatka, SVG i załączniki”, aby dołączyć otwarty wpis. „Szukaj w bibliotece” dobiera notatki pasujące do pytania i dołącza ich materiały.',
      'Do modelu trafia maksymalnie 50 notatek, 48 000 znaków i 20 obrazów lub stron PDF w jednej wiadomości. Przy dużej bibliotece odpowiedź może pominąć niezałączony materiał.',
      'Analiza grafiki wymaga modelu obsługującego obrazy/wizję. Schematy SVG, obrazy z załączników i strony PDF są przekazywane jako obrazy; z długiego PDF-a dołącza się najwyżej 6 pierwszych stron.',
      'Ikona kosza czyści rozmowę; ustawienia i przycisk zamknięcia są w nagłówku panelu.',
    ],
    tip: 'Kontekst biblioteki dobiera notatki do pytania. Zawsze sprawdź, czy odpowiedź opiera się na trafnych źródłach, zwłaszcza przy dużej bibliotece.',
    keywords: 'AI asystent LLM chat lokalny wizja obraz stream strumieniowanie model URL context kontekst Ollama',
  },
  {
    id: 'history-transfer',
    title: 'Historia zmian, import i eksport',
    summary: 'Historia pozwala przywrócić wcześniejszą wersję notatki, a paczka ZIP przenieść bibliotekę lub utworzyć kopię zapasową.',
    steps: [
      'Kliknij ikonę historii w górnym pasku, aby zobaczyć zapisane wersje bieżącej notatki i przywrócić jedną z nich.',
      'Historia obejmuje również załączniki dodane po aktualizacji aplikacji; możesz przywrócić ich wcześniejszy zestaw wraz z treścią notatki. Wersje sprzed aktualizacji mogą nie zawierać informacji o załącznikach.',
      'Ctrl+Z cofa, a Ctrl+Y ponawia ostatnie zmiany podczas edycji notatki lub schematu SVG.',
      'Kliknij „Eksportuj” i wybierz miejsce zapisu, aby utworzyć paczkę ZIP z notatkami, schematami, załącznikami oraz historią wersji i usuniętych plików.',
      'Paczka zawiera też sesje powtórek, zapisane widoki, własne szablony i kolory folderów, aby przenieść ustawienia pracy na inne urządzenie.',
      'Kliknij ikonę importu obok eksportu i wskaż paczkę ZIP. Po imporcie notatki są dostępne w bibliotece.',
    ],
    keywords: 'historia wersja przywróć kopia zapasowa przenieś urządzenie ZIP eksport import undo redo',
  },
  {
    id: 'shortcuts',
    title: 'Skróty klawiaturowe',
    summary: 'Najważniejsze skróty ułatwiają wyszukiwanie, edycję i pracę na schematach.',
    steps: [
      'Ctrl+K / ⌘K — szybkie wyszukiwanie notatek.',
      'Ctrl+Z / ⌘Z — cofnij ostatnią zmianę; Ctrl+Y / ⌘Y — ponów cofniętą zmianę.',
      'W edytorze SVG: Ctrl+C/Ctrl+V — kopiuj/wklej; Ctrl+D — duplikuj; Delete — usuń; Ctrl+G — grupuj; Ctrl+Shift+G — rozgrupuj.',
      'W edytorze SVG: przytrzymaj Ctrl podczas rysowania, aby po zakończeniu pozostawić wybrane narzędzie aktywne.',
    ],
    keywords: 'keyboard klawiatura skrót Ctrl Command meta mac',
  },
]

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState(helpSections[0].id)

  const visibleSections = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pl')
    if (!normalizedQuery) return helpSections
    return helpSections.filter(section => [section.title, section.summary, section.keywords, section.tip, ...section.steps]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('pl')
      .includes(normalizedQuery))
  }, [query])

  useEffect(() => {
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', dismissOnEscape)
    return () => document.removeEventListener('keydown', dismissOnEscape)
  }, [onClose])

  const activeSectionId = visibleSections.some(section => section.id === activeId) ? activeId : visibleSections[0]?.id ?? ''
  const activeSection = visibleSections.find(section => section.id === activeSectionId)

  return <div className="modal-backdrop help-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-dialog-title">
      <header className="help-header">
        <div className="help-brand-mark"><BookOpen size={20} /></div>
        <div className="help-heading"><p className="eyebrow">CENTRUM POMOCY</p><h2 id="help-dialog-title">Instrukcja obsługi</h2><span>Opis funkcji i krótkie wskazówki krok po kroku.</span></div>
        <button type="button" className="icon-button" aria-label="Zamknij instrukcję" onClick={onClose}><X size={18} /></button>
      </header>
      <label className="help-search"><Search size={16} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Szukaj funkcji, np. tabela, SVG, eksport…" aria-label="Szukaj w instrukcji" /><kbd>{visibleSections.length} sekcji</kbd></label>
      <div className="help-content">
        <nav className="help-navigation" aria-label="Tematy instrukcji">
          {visibleSections.map(section => <button type="button" key={section.id} className={activeSectionId === section.id ? 'active' : ''} onClick={() => setActiveId(section.id)} aria-current={activeSectionId === section.id ? 'location' : undefined}><span>{section.title}</span><ChevronRight size={14} /></button>)}
          {!visibleSections.length && <div className="help-no-results"><CircleHelp size={19} /><span>Nie znaleziono pasującej funkcji.</span></div>}
        </nav>
        <div className="help-article-wrap" aria-live="polite">
          {activeSection ? <article className="help-article" key={activeSection.id}>
            <p className="help-section-kicker"><CheckSquare2 size={14} />JAK KORZYSTAĆ</p>
            <h3>{activeSection.title}</h3>
            <p className="help-summary">{activeSection.summary}</p>
            <ol>{activeSection.steps.map((step, index) => <li key={index}><span className="help-step-number">{index + 1}</span><span>{step}</span></li>)}</ol>
            {activeSection.tip && <aside className="help-tip"><CircleHelp size={16} /><span>{activeSection.tip}</span></aside>}
          </article> : <div className="help-no-article"><Search size={22} /><strong>Brak wyników</strong><span>Spróbuj innego hasła, np. „notatki”, „powtórka” albo „Markdown”.</span></div>}
        </div>
      </div>
      <footer className="help-footer"><span><CircleHelp size={14} />Instrukcję otworzysz ponownie z przycisku pomocy w lewym dolnym rogu.</span><button type="button" className="button secondary" onClick={onClose}>Gotowe</button></footer>
    </section>
  </div>
}
