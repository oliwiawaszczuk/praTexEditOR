# Design tokens (wyciągnięte z praSzczur)

W praSzczur kolory są wpisane na sztywno w każdym komponencie (np. `#ffc951` występuje 179 razy).
W praTexEditOR (jak w praTRD) te same wartości są **od początku** w zmiennych CSS w jednym miejscu:
`app/src/lib/ui/tokens.css`. Bazą jest `tokens.css` z praTRD.

## Kolory

| Token | Wartość | Użycie w praSzczur |
|---|---|---|
| `--bg-app` | `#333` | tło `body` |
| `--bg-boot` | `#222` | ekran startowy |
| `--bg-panel` | `#2a2a2a` | aktywna zakładka, content, pasek podzakładek |
| `--bg-panel-2` | `#262626` | panele drugiego planu |
| `--bg-deep` | `#1a1a1a` | inputy, płótna, karty (101 użyć) |
| `--bg-deepest` | `#111` | najgłębsze tła |
| `--accent` | `#ffc951` | akcent (żółty/złoty): aktywne zakładki, progress, focus |
| `--accent-a10..a50` | `rgba(255,201,81,.10/.15/.25/.3/.4/.5)` | tła/obwódki aktywnych elementów |
| `--text` | `#e0e0e0` | tekst podstawowy |
| `--text-strong` | `#f0f0f0` | nagłówki |
| `--text-dim-*` | `rgba(255,255,255,.6/.45/.35/.22)` | tekst drugorzędny → nieaktywny |
| `--line` | `rgba(255,255,255,.07–.12)` | obwódki, separatory |
| `--danger` | `#ff6b6b` | błędy |

Kolory typów plików w drzewie (świadomie **nie** w odcieniu akcentu, paleta gniazd z praSzczur):
`.tex` `#5b9bd5` · `.bib` `#b48ce0` · obraz `#7bc47f` · PDF `#f06292` · dane `#4db6ac` · inne `#90a4ae`.

## Edytor (motyw CodeMirror, tokeny `--syn-*`)

| Token | Wartość | Co |
|---|---|---|
| `--syn-command` | `#5b9bd5` | `\komenda` |
| `--syn-env` | `#b48ce0` | nazwa środowiska w `\begin{…}` |
| `--syn-math` | `#4db6ac` | treść matematyczna |
| `--syn-comment` | `--text-dim-3`, kursywa | `% komentarz` |
| `--syn-arg` | `--text` | argumenty `{…}` |
| `--syn-section` | `--accent`, 600 | tytuły `\section{…}` (orientacja w tekście) |
| `--syn-key` | `#f2994a` | klucze `\label`/`\ref`/`\cite`, pakiety |
| `--syn-path` | `#7bc47f` | ścieżki `\input`/`\includegraphics`, URL-e |
| `--syn-verbatim` | `--text-dim-1` | `verbatim`, `\verb` |
| `--syn-bracket-match` | `--accent-a25` | dopasowany nawias |
| `--editor-match` | `accent .16` | wyniki szukania |
| `--diff-ins` / `--diff-del` (+ `-strong`) | zielony / czerwony `.13/.12` (`.3`) | porównanie z wersją z dysku |
| `--editor-bg` | `--bg-deep` | tło edytora |
| `--editor-line-active` | `--hover` | aktywna linia |
| `--editor-selection` | `--accent-a25` | zaznaczenie |

## PDF

| Token | Wartość | Co |
|---|---|---|
| `--pdf-bg` | `--bg-deepest` | tło kolumny między stronami |
| `--pdf-page-shadow` | `0 2px 12px rgba(0,0,0,.5)` | cień kartki |
| `--pdf-sync-flash` | `--accent-a40` | ramka SyncTeX |
| `--pdf-page` | `#fff` | kartka, zanim narysuje się strona |
| `--pdf-skeleton` / `--pdf-skeleton-shine` | `#ececec` / `#f8f8f8` | szkielet strony przy pierwszej kompilacji (połysk) |
| `--pdf-night-bg` / `--pdf-night-fg` | `--bg-deep` / `--text` | tryb „papier nocny” (`pageColors`) |

## Typografia

- Czcionka: **JetBrains Mono** (`@fontsource/jetbrains-mono` 400 + 600), wszędzie, także w inputach (`font-family: inherit`).
- Skala: zakładki `0.75rem / 600 / letter-spacing .05em`, podzakładki `0.66rem`, drobne etykiety `0.65–0.72rem`, tytuł boot `2rem / 700`.

## Kształty i ruch

- Zakładki: `border-radius: 8px 8px 0 0`, aktywna `box-shadow: 0 -2px 8px rgba(255,201,81,.1)`.
- Podzakładki: `border-radius: 6px`, aktywna = tło `accent .1` + obwódka `accent .3`.
- Przejścia `0.15s`, wejście layoutu `fadein .35s`, boot: logo z animacją `bouncespin` + `glow` w kolorze akcentu.
- Ciemny motyw jako jedyny (UI). PDF ma opcjonalny tryb ciemny (`02-plan.md` §5.4).
