# 200 ręcznych testów funkcjonalnych No-Tie

Zestaw obejmuje przepływy łączące moduły i przypadki brzegowe. Wykonuj go na testowym profilu lub kopii danych; część prób tworzy albo usuwa treści. Dla przypadków zależnych od integracji użyj skonfigurowanej instancji Ollama/Tauri. Widoki responsywne sprawdzaj co najmniej przy szerokości 1440 px i 820 px.

## 1. Notatki i zapis

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T001 | Utwórz pustą notatkę, wpisz tytuł i treść, odczekaj na autosave, otwórz ją ponownie. | Tytuł i treść pozostają zapisane. |
| T002 | Edytuj jednocześnie tytuł, folder i tagi, a następnie przejdź do innej notatki. | Wszystkie trzy zmiany zapisują się w tej samej notatce. |
| T003 | Wpisz nagłówki, listę zagnieżdżoną, blok kodu, cytat i tabelę. | Widok wizualny renderuje każdy element, a struktura pozostaje poprawna. |
| T004 | Przełącz notatkę z widoku wizualnego na Markdown i z powrotem. | Treść i formatowanie nie znikają ani nie dublują się. |
| T005 | Zmień tekst w trybie Markdown, od razu przejdź do widoku wizualnego i zapisz. | Widok wizualny pokazuje najnowszą treść. |
| T006 | Wpisz polskie znaki, emoji, apostrofy, nawiasy kwadratowe i znaki `#`/`<`. | Tekst zapisuje się bez błędnego parsowania lub utraty znaków. |
| T007 | Wklej do treści bardzo długi akapit (co najmniej 50 tys. znaków), zapisz i ponownie otwórz notatkę. | Aplikacja pozostaje responsywna, a zapisany tekst jest kompletny. |
| T008 | Wyczyść treść istniejącej notatki, pozostaw tytuł i przejdź do innego widoku. | Notatka pozostaje na liście jako pusta; aplikacja nie usuwa jej przypadkiem. |
| T009 | Szybko wpisz kilka zmian i natychmiast zamknij notatkę. | Po powrocie widoczna jest ostatnia zmiana, a stan zapisu nie zgłasza sukcesu przed zapisem. |
| T010 | Utwórz dwie notatki o identycznym tytule, ale różnych folderach i treściach. | Obie mają odrębne identyfikatory; otwarcie, edycja i linkowanie wybierają właściwą. |

## 2. Wszystkie notatki, wyszukiwanie i sortowanie

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T011 | W widoku „Wszystkie notatki” wyszukaj unikalny fragment tytułu. | Zostają tylko pasujące notatki, a otwarcie wyniku prowadzi do właściwej. |
| T012 | Wyszukaj słowo występujące wyłącznie w treści notatki. | Notatka znajduje się bez dopisywania słowa do tytułu lub tagów. |
| T013 | Połącz zapytanie, tag i folder, z których każdy osobno zwraca wyniki. | Wynik spełnia jednocześnie wszystkie aktywne kryteria. |
| T014 | Włącz filtr ulubionych, a następnie wpisz zapytanie pasujące do jednej ulubionej notatki. | Pozostają tylko ulubione pasujące do zapytania. |
| T015 | Włącz filtr notatek z załącznikami i sprawdź notatkę z plikiem oraz bez pliku. | Pokazywana jest wyłącznie notatka zawierająca załącznik. |
| T016 | Sortuj po czasie edycji rosnąco i malejąco; edytuj jedną notatkę między próbami. | Kolejność zmienia się zgodnie z nowym czasem edycji. |
| T017 | Ustaw własną kolejność i przesuń kartę przyciskami kolejności, a następnie przeciągnij ją. | Oba sposoby dają tę samą kolejność i zapisują ją po ponownym otwarciu. |
| T018 | Włącz filtr ulubionych, sortowanie po edycji i filtr folderu, po czym usuń jeden filtr. | Pozostałe filtry nadal działają, a karta odświeża się bez resetu ustawień. |
| T019 | Otwórz folder przez klikalny breadcrumb w widoku wszystkich notatek, a potem kliknij segment nadrzędny. | Widok pokazuje wybrany folder i poprawnie wraca do folderu nadrzędnego. |
| T020 | Wpisz zapytanie bez wyników, wyczyść je i ponownie użyj sortowania. | Pojawia się czytelny pusty stan; wyczyszczenie przywraca wyniki i działające filtry. |

## 3. Foldery, tagi i kolekcje

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T021 | Utwórz folder zagnieżdżony, utwórz w nim notatkę i otwórz ją z listy plików. | Notatka trafia do pełnej ścieżki folderu i otwiera się poprawnie. |
| T022 | Przenieś notatkę między folderami, gdy ma tag, jest ulubiona i znajduje się w kolekcji. | Zmienia się folder; tag, ulubienie i członkostwo kolekcji pozostają. |
| T023 | Ustaw własny kolor folderu i sprawdź go w panelu folderów oraz na karcie notatki. | Kolor jest spójny, a obrys folderu nie pojawia się po obu stronach elementu. |
| T024 | Zwiń i rozwiń folder zawierający podfoldery oraz kilka notatek. | Widoczność zawartości zmienia się bez przenoszenia ani ukrywania danych. |
| T025 | Zwiń folder, przejdź do innego widoku i wróć. | Zapamiętany stan zwinięcia jest poprawny i nie zmienia kolejności wpisów. |
| T026 | Dodaj do notatki kilka tagów, usuń jeden i wyszukaj pozostały. | Zmiany tagów zapisują się; wyszukiwanie znajduje notatkę po aktualnym tagu. |
| T027 | Utwórz kolekcję i dodaj do niej notatki z dwóch różnych folderów. | Kolekcja zawiera obie notatki bez zmiany ich położenia w folderach. |
| T028 | Usuń notatkę należącą do kolekcji, przywróć ją z kosza i otwórz kolekcję. | Członkostwo jest obsłużone spójnie; przywrócona notatka nie tworzy duplikatu wpisu. |
| T029 | Utwórz pustą kolekcję, zmień jej nazwę, a następnie usuń ją. | Każda czynność aktualizuje listę i pusty stan; notatki pozostają nietknięte. |
| T030 | Dodaj do kolekcji notatkę, zmień jej folder i ponownie otwórz kolekcję. | Kolekcja nadal wskazuje tę samą notatkę niezależnie od folderu. |

## 4. Edytor Markdown i narzędzia pisania

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T031 | Dodaj nagłówki H1–H3, otwórz spis treści i wybierz środkowy nagłówek. | Spis pokazuje właściwą hierarchię i przewija do celu. |
| T032 | Użyj „Znajdź i zamień” dla tekstu występującego wielokrotnie. | Każde zatwierdzone zastąpienie trafia do poprawnego zakresu i zapisuje się. |
| T033 | Wyszukaj tekst nieobecny w dokumencie, a potem zamknij panel wyszukiwania. | Aplikacja pokazuje zero trafień; treść notatki pozostaje bez zmian. |
| T034 | Zaznacz fragment, dodaj komentarz, zmień zdanie przed nim i wróć do komentarza. | Komentarz pozostaje powiązany z właściwym fragmentem lub jasno sygnalizuje utratę zakresu. |
| T035 | Otwórz panel skrótów, wykonaj skrót formatowania i cofnij go. | Skrót jest widoczny, działa w edytorze i można go odwrócić. |
| T036 | Wstaw tabelę, uzupełnij nagłówki i komórki, a następnie edytuj menu tabeli. | Tabela zachowuje liczbę wierszy, kolumn i treść komórek. |
| T037 | Zmień szerokość kolumn tabeli, zapisz notatkę i otwórz ją ponownie. | Szerokości zostają zachowane w widoku wizualnym i Markdown bez uszkodzenia treści. |
| T038 | Wstaw do tabeli bardzo długi tekst i zmień szerokość sąsiedniej kolumny. | Tekst zawija się lub przewija; kolumny nie nakładają się na siebie. |
| T039 | Wstaw osadzenie innej notatki, zmień jej tytuł i otwórz osadzenie. | Osadzenie pokazuje aktualny tytuł i otwiera właściwą notatkę. |
| T040 | Otwórz menu kontekstowe przy zaznaczeniu tekstu i wywołaj akcję, potem zmień fokus na inną notatkę. | Akcja dotyczy notatki z fokusem w chwili wywołania i nie modyfikuje poprzedniej. |

## 5. Szablony i tworzenie notatek

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T041 | Otwórz „Nowa notatka” z folderu zagnieżdżonego i wybierz inny szablon. | Folder początkowy i treść podglądu są właściwe przed utworzeniem. |
| T042 | Ustaw szablon jako domyślny dla folderu i rozpocznij ponownie tworzenie w tym folderze. | Domyślny szablon jest wstępnie wybrany. |
| T043 | Zmień szablon w formularzu i sprawdź jego nazwę, tagi oraz całą treść podglądu. | Wszystkie metadane i pełna treść odpowiadają wybranemu szablonowi. |
| T044 | Przełącz podgląd szablonu między widokiem podstawowym i Markdown. | Oba tryby pokazują tę samą treść, a Markdown zachowuje surowe znaczniki. |
| T045 | Otwórz długi szablon, przewiń podgląd do końca i użyj dolnego przycisku. | Treść jest dostępna do końca, a przyciski anulowania i utworzenia pozostają osiągalne. |
| T046 | Rozpocznij tworzenie notatki, wybierz szablon, po czym anuluj. | Nowa notatka nie pojawia się na liście ani w folderze. |
| T047 | Utwórz notatkę z szablonu oznaczonego tagami. | Notatka otrzymuje treść i tagi przewidziane przez szablon. |
| T048 | Ustaw domyślny szablon folderu, zmień folder na taki bez domyślnego szablonu i wróć. | Wybór aktualizuje się zgodnie z folderem; nie stosuje poprzedniego szablonu omyłkowo. |
| T049 | Otwórz widok szablonów, dodaj nowy szablon i zapisz go bez treści. | Walidacja blokuje niekompletny zapis i wyraźnie wskazuje wymagane pola. |
| T050 | W widoku szablonów zmień treść w Markdown, potem w widoku podstawowym i zapisz. | Oba tryby są zsynchronizowane, a zapisany szablon można ponownie wybrać. |

## 6. Załączniki i pliki

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T051 | Dodaj do notatki jednocześnie obraz, PDF i plik tekstowy. | Każdy załącznik jest widoczny z poprawną nazwą i można go otworzyć. |
| T052 | Otwórz obraz, zamknij podgląd i ponownie otwórz go z globalnej listy załączników. | Obie ścieżki pokazują ten sam obraz i wskazują jego notatkę źródłową. |
| T053 | Otwórz wielostronicowy PDF, przejdź do ostatniej strony i wróć na pierwszą. | Numer strony, render i nawigacja są poprawne na obu granicach dokumentu. |
| T054 | Dodaj adnotację i zaznaczenie cytatu na stronie PDF, zapisz i otwórz ponownie. | Adnotacje pozostają przy właściwej stronie i nie zasłaniają nawigacji. |
| T055 | Uruchom OCR załącznika, zapisz rozpoznany tekst i wyszukaj jego unikalną frazę. | Tekst OCR zostaje zapisany i jest znajdowany bez zmiany oryginalnego pliku. |
| T056 | Dodaj plik audio, uruchom transkrypcję i wstaw wynik do treści notatki. | Transkrypcja trafia do edytora; załącznik nadal pozostaje do odsłuchu. |
| T057 | Wstaw do treści link do załącznika, usuń załącznik i kliknij link. | Nie powstaje awaria; aplikacja informuje, że plik został usunięty lub jest niedostępny. |
| T058 | Otwórz globalny widok załączników, filtruj po typie i otwórz znaleziony plik. | Filtr ogranicza wyniki, a otwarcie prowadzi do załącznika i notatki źródłowej. |
| T059 | Dodaj SVG jako schemat, otwórz edytor, zmień kształt i zapisz. | Załącznik zostaje zaktualizowany, a podgląd w notatce pokazuje nową wersję. |
| T060 | Otwórz widok załączników przy braku plików i przy filtrze bez wyników. | Puste stany są odróżnialne i nie sugerują, że istnieją ukryte pliki. |

## 7. Linki, osadzenia i mapa powiązań

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T061 | Wstaw link wiki do istniejącej notatki, kliknij go i wróć historią widoków. | Link otwiera właściwy cel, a historia wraca do notatki źródłowej. |
| T062 | Wstaw link do notatki o tytule podobnym do innej i rozstrzygnij wybór. | Aplikacja otwiera wskazaną notatkę, nie pierwszy przypadkowy wynik. |
| T063 | Wstaw link wiki do nieistniejącego tytułu i uruchom kontrolę powiązań. | Link jest zgłoszony jako nieprawidłowy i wskazuje notatkę źródłową. |
| T064 | Otwórz panel backlinks notatki, a potem wybierz notatkę odsyłającą. | Widoczne są poprawne źródła, a kliknięcie otwiera wybrane źródło. |
| T065 | Osadź notatkę, zmień jej treść i wróć do notatki zawierającej osadzenie. | Osadzenie pokazuje aktualną treść, bez tworzenia kopii niezależnej od źródła. |
| T066 | Utwórz cykl A→B→C→A i otwórz mapę powiązań. | Graf pokazuje trzy węzły i trzy relacje bez zapętlenia lub zawieszenia. |
| T067 | Usuń notatkę będącą celem linku i uruchom audyt linków. | Link staje się wykrywalnie nieprawidłowy; inne linki pozostają sprawne. |
| T068 | Filtruj mapę powiązań po folderze i tagu, a potem usuń jeden filtr. | Zbiór węzłów i połączeń reaguje na oba filtry niezależnie. |
| T069 | Otwórz mapę przy pustej bibliotece i przy bibliotece bez linków. | Oba przypadki mają poprawny, odróżnialny pusty stan. |
| T070 | Zmień tytuł notatki z linkami przychodzącymi i ponownie otwórz link. | Odwołania w innych notatkach aktualizują się, a stare tytuły pozostają dostępne jako aliasy. |

## 8. Zadania, terminy i zależności

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T071 | Dodaj zadanie przez formularz, wybierając notatkę, termin i priorytet. | Zadanie pojawia się na liście i przy właściwej notatce. |
| T072 | Oznacz zadanie w Markdown jako wykonane, po czym otwórz zarządzanie zadaniami. | Stan ukończenia jest zgodny w obu widokach. |
| T073 | Zmień w menedżerze status, termin i priorytet, przejdź do notatki i wróć. | Metadane zadania zachowują nowe wartości. |
| T074 | Utwórz zadanie powtarzalne i ukończ bieżące wystąpienie. | Aplikacja wyznacza kolejne wystąpienie zgodnie z regułą i nie gubi poprzedniego. |
| T075 | Ustaw zależność od nieukończonego zadania i spróbuj uruchomić pomiar czasu. | Pomiar jest zablokowany z opisem przeszkody; po ukończeniu zależności można go włączyć. |
| T076 | Uruchom i zatrzymaj timer zadania dwa razy. | Czas rzeczywisty sumuje oba odcinki i nie nalicza czasu po zatrzymaniu. |
| T077 | Powiąż zadanie z drugą notatką i załącznikiem, a następnie otwórz oba linki. | Każdy link prowadzi do właściwego celu. |
| T078 | Ustaw przypomnienie, odłóż je o 10 minut, a potem zmień na jutro. | Termin przypomnienia aktualizuje się po każdej akcji i jest widoczny po ponownym otwarciu. |
| T079 | Zmień status zadania w widoku Kanban, przejdź do listy i z powrotem. | Karta trafia do właściwej kolumny, a licznik kolumn jest aktualny. |
| T080 | Otwórz kalendarz, tydzień i oś czasu dla zadań z datą, bez daty oraz przeterminowanych. | Widoki grupują te trzy przypadki poprawnie i umożliwiają otwarcie źródła zadania. |

## 9. Statusy notatek i pulpit projektów

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T081 | Przeciągnij kartę notatki ze stanu „Pomysły” do „W toku”. | Karta i metadane notatki przyjmują nowy stan. |
| T082 | Zmień stan notatki z listy rozwijanej na karcie, bez przeciągania. | Stan zmienia się identycznie jak po przeciągnięciu; kontrolka działa na tablecie. |
| T083 | Przenieś ostatnią kartę z kolumny i przeciągnij inną do pustej kolumny. | Pusty stan nadal stanowi poprawny cel upuszczenia. |
| T084 | Utwórz notatki w folderze głównym, podfolderze i innym folderze głównym. | Pulpit grupuje notatki zgodnie z regułą grupowania po folderze nadrzędnym. |
| T085 | Dodaj zadania do notatek w dwóch folderach i porównaj liczniki projektów. | Liczniki otwartych zadań przypisują zadania do właściwych projektów. |
| T086 | Ustaw przeterminowany termin zadania i otwórz oś czasu projektu. | Zadanie ma czytelne oznaczenie opóźnienia i prawidłową datę. |
| T087 | Oznacz część zadań jako kamienie milowe. | Licznik i oznaczenia kamieni milowych zgadzają się w pulpicie i osi czasu. |
| T088 | Otwórz pulpit przy notatce bez folderu oraz przy braku zadań. | Grupa „Bez folderu” i pusty stan są obsługiwane bez błędu. |
| T089 | Przenieś notatkę do innego folderu nadrzędnego i odśwież pulpit. | Notatka i jej zadania pojawiają się w nowej grupie bez duplikatu. |
| T090 | Otwórz notatkę bezpośrednio z karty projektu i z wpisu na osi czasu. | Oba wejścia otwierają tę samą notatkę powiązaną z zadaniem. |

## 10. Powtórki notatek

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T091 | Utwórz sesję powtórki z kilkoma notatkami i określ ich kolejność. | Sesja zapisuje wybrane notatki i kolejność. |
| T092 | Zmień kolejność notatek w sesji przeciąganiem i otwórz sesję ponownie. | Nowa kolejność jest zachowana. |
| T093 | Rozpocznij sesję, wstrzymaj ją, wznow i zakończ. | Czas i stan sesji uwzględniają tylko odcinki pracy, nie czas pauzy. |
| T094 | Zmień aktywną notatkę podczas sesji i przejdź na chwilę do innego widoku. | Punkt kontrolny pozwala wrócić do tej samej sesji i aktywnej notatki. |
| T095 | Uruchom sesję z jednym dokumentem i bez celu czasowego. | Sesja działa poprawnie, a brak celu nie powoduje błędu obliczeń. |
| T096 | Ustaw cel czasu krótszy niż rzeczywisty czas sesji. | Postęp może przekroczyć 100%, a czas pozostaje poprawny i czytelny. |
| T097 | Otwórz dwie zapisane sesje kolejno i zmień aktywną w każdej. | Postęp jednej sesji nie nadpisuje drugiej. |
| T098 | Zakończ sesję, a następnie uruchom ją ponownie z widoku przeglądu. | Sesja ma spójny stan zakończenia i można rozpocząć nową rundę. |
| T099 | Dodaj notatkę do sesji powtórkowej i sprawdź listę dostępnych notatek. | Wybrana notatka znika z listy dostępnych i nie można dodać jej drugi raz. |
| T100 | Usuń z biblioteki notatkę należącą do zapisanej sesji i otwórz tę sesję. | Brak notatki jest obsłużony czytelnie, a pozostałe wpisy nadal działają. |

## 11. Fiszki: tworzenie i typy odpowiedzi

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T101 | Utwórz ręcznie fiszkę z pytaniem, odpowiedzią, notatką źródłową i tagiem. | Karta zapisuje wszystkie pola i pokazuje źródło z pełną ścieżką. |
| T102 | Edytuj pytanie i odpowiedź istniejącej karty, zapisz i odśwież stronę. | Zmiany pozostają, a pozostałe metadane karty nie znikają. |
| T103 | Utwórz kartę „Warianty odpowiedzi”, wpisz dwa warianty i zaznacz właściwy. | Nie można zapisać bez poprawnej odpowiedzi; oznaczony wariant zachowuje się jako klucz. |
| T104 | Dodaj warianty odpowiedzi do limitu i spróbuj dodać kolejny; usuń poprawny wariant. | Limit jest egzekwowany, a wskaźnik poprawnej odpowiedzi nie wskazuje błędnego indeksu. |
| T105 | Utwórz kartę „Prawda / fałsz”, ustaw odpowiedź „Fałsz” i rozpocznij sesję. | Formularz nie wymaga pola tekstowej odpowiedzi; w sesji można wybrać prawdę lub fałsz. |
| T106 | Utwórz kartę „Odpowiedź opisowa” i odpowiedz synonimem odpowiedzi docelowej. | Ocena uwzględnia sens odpowiedzi, a po porównaniu pokazuje odpowiedź wzorcową. |
| T107 | W trybie opisowym wpisz odpowiedź pustą, a potem niezwiązaną z pytaniem. | Pusta odpowiedź nie przechodzi; niezwiązana nie jest oceniona jako poprawna. |
| T108 | Rozpocznij sesję „Odpowiedź na czas”, odpowiedz przed limitem i po jego upływie. | Timer startuje i kończy się przewidywalnie; stan odpowiedzi jest zapisany raz. |
| T109 | Utwórz fiszkę typu uzupełnianie luk bez luki, a potem z dwiema lukami. | Pierwsza wersja jest blokowana; druga pokazuje obie odpowiedzi w sesji. |
| T110 | Utwórz kartę z zakryciem obrazu lub sekwencją dwóch elementów i przećwicz ją. | Obszary/elementy są edytowalne i można je rozwiązać w sesji. |

## 12. Zakres nauki, talie i źródła fiszek

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T111 | Wybierz notatkę jako źródło w widoku „Zakres i talie”. | Fiszki tej notatki wchodzą do zakresu, a karty innych źródeł pozostają poza nim. |
| T112 | Odznacz notatkę w źródłach i zaznacz ją ponownie. | Jej fiszki wracają do puli; nie zostają usunięte z danych. |
| T113 | Włącz opcję fiszek bez notatki, a potem ją wyłącz. | Beznotatkowe karty pojawiają się i znikają z zakresu niezależnie od kart powiązanych. |
| T114 | Wyłącz jedną notatkę w zakresie i otwórz zakładkę „Karty”. | Widok „Karty” nadal pokazuje wszystkie karty w bibliotece. |
| T115 | Utwórz talię z kartami z dwóch folderów i wybierz ją do nauki. | Sesja zawiera tylko karty tej talii, niezależnie od ich folderów. |
| T116 | Utwórz talię z ręcznie zaznaczonych kart, zmień wybór i zapisz ponownie. | Talia zawiera dokładnie aktualnie zaznaczone karty. |
| T117 | Utwórz talię dynamiczną po tagu, typie i źródle, zmień jeden warunek. | Członkostwo kart przelicza się według nowych reguł bez usuwania kart. |
| T118 | W regule dynamicznej włącz „Tylko do powtórki”, a potem zmień datę karty. | Talia uwzględnia lub wyklucza kartę zgodnie z terminem nauki. |
| T119 | Utwórz pustą talię i otwórz sesję, postępy oraz planowanie. | Interfejs wyjaśnia brak kart i nie uruchamia pustej sesji. |
| T120 | Otwórz fiszkę w widoku kart z notatki o podobnej nazwie do innej. | Widoczna pełna ścieżka źródła jednoznacznie wskazuje właściwą notatkę. |

## 13. Nauka, paginacja i postępy fiszek

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T121 | Uruchom naukę osobno w pięciu trybach odpowiedzi. | Każdy tryb używa właściwego formularza i sprawdza odpowiedź zgodnie z typem. |
| T122 | Ustaw liczbę sesji większą niż liczba dostępnych kart. | Sesja ogranicza się do dostępnej liczby, a licznik zgadza się z pulą. |
| T123 | Wybierz „Tylko do powtórki”, „Wszystkie karty” i „Słabe karty”. | Każdy zakres tworzy odpowiedni zbiór; karty wstrzymane są traktowane zgodnie z ustawieniem. |
| T124 | Oceniaj kartę jako trudną, dobrą i łatwą, a następnie sprawdź termin powtórki. | Oceny aktualizują harmonogram i licznik kart do powtórki. |
| T125 | Włącz sesję na czas, ustaw limit minimalny i ukończ kilka odpowiedzi. | Zegar i zakończenie sesji odpowiadają wybranemu limitowi. |
| T126 | Ustaw limit dzienny na minimum, maksimum i wartość poza zakresem. | Wartość jest walidowana lub ograniczana do dozwolonego zakresu 1–200. |
| T127 | Zmień talię wybraną dla postępów, pozostawiając sesję nauki na innej talii. | Statystyki i planowanie dotyczą tylko talii wybranej w panelu postępów. |
| T128 | Ustaw dni nauki, datę egzaminu i przypomnienie w jednej talii; zmień drugą talię. | Ustawienia każdej talii pozostają niezależne. |
| T129 | W widoku kart ustaw rozmiar strony 10, 25, 50 i 100, przejdź na ostatnią stronę. | Paginacja pokazuje poprawną liczbę elementów i nie tworzy pustych stron poza zakresem. |
| T130 | Zmień rozmiar strony z ostatniej strony na mniejszy, a potem usuń kartę z bieżącej strony. | Numer strony koryguje się, a rekordy nie znikają poza filtrem. |

## 14. Generowanie fiszek AI i częściowe wyniki

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T131 | Wybierz krótką notatkę, zażądaj pięciu fiszek i uruchom generowanie. | Generator pokazuje rozpoczęcie, typ zadania, czas pracy i wynik. |
| T132 | Zażądaj kilkudziesięciu kart z krótkiej notatki, doprowadź do częściowego błędu odpowiedzi. | Wszystkie poprawnie wygenerowane karty są pokazane i można je zapisać. |
| T133 | Podaj liczbę kart równą 1, 0, wartość ujemną i bardzo dużą. | Nieprawidłowe wartości są blokowane lub normalizowane; aplikacja nie zawiesza generatora. |
| T134 | Wygeneruj karty przy włączonym strumieniowaniu i obserwuj wynik przed końcem całej pracy. | Każdy poprawny blok karty jest wyświetlany na bieżąco. |
| T135 | Zasymuluj odpowiedź z błędnym JSON-em, a następnie próbę jego naprawy. | Naprawa nie usuwa kart poprawnych; niepoprawny fragment jest zgłaszany czytelnie. |
| T136 | Wygeneruj pytanie z cudzysłowem, nową linią i nawiasem w treści. | Parsowanie JSON zachowuje znaki i nie łączy dwóch kart w jeden obiekt. |
| T137 | Wymuś brak jednego z pięciu wariantów odpowiedzi dla karty. | Błąd wskazuje brakujący wariant, a kompletne karty pozostają dostępne. |
| T138 | Generuj karty zawierające pytanie już obecne w puli. | Duplikat jest wykrywany; unikalne wyniki z tego samego zadania nie są tracone. |
| T139 | Uruchom generowanie z notatki zawierającej PDF, obraz i transkrypcję załącznika. | Kontekst zawiera dostępne treści załączników, a wyniki wskazują użyte źródło. |
| T140 | Zminimalizuj generator, przejdź do notatki, a po zakończeniu wróć do fiszek. | Powiadomienie i wynik pozostają dostępne; można rozwinąć je lub usunąć. |

## 15. Pozostałe narzędzia AI, kolejka i profile

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T141 | Wygeneruj fiszki z dodatkową instrukcją promptu i porównaj wynik z instrukcją. | Prompt użytkownika jest uwzględniony bez utraty ograniczeń formatu. |
| T142 | Wygeneruj po jednej karcie w każdym z pięciu trybów nauki. | Wyniki zawierają poprawne pola dla każdego trybu i możliwy wybór wariantu. |
| T143 | Wyłącz lub niedostępny model AI i uruchom generowanie. | Aplikacja pokazuje konkretny błąd, kończy stan „w toku” i zachowuje dotychczasowe dane. |
| T144 | Dodaj kilka zadań do kolejki, przestaw zadanie oczekujące i anuluj inne. | Zmienia się tylko kolejność oczekujących; zadanie wykonywane ma poprawny stan. |
| T145 | Rozpocznij pracę AI i przejdź między widokami podczas generowania. | Powiadomienie nie znika, czas nadal się aktualizuje, a wynik trafia do aplikacji. |
| T146 | W siatce notatek ustaw fokus na drugiej karcie i uruchom akcję AI z menu kontekstowego. | AI otrzymuje treść aktywnej notatki, nie pierwszej karty ani poprzedniego wyboru. |
| T147 | Uruchom „Sprawdź jakość AI” i „Pokrycie tematów” na zbiorze kart z lukami tematycznymi. | Raporty pokazują rozróżnialne wyniki, a krótkie tooltipy wyjaśniają zakres analizy. |
| T148 | Uruchom wykrywanie podobnych fiszek na kilku kartach oraz na jednej karcie. | Dla wielu kart wskazuje podobne pary; dla jednej pokazuje stan bez porównania. |
| T149 | Odpowiedz opisowo częściowo poprawnie i uruchom porównanie AI. | Ocena rozpoznaje poprawne elementy, wskazuje braki i nie ujawnia odpowiedzi przed sprawdzeniem. |
| T150 | Dodaj profil promptu i szablon wyniku, ustaw model zapasowy, po czym uruchom zadanie. | Zadanie używa wybranych ustawień; diagnostyka zapisuje typ, model, czas i błąd/sukces. |

## 16. Edytor SVG: narzędzia i edycja obiektów

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T151 | Narysuj prostokąt, elipsę i linię przez kliknięcie oraz przeciągnięcie. | Każdy obiekt ma poprawne położenie i uchwyty zaznaczenia. |
| T152 | Zaznacz obiekt, przesuń go, zmień rozmiar, obróć i zapisz SVG. | Transformacje są widoczne na planszy i w zapisanym pliku. |
| T153 | Narysuj krzywą ścieżkę, zakończ ją Enterem i edytuj jej punkty. | Ścieżka kończy się bez dodatkowego segmentu i zachowuje edycję węzłów. |
| T154 | Zaznacz wiele rozłącznych obiektów, a następnie użyj lassa przecinającego tylko część. | Zaznaczają się dokładnie obiekty spełniające tryb zaznaczania. |
| T155 | Grupuj kilka figur, zaznacz grupę, przesuń ją, rozgrupuj i edytuj jedną figurę. | Grupa przesuwa się razem, a po rozgrupowaniu elementy pozostają edytowalne. |
| T156 | Zmień kolejność warstw, ukryj jedną warstwę i zablokuj inną. | Widoczność i blokada działają niezależnie; ukryty/zablokowany obiekt nie daje się przypadkiem zmienić. |
| T157 | Wykonaj serię zmian, użyj Cofnij kilka razy, a potem Ponów. | Historia odtwarza zmiany w prawidłowej kolejności bez gubienia obiektów. |
| T158 | Skopiuj, wklej i zduplikuj zaznaczoną grupę zawierającą kilka elementów. | Powstaje niezależna kopia w przewidywalnym miejscu. |
| T159 | Przybliż i oddal planszę kółkiem z Ctrl, użyj dopasowania do widoku i przeciągnij planszę. | Zoom i przesuwanie nie zmieniają geometrii SVG. |
| T160 | Zaznacz obiekt dotykiem lub rysikiem na tablecie, przesuń uchwyt i zapisz. | Pointer działa bez przewijania strony i nie gubi zaznaczenia. |

## 17. Edytor SVG: styl, geometria, import i eksport

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T161 | Wybierz kształt z biblioteki w każdej kategorii i zmień jego rozmiar. | Kształt jest edytowalny i zachowuje kategorię/atrybuty po zapisie. |
| T162 | Zmień kontur, wypełnienie, przezroczystość i grubość linii zaznaczonej grupy. | Styl stosuje się do zaznaczenia bez zmiany geometrii. |
| T163 | Włącz siatkę, przyciąganie i przyciąganie do przecięć; potem wyłącz je. | Wspomaganie pozycjonowania działa tylko po włączeniu i nie trafia do eksportowanego SVG. |
| T164 | Dodaj prowadnicę, zablokuj ją, spróbuj ją przesunąć i usuń. | Zablokowana prowadnica nie zmienia pozycji; usunięcie działa. |
| T165 | Wyrównaj trzy obiekty i zastosuj równe odstępy poziome oraz pionowe. | Pozycje odpowiadają wspólnej krawędzi/odstępowi, a akcje są zablokowane dla zbyt małej liczby obiektów. |
| T166 | Zmień globalny kolor lub krój pisma w dokumencie, mając wiele obiektów. | Zmieniane są właściwe elementy, a inne kolory/fonty pozostają bez zmian. |
| T167 | Dodaj etykietę połączenia, punkt kontrolny i porównaj zapis z bieżącą wersją. | Etykieta, punkt i porównanie odnoszą się do właściwego obiektu/wpisu historii. |
| T168 | Zaimportuj poprawny SVG oraz plik zawierający skrypt lub niedozwolony element. | Poprawny plik jest edytowalny; niebezpieczna zawartość jest usuwana lub odrzucana. |
| T169 | Eksportuj SVG, otwórz go ponownie i porównaj geometrię, warstwy oraz tekst. | Eksport można ponownie zaimportować bez utraty istotnych obiektów. |
| T170 | Zmień wymiary dokumentu na małe, duże i graniczne wartości, używając proporcji. | Walidacja blokuje niepoprawne wymiary; proporcje są zachowane zgodnie z ustawieniem. |

## 18. Archiwa, kopie zapasowe, kosze i integralność danych

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T171 | Wyeksportuj paczkę zawierającą notatkę, tagi, załącznik i fiszkę. | Archiwum zawiera wszystkie zaznaczone elementy i kończy się komunikatem powodzenia. |
| T172 | Zaimportuj wyeksportowaną paczkę do pustego profilu. | Treść, relacje, tagi, fiszki i dostępne pliki odtwarzają się poprawnie. |
| T173 | Zaimportuj nieprawidłowy lub pusty plik archiwum. | Import zgłasza błąd i nie nadpisuje bieżącej biblioteki. |
| T174 | Importuj paczkę zawierającą identyfikator notatki już istniejący w bibliotece. | Konflikt jest obsłużony bez cichego nadpisania lub niekontrolowanego duplikowania. |
| T175 | Znajdź podobne notatki, wybierz notatkę główną i scal duplikat. | Treść i wybrane metadane zachowują się zgodnie z podglądem scalenia. |
| T176 | Utwórz kopię zapasową, pobierz ją i odtwórz w testowym profilu. | Kopia jest kompletna, możliwa do pobrania i przywraca dane. |
| T177 | Usuń notatkę, sprawdź kosz, a następnie przywróć ją. | Notatka wraca do biblioteki z treścią i załącznikami. |
| T178 | Usuń notatkę z powiązaną fiszką i przywróć oba elementy z odpowiednich koszy. | Relacja źródłowa wraca lub jest jasno oznaczona jako brakująca; nie powstaje duplikat. |
| T179 | Trwale usuń pojedynczy wpis i sprawdź pozostałe elementy kosza. | Usuwany jest tylko wskazany wpis po potwierdzeniu. |
| T180 | Opróżnij kosz zawierający kilka typów elementów, pozostawiając aktywne notatki. | Kosz jest pusty, a aktywna biblioteka nie zmienia się. |

## 19. Polecenia, obszary robocze i ustawienia aplikacji

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T181 | Otwórz paletę poleceń, wyszukaj tytuł notatki i wybierz wynik. | Paleta filtruje wyniki i otwiera wskazaną notatkę. |
| T182 | Nawiguj po palecie strzałkami i potwierdź Enterem. | Aktywna pozycja jest widoczna, a Enter uruchamia tylko ją. |
| T183 | Wyszukaj nieistniejące polecenie i zamknij paletę Escape. | Widoczny jest brak wyników; Escape zamyka paletę i przywraca fokus do aplikacji. |
| T184 | Zapisz układ z kilkoma notatkami w siatce i ukrytym panelem, a potem go zastosuj. | Aplikacja przywraca wybraną siatkę, notatki i widoczność paneli. |
| T185 | Usuń zapisany układ, gdy inny układ jest aktualnie aktywny. | Usunięty układ znika z listy; bieżący widok nie zmienia się samoczynnie. |
| T186 | Otwórz zarządzanie modułami, wyłącz jeden moduł i ponownie go włącz. | Nawigacja i dostępność modułu odpowiadają ustawieniu, a jego dane pozostają. |
| T187 | Ustaw blokadę PIN, zamknij aplikację, wpisz błędny PIN, a następnie poprawny. | Błędny PIN nie odblokowuje aplikacji; poprawny przywraca dostęp bez utraty stanu. |
| T188 | Przejdź historią widoków przez notatkę, wszystkie notatki i zadania. | Poprzedni/następny widok odtwarza kolejność bez zapętlenia lub błędnego breadcrumbu. |
| T189 | Zmień ustawienia AI, dodaj profil i zamknij okno, a następnie otwórz je ponownie. | Profil i preferencje są zachowane. |
| T190 | Zapisz ustawienia/ustawienia modułów, odśwież aplikację i sprawdź stan paneli. | Ustawienia utrwalone przez aplikację wracają po ponownym uruchomieniu. |

## 20. Responsywność, dostępność i przypadki graniczne

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T191 | Otwórz wszystkie główne strony przy szerokości 1440 px, w tym listę, zadania i załączniki. | Elementy nie nachodzą na siebie, a całe okno nie ma przypadkowego poziomego przewijania. |
| T192 | Otwórz zadania, Kanban, formularze i karty projektów przy szerokości 820 px. | Kontrolki mieszczą się w swoich kartach i dają się wygodnie aktywować dotykiem. |
| T193 | Otwórz edytor SVG w portrecie 768×1024 i krajobrazie 1024×768. | Pasek narzędzi, panel, płótno i stopka są osiągalne bez nachodzenia; płótno można przewijać. |
| T194 | W widoku nowej notatki zmień szerokość z 1440 do 820 i 700 px. | Ustawienia i podgląd układają się odpowiednio do szerokości, a przyciski pozostają dostępne. |
| T195 | Obsłuż klawiaturą edytor, pola filtrów, dialog i menu kart. | Fokus jest widoczny, kolejność tabulatora logiczna, a Enter/Spacja uruchamiają kontrolki. |
| T196 | Na tablecie zmień status notatki bez przeciągania; potem przeciągnij kartę, jeśli urządzenie obsługuje gest. | Co najmniej kontrolka statusu pozwala zmienić stan niezależnie od drag-and-drop. |
| T197 | Otwórz kilka dialogów po kolei i zamknij każdy Escape lub przyciskiem zamknięcia. | Dialogi nie pozostają na wierzchu, nie blokują kliknięć i zwracają fokus do poprzedniego widoku. |
| T198 | Rozłącz Ollama podczas pracy narzędzia AI, a następnie przywróć połączenie i ponów zadanie. | Błąd jest widoczny i kończy pracę; ponowienie działa bez duplikowania poprzedniego wyniku. |
| T199 | W Tauri i przeglądarce zmień notatkę, odśwież/uruchom ponownie i sprawdź załączone pliki. | Dane zapisują się w przewidzianej pamięci dla platformy i pozostają dostępne po restarcie. |
| T200 | W testowej bibliotece przygotuj co najmniej 1000 notatek i kilkaset fiszek, wyszukaj, filtruj i przejdź stronami. | Widoki odpowiadają bez zawieszenia; liczby, paginacja i wyniki są spójne po zmianie filtrów. |
