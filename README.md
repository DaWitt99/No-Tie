# No-Tie

No-Tie to aplikacja Tauri 2 do tworzenia notatek Markdown i prostych schematów SVG. Edytor pozwala przełączać widok wizualny i surowy tekst Markdown. W zainstalowanej aplikacji notatki są zwykłymi plikami na urządzeniu, a nie danymi IndexedDB przeglądarki.

## Wymagania

- Node.js `^20.19.0` albo `>=22.12.0` i npm.
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

## Android ARM64 — poprawka odczytu plików

[Pobierz ZIP z APK dla Androida 15 / ARM64](https://github.com/DaWitt99/No-Tie/raw/refs/heads/installers/android-v0.1.0/installers/No-Tie-Android-0.1.0-arm64-api35-storage-fix.zip)

Paczka zawiera pełny APK No-Tie 0.1.0 (ARM64, `targetSdk 35`, `minSdk 24`). Podpis i identyfikator aplikacji są zgodne z poprzednią paczką, więc można zainstalować aktualizację bez odinstalowywania No-Tie. Poprawka nadaje aplikacji dostęp do jej własnego katalogu Dokumenty i pokazuje szczegół błędu, jeśli odczyt nadal się nie powiedzie.

SHA-256 ZIP: `c0cced561ef17f5b73a857779471a4cf2d1d250439e71d8214d9b1c841a9b8f9`
