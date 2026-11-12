# No-Tie

No-Tie to aplikacja Tauri 2 do tworzenia notatek Markdown i prostych schematów SVG. Edytor pozwala przełączać widok wizualny i surowy tekst Markdown. W zainstalowanej aplikacji notatki są zwykłymi plikami na urządzeniu, a nie danymi IndexedDB przeglądarki.

## Wymagania

- Node.js `>=22.13.0` i npm.
- Rust 1.90 lub nowszy oraz Cargo.
- Biblioteki wymagane przez Tauri dla danego systemu. Na Linuksie zobacz [oficjalne wymagania Tauri](https://v2.tauri.app/start/prerequisites/).

## Uruchomienie aplikacji Tauri

```sh
npm install
npm run tauri:dev
```

Pakiet instalacyjny tworzy polecenie:

```sh
npm run tauri:build
```

Tauri 2 obsługuje aplikacje desktopowe, Androida i iOS. Budowanie na Androida lub iOS wymaga odpowiedniego SDK oraz konfiguracji platformy zgodnie z dokumentacją Tauri.

## Pliki notatek

Domyślnie No-Tie tworzy katalog `Dokumenty/No-Tie/Notatki`. Każda notatka ma własny katalog w podfolderze jej folderu. W środku znajduje się `notatka.md` z treścią i metadanymi YAML oraz podkatalog `assets` z osobnymi plikami SVG, na przykład:

```text
Dokumenty/No-Tie/Notatki/Osobiste/pomysl-<id>/
├── notatka.md
└── assets/
    └── schemat-1.svg
```

Można je przeglądać, kopiować i edytować innymi programami. Eksport i import ZIP przenosi zestaw notatek pomiędzy urządzeniami; automatyczna synchronizacja nie jest włączona.

## Podgląd w przeglądarce

```sh
npm run dev
```

Podgląd Vite działa w zwykłej przeglądarce i używa IndexedDB jako trybu deweloperskiego. Do codziennego zapisu w katalogach i plikach uruchamiaj wersję Tauri.

## Licencje

Interfejs i główne zależności używają licencji open source dopuszczających wykorzystanie komercyjne. Przed dystrybucją należy dołączyć wymagane informacje o licencjach zależności.
