# No-Tie

Responsywna aplikacja PWA do lokalnego tworzenia notatek Markdown i prostych schematów SVG. Dane pozostają w pamięci przeglądarki; eksport i import paczki ZIP przenosi notatki razem z grafikami.

## Wymagania

- Node.js `^20.19.0` albo `>=22.12.0`.
- npm dostępny w `PATH`.

## Uruchomienie

```sh
npm_config_cache=/tmp/no-tie-npm-cache npm ci
npm run dev
```

Vite wypisze adres lokalnego serwera. Po zainstalowaniu aplikacji jej pliki są buforowane lokalnie przez service worker; notatki pozostają w IndexedDB. `npm run build` tworzy produkcyjny pakiet w `dist/`, a `npm run preview` uruchamia lokalny podgląd tego pakietu.

## Dane i eksport

Notatki są przechowywane lokalnie w IndexedDB. Nie są synchronizowane między urządzeniami. Przycisk **Eksportuj** tworzy archiwum ZIP z plikami Markdown i osobnymi grafikami SVG; import archiwum scala wpisy po ich identyfikatorach.

## Licencje

Interfejs i główne zależności używają licencji open source dopuszczających wykorzystanie komercyjne. Przed publikacją należy dołączyć wymagane informacje o licencjach zależności.
