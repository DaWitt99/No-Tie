# Testy Playwright

Uruchomienie testów end-to-end:

```sh
npx playwright install chromium
npm run test:e2e
```

Na świeżym Linuksie, jeśli brakuje bibliotek przeglądarki, można doinstalować je poleceniem `npx playwright install --with-deps chromium`. Dostępne są też tryb z widoczną przeglądarką (`npm run test:e2e:headed`), interfejs Playwright (`npm run test:e2e:ui`) oraz sprawdzenie typów testów (`npm run test:e2e:types`).

Vite uruchamia się automatycznie na porcie 4173. Można wskazać działający już serwer przez `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173`; wtedy runner nie uruchomi własnego. Na Linuksie runner automatycznie wybiera systemowy Chromium z typowej ścieżki, jeśli jest dostępny; można też wskazać inną binarkę przez `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

Każdy test działa w osobnym kontekście przeglądarki z własną bazą IndexedDB i lokalnym magazynem. Aplikacja tworzy w nim przykładowe notatki, więc zmiany testowe nie modyfikują profilu użytkownika.

Obecny zestaw automatyzuje 30 stabilnych scenariuszy interfejsu, obejmujących bibliotekę, tworzenie i wyszukiwanie notatek, nawigację po modułach, podstawowe operacje na fiszkach oraz układ tabletu. Pełna lista 200 przypadków znajduje się w [`../functional-cases.md`](../functional-cases.md); przypadki zależne od Ollama, systemu plików Tauri, powiadomień systemowych lub rzeczywistych plików urządzenia pozostają do uruchamiania w odpowiednim środowisku.

GitHub Actions uruchamia sprawdzenie typów i testy przy każdym pushu oraz pull requeście. Przy błędzie zapisuje raport i materiały diagnostyczne jako artefakt.
