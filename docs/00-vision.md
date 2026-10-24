# praTexEditOR: wizja (po Q&A, 2026-10-23)

## Jednym zdaniem
Lokalny Overleaf na laptopa: otwieram projekt, po lewej mam pliki, w środku piszę LaTeX, a po prawej
PDF odświeża się sam, bez mrugania. Klik w PDF przenosi do kodu, a ⌘+klik w kodzie przenosi do PDF.

## Filary
1. **Szybkość i mało zasobów.** Sam Rust + webview, bez Pythona. Kompilacja w tle, PDF renderowany
   tylko tam, gdzie patrzę, zero pętli w tle. Bezczynna aplikacja ma zużywać ~0 % CPU.
2. **Intuicyjnie, obrazkowo.** Piktogramy zamiast tekstu, objaśnienia w tooltipach, przeciągnij i upuść
   wszędzie, gdzie ma to sens (pliki, obrazy, zrzuty ekranu).
3. **Projekty jak workspace'y w praSzczur.** Projekt to nazwa, dowolne podpięte foldery, plik główny
   i własne ustawienia UI.
4. **Ergonomia VS Code.** Snippety z tab-stopami, paleta komend, quick-open, własne skróty
   nagrywane w Ustawieniach.
5. **Wygląd praSzczur.** Ciemny motyw, akcent `#ffc951`, JetBrains Mono.
6. **Build na macOS, Windows i Linux** przez GitHub Actions, jak w praTRD.

## Czego NIE robimy
- Żadnego AI, nigdy.
- Sprawdzania pisowni.
- Współpracy w czasie rzeczywistym ani chmury (to narzędzie jednej osoby).

Szczegóły: `01-qa.md`, plan: `02-plan.md`, UX ekran po ekranie: `03-ux.md`.
