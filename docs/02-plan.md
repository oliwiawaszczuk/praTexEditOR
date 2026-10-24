# praTexEditOR: plan aplikacji

Status: **ZATWIERDZONY** (2026-10-23). Decyzje źródłowe: `01-qa.md`. UX: `03-ux.md`.
Postęp: `CHANGELOG.md`.

> Korekty po E0: binarka Tectonic 0.17.0 ma 54 MB (nie ~25 MB), więc budżet bundla to < 60 MB
> (zip ok. 25 MB). Pierwsza kompilacja na świeżym systemie trwa ok. 1:40 (pobieranie), więc
> rozgrzewka w tle przy pierwszym starcie (§3.3). Na Linuksie bierzemy statyczną binarkę musl
> (bez systemowego ICU/HarfBuzz). Tectonic wymaga istniejącego `--outdir` (Rust go tworzy).
> Dane deweloperskie w osobnym folderze `….dev`, żeby `./dev.sh` nie mieszał danych wydania.
>
> Korekty po E1: konfiguracja projektu (foldery, plik główny, kolor) siedzi w `registry.json`,
> bez osobnego `project.json`; stan UI w `projects/<pid>/state.json`. Watcher na surowym `notify`
> z własnym łączeniem zdarzeń (crate'y-debouncery budzą wątek co ~40 ms także w spoczynku).
> Aktualizacja odwołań po zmianie nazwy/przeniesieniu → E6 (wymaga indeksu projektu).
> Kosz bez „Cofnij” (macOS nie pozwala programowo przywrócić z kosza) — cofanie jest dla
> przeniesień, kopii i zmian nazwy. Szablony wbudowane już w E1 (5 sztuk, wspólna preambuła
> działająca z XeTeX i pdfLaTeX); E7 dokłada własne szablony.
>
> Korekty po E2: `lang-tex` nie przeszedł próby (0.0.3 opiera się na `@codemirror/next` 0.13),
> `codemirror-lang-latex` ma licencję AGPL, a `stex` źle traktuje matematykę (polskie litery jako
> błąd, `equation`/`align` nierozpoznane). Gramatyka to własny tokenizer `StreamLanguage`
> w `editor/language.ts` (+ BibTeX). Linter z diagnostykami i F8 przechodzą do E3 (razem
> z parserem logu). Podgląd obrazu/PDF w środkowej kolumnie → E3 (protokół `pratex://`).
> Konflikt z dyskiem: porównanie to `unifiedMergeView` z `@codemirror/merge` (ładowany leniwie).

>
> Korekty po E3: Tectonic bez `--keep-intermediates` (aux/bbl/toc w pamięci, sam robi ponowne
> przebiegi i BibTeX) — w cache zostają tylko PDF, SyncTeX i log; `-Z continue-on-errors`, więc
> dokument z błędami też daje PDF (wtedy kod wyjścia 0, błędy tylko z logu). pdf.js jest już w 6.x
> (6.4.299): dokument zwalnia `loadingTask.destroy()`, jeden wspólny worker. PDF ładujemy w całości
> przez `pratex://` (`fetch` → `getDocument({data})`), bo podmieniany plik nie może się zmienić pod
> czytającym zakresy pdf.js; protokół i tak obsługuje Range. Opóźnienie auto-kompilacji 200 ms
> (autozapis już czeka 400 ms). Pomiar: 26 stron 0,41 s, zmiana → nowy PDF 0,58 s.
>
> Korekty po E4: indeks SyncTeX liczony leniwie, ale rozgrzewany w tle zaraz po kompilacji (175 stron:
> 22 ms). Ikona celownika = jednorazowe „pokaż kursor w PDF” (⌘J), „podążaj za kursorem” ma osobną
> ikonę (łańcuch). Dodatkowe kursory: ⌥+klik (⌘+klik zajęty przez SyncTeX).
>
> Korekty po E5: zamiast keymapy CodeMirror jeden dyspozytor klawiszy na oknie (capture) dla
> wszystkich kontekstów; nadpisania w `keybindings.json` jako mapa `id → klawisze` (import z VS Code
> tłumaczy znane komendy). Snippety użytkowniczki w `snippets.json` (`items` + `hidden`). `$…$` pod ⌘E
> (⌘M zajmuje „Minimalizuj” w macOS). Zapis wklejonego obrazu idzie surowymi bajtami (`InvokeBody::Raw`),
> nie przez JSON. `$CLIPBOARD` w snippetach na razie pusty (czytanie schowka w webview pyta o zgodę).

---

## 1. Architektura w skrócie

```
┌──────────────────────────────── Tauri v2 (Rust) ────────────────────────────────┐
│  core/      projekty (rejestr, ustawienia), ustawienia globalne, atomowy zapis   │
│  fs/        drzewo (leniwe), watcher (notify), operacje: nowy/zmień/przenieś/kosz │
│  build/     kolejka kompilacji, runner Tectonic | latexmk, parser logu            │
│  synctex/   parser .synctex.gz → indeks, zapytania kod↔PDF                        │
│  index/     indeks projektu: outline, \label, \cite, .bib, graf \input            │
│  protocol   pratex:// → PDF i obrazy strumieniowo (zakresy bajtów, bez base64)   │
│  boards/ notes/  Tablica i Notatki (globalne, jak w praSzczur)                    │
│ ┌──────────────────── WebView: SvelteKit 3 + Svelte 5 (TS) ─────────────────────┐ │
│ │  Start (projekty) │ Projekt: [Drzewo] [CodeMirror 6] [pdf.js] │ Tablica │       │ │
│ │  Notatki │ Ustawienia      + paleta komend, pływający notatnik, okno skrótów    │ │
│ └──────────────▲─────────────────────────────── invoke() + eventy Tauri ─────────┘ │
└────────────────┼──────────────────────────────────────────────────────────────────┘
                 │ spawn (proces potomny, pojedynczy na raz per projekt)
        tectonic (externalBin w bundlu)  |  latexmk z systemowego TeX Live (opcjonalnie)
```

**Zasada nr 1:** webview robi tylko UI. Pliki, kompilacja, parsowanie logów, SyncTeX i indeks
projektu są w Rust. Front dostaje gotowe, małe struktury (np. `Diagnostic[]`, `OutlineNode[]`),
nigdy surowy log ani cały plik `.synctex`.

**Zasada nr 2:** nic nie chodzi w tle bez powodu. Każda praca jest reakcją na zdarzenie (zapis,
zmiana pliku, przewinięcie). Nie ma pętli renderowania ani pollingu: watcher systemowy plus
`requestAnimationFrame` tylko na żądanie.

**Zasada nr 3:** foldery użytkownika zostają czyste. Pliki pomocnicze (`.aux`, `.log`,
`.synctex.gz`, PDF roboczy) trafiają do cache appki (`build/<pid>/`). Do folderu projektu
trafia tylko to, o co prosi użytkowniczka (np. „Eksportuj PDF obok pliku głównego”, opcja
„zawsze kopiuj PDF”).

---

## 2. Decyzja: sam Rust, bez sidecara Pythona

| Kryterium | Rust w Tauri | sidecar Python (jak praTRD) |
|---|---|---|
| Czego potrzebujemy | pliki, procesy, watcher, parsowanie tekstu | – (zero numeryki) |
| Start appki | < 0,5 s | +0,3 s (10–15 s przy pierwszym uruchomieniu zamrożonej binarki) |
| Rozmiar bundla | ~10 MB + Tectonic (~25 MB) | +60–150 MB PyInstaller |
| RAM w spoczynku | jeden proces Rust (kilka MB) | +40–80 MB interpretera |
| Komunikacja | `invoke` + eventy, typy przez serde | HTTP + port + watchdog |

Wniosek: Python nic tu nie daje, a kosztuje start, RAM i złożoność buildu. Z praTRD przejmujemy
wzorce, nie sidecar: `wsGet/wsSet`, `getSetting/setSetting`, debounce + flush przy zamknięciu,
`DialogHost`, tokeny, ikony i strukturę zakładek.

**Crate'y:** `tauri` 2, `tokio`, `serde`/`serde_json`, `notify` + `notify-debouncer-full`
(watcher), `ignore` (szybki spacer po drzewie z regułami), `trash` (kosz systemowy),
`flate2` (synctex.gz), `regex`/`memchr` (log, indeks), `biblatex` lub własny lekki parser `.bib`,
`tauri-plugin-dialog`, `tauri-plugin-clipboard-manager` (obraz ze schowka, jeśli zdarzenie
`paste` w webview go nie dostarczy). Przy każdej zależności przed E0 sprawdzić aktualną wersję.

---

## 3. Decyzja: kompilacja

**Domyślnie Tectonic, wbudowany w aplikację. Opcjonalnie per projekt systemowy `latexmk`.**

| | Tectonic (domyślny) | `latexmk` z TeX Live (opcja) |
|---|---|---|
| Instalacja | zero: binarka w bundlu (`externalBin`), pakiety dociągane przy 1. użyciu i trzymane w cache | wymaga TeX Live (BasicTeX nie wystarczy dla `polski`, `siunitx`…) |
| Silnik | XeTeX (Unicode, `fontspec`, polskie znaki bez `inputenc`) | pdfLaTeX / XeLaTeX / LuaLaTeX do wyboru |
| Bibliografia | BibTeX wbudowany; biber zewnętrzny (ryzyko wersji, §14) | biber / bibtex z dystrybucji |
| `minted`, `shell-escape` | brak (bezpiecznie) | tak, przełącznik per projekt |
| Kiedy wybrać | 95 % przypadków | gdy szablon uczelni wymaga pdfLaTeX albo `minted` |

Aktualna wersja Tectonic: 0.17.0 (sierpień 2026), projekt aktywnie rozwijany
([Alpine](https://pkgs.alpinelinux.org/package/v3.24/community/x86_64/tectonic),
[GitHub](https://github.com/tectonic-typesetting/tectonic/releases)). Wersję przypinamy w CI.

### 3.1 Przepływ kompilacji
1. Edycja → **autozapis** po 400 ms bezczynności (atomowo: `.tmp` → rename). Zapisane pliki
   mają nową wersję `rev`.
2. Zapis (lub zmiana pliku z zewnątrz, którą wykrył watcher) → `build::request(pid)`.
3. **Kolejka łącząca:** w danym momencie działa najwyżej jedna kompilacja per projekt. Jeśli
   przyjdzie zlecenie w trakcie, ustawia się flaga `dirty` i po zakończeniu rusza dokładnie
   jedna następna (nie zabijamy kompilacji, która zaraz się skończy). Opóźnienie startu po
   ostatnim zapisie: 600 ms (ustawienie), wyłączenie: przełącznik globalny + per projekt.
4. Runner: `tectonic -X compile <main> --outdir build/<pid> --keep-intermediates --keep-logs
   --synctex` (dokładne flagi zweryfikować na przypiętej wersji). Katalog roboczy = folder
   pliku głównego (ścieżki `\input` i `\includegraphics` działają jak przy ręcznej kompilacji).
   Pliki pośrednie zostają w `build/<pid>/`, więc następne przebiegi są szybsze (mniej reruns).
5. Wynik → event `build:done {pid, ok, pdfRev, diagnostics, durationMs}`. Front ładuje nowy PDF
   (§5.2). Błąd kompilacji **nie** zabiera ostatniego dobrego PDF; pokazuje go z czerwonym
   statusem.
6. Anulowanie: przycisk w pigułce statusu lub ⌘. (kill procesu + dzieci). Timeout: 120 s.

### 3.2 Parser logu (Rust)
- Wejście: `.log` (TeX zawija linie na 79 znakach, więc najpierw je sklejamy) + stdout runnera.
- Śledzenie stosu plików po nawiasach `(./plik.tex` … `)` → każdy komunikat dostaje plik i linię
  (`l.123`, `on input line 45`).
- Typy: błąd (`! …`), ostrzeżenie LaTeX / pakietu, overfull/underfull box (osobna kategoria,
  domyślnie ukryta), brakujący pakiet (Tectonic dociąga go sam, latexmk dostaje podpowiedź),
  niezdefiniowane `\ref`/`\cite`.
- Wyjście: `Diagnostic {severity, file, line, message, hint?}`; testy na prawdziwych logach
  w `tests/fixtures/logs/`.

### 3.3 Pierwsze uruchomienie Tectonic
Pierwsza kompilacja na świeżym komputerze pobiera format i pakiety (zmierzone w E0: **1:43**,
kolejna kompilacja **0,3 s**). Dlatego aplikacja przy pierwszym starcie robi w tle
**rozgrzewkę**: kompiluje wbudowany dokument (babel polish, amsmath, graphicx, hyperref…), a znacznik
`engine.json` zapamiętuje wersję silnika. W tym czasie w pasku zakładek pulsuje chip z chmurą
i licznikiem pobranych plików. Pakiety, których nie ma w rozgrzewce, dociąga pierwsza kompilacja
projektu („pobieranie pakietów” w pigułce statusu). Cache Tectonic leży w folderze cache systemu
(macOS: `~/Library/Caches/TectonicProject.Tectonic`). W Ustawieniach widać jego rozmiar
i jest przycisk „wyczyść” (E3).

---

## 4. Decyzja: edytor CodeMirror 6

| Kryterium | CodeMirror 6 | Monaco (VS Code) |
|---|---|---|
| Rozmiar | ~150–250 kB gz (tylko użyte moduły) | ~2–4 MB + workery |
| Start / RAM | szybki, modułowy | ciężki, zakłada workery i własny model |
| Duże pliki | widok wirtualny (renderuje tylko widoczne linie), parser przyrostowy | dobrze, ale drożej |
| Snippety z tab-stopami, wiele kursorów, zwijanie, szukaj/zamień | gotowe moduły | gotowe |
| Dostosowanie wyglądu do tokenów praSzczur | pełne (motyw = CSS) | ograniczone |
| Język LaTeX | `lang-tex` (Lezer, przyrostowy) lub `@codemirror/legacy-modes` `stex` | Monarch (regex) |

Wniosek: CodeMirror 6 jest lżejszy, szybszy i łatwiej go dopasować do UI. Ergonomię VS Code
odtwarzamy sami: snippety w formacie VS Code, paleta komend i skróty (§10).

- **Gramatyka:** w E2 krótka próba `lang-tex` ([npm](https://www.npmjs.com/package/lang-tex)).
  Kryteria: poprawne kolorowanie na 3 prawdziwych dokumentach, wydajność na pliku 10 tys. linii,
  aktywność repo. Jeśli nie przejdzie, bierzemy `stex` z `legacy-modes` (stabilny, prostszy).
  Gramatyka nie wycieka poza `editor/language.ts`.
- **Jeden `EditorState` na otwarty plik**, przełączanie kart przez `view.setState()`. Historia
  cofania, zaznaczenie i przewinięcie przeżywają zmianę karty, bez ponownego parsowania.
- **Zmiana pliku z zewnątrz:** jeśli w edytorze nie ma niezapisanych zmian, podmieniamy treść
  minimalnym diffem (kursor zostaje). Jeśli są, pokazujemy pasek konfliktu z ikonami „moja / ich /
  porównaj”.
- **Rozszerzenia:** numery linii, zwijanie (`\begin…\end`, sekcje), dopasowanie nawiasów,
  auto-pary (`{}`, `[]`, `$$`), auto-`\end{…}` po `\begin{…}`, szukaj/zamień z regexem,
  wiele kursorów, linter (diagnostyki z §3.2 jako znaczniki na marginesie), zawijanie miękkie
  (domyślnie włączone, bo to proza).

---

## 5. PDF: pdf.js z wirtualizacją

### 5.1 Ładowanie
- PDF serwuje własny protokół `pratex://pdf/<pid>?rev=<n>` z obsługą zakresów (Range). pdf.js
  pobiera tylko potrzebne fragmenty, bez base64 i bez kopiowania przez IPC.
- `pdfjs-dist` w aktualnej wersji 5.x (sprawdzić przy E3), worker jako osobny plik, a pliki
  CMaps/fontów standardowych lokalnie w bundlu.

### 5.2 Odświeżanie bez mrugania (ważniejsze niż w Overleaf)
- Nowy dokument ładujemy w tle, a renderujemy w nim **tylko strony widoczne + 1**. Dopiero gdy
  są gotowe, podmieniamy je w jednej klatce. Stary dokument zostaje do momentu podmiany.
- Pozycja zachowana jako (strona, przesunięcie w punktach PDF), nie w pikselach. Jeśli
  dokument urósł o stronę, widok nie skacze.
- (Optymalizacja w E8, jeśli pomiar pokaże potrzebę.) Strony, które nie zmieniły się między
  wersjami, nie są renderowane ponownie: Rust (`lopdf`) liczy hash strumieni treści każdej
  strony po kompilacji i podaje listę zmienionych. Bazowo odświeżamy tylko widoczne strony ±1,
  co i tak jest tanie.

### 5.3 Renderowanie
- Lista stron jest wirtualna: placeholdery o znanych wymiarach, canvas tylko dla widocznych
  stron ±1, a canvasy poza widokiem są zwalniane (pula). Limit pamięci canvasów to ustawienie.
- Zoom gestem / ⌘± : natychmiast skalujemy CSS, a ostry render robimy po 150 ms bezczynności.
  Rozdzielczość = `devicePixelRatio × zoom`, z limitem wielkości canvasu.
- Warstwa tekstu (zaznaczanie, szukanie ⌘F w PDF) tylko dla widocznych stron.
- Tryby: dopasuj szerokość / stronę / własny %, widok jednej strony lub ciągły.

### 5.4 Ciemny PDF (E8)
Dwa tryby do wyboru ikoną księżyca w pasku PDF:
- **„Papier nocny”** (domyślny): pdf.js `pageColors {background: --bg-deep, foreground:
  --text}`. Tekst i linie zmieniają kolor, obrazy zostają bez zmian. To najładniejsza opcja dla
  tekstu i wykresów z białym tłem (te zostają jasne).
- **„Odwróć”**: filtr CSS `invert(0.88) hue-rotate(180deg)` na canvasie. Działa dla wszystkiego
  i jest tańszy, ale odwraca też zdjęcia.
Tryb ciemny dotyczy tylko podglądu. Eksportowany PDF jest zawsze oryginalny.

---

## 6. SyncTeX (w obie strony)

- Rust parsuje `build/<pid>/<main>.synctex.gz` raz po każdej kompilacji (strumieniowo, `flate2`)
  i buduje dwa indeksy:
  - **kod → PDF:** `(plik, linia) → [ (strona, x, y, w, h) ]`,
  - **PDF → kod:** dla każdej strony lista prostokątów `hbox/vbox` z (plik, linia), posortowana
    do szybkiego wyszukiwania.
- Zapytania to komendy `synctex_forward(pid, file, line, col)` i `synctex_inverse(pid, page, x, y)`.
  Front nigdy nie dotyka pliku `.synctex`.
- **PDF → kod:** klik (lub ⌘+klik, do ustawienia) w PDF otwiera plik, przewija do linii
  i na 1 s podświetla ją akcentem.
- **Kod → PDF:** ⌘+klik w edytorze, ⌘J albo ikona celownika: przewija PDF i rysuje na nim
  pulsujący prostokąt (akcent, 1 s).
- **Opcjonalnie „podążaj za kursorem”** (przełącznik w pasku PDF): PDF przewija się za kursorem
  edytora, z throttlingiem do 1 zapytania na 150 ms.
- Ścieżki z Tectonic/latexmk są normalizowane (`./`, symlinki, wielkość liter na macOS),
  a test sprawdza projekt z `\input` w podfolderze.

---

## 7. Indeks projektu (Rust)

Lekki, przyrostowy skaner zamiast pełnego LSP (texlab to osobny proces i własny model; nie
potrzebujemy go).

- Dla każdego `.tex`: sekcje (`\part…\subsubsection`, `\chapter`, `\frametitle`) z linią,
  `\label`, `\input`/`\include`/`\subfile`, `\includegraphics`, `\bibliography`/`\addbibresource`,
  `\newcommand` (do podpowiedzi). Dla `.bib`: klucz, typ, autorzy, tytuł i rok.
- **Graf dołączeń** od pliku głównego, który daje outline całego dokumentu w kolejności
  wydruku, a nie plik po pliku.
- Aktualizacja: po zapisie pliku lub zdarzeniu watchera przeliczamy tylko ten plik (skan liniowy,
  pomijane komentarze i `verbatim`). Wynik trafia do eventu `index:changed {pid, files}`.
- Zastosowania (§UX): okruszki i ⌘⇧O (outline), podpowiedzi `\ref{` / `\cite{` / `\input{` /
  `\includegraphics{`, licznik słów (bez komend, w ramach `\begin{document}`), wykrywanie
  pliku głównego (`\documentclass` + `\begin{document}`).

---

## 8. Projekty i dane na dysku

```
<app data>/                         (~/Library/Application Support/com.praoliwia.praTexEditOR)
  app_settings.json                 ustawienia globalne (getSetting/setSetting)
  keybindings.json                  własne skróty (nadpisania domyślnych)
  snippets.json                     snippety użytkowniczki (format VS Code)
  projects/registry.json            [{id, name, color, roots, main, createdAt, openedAt}]
  projects/<pid>/state.json         stan UI i ustawienia projektu (wsGet/wsSet): rozwinięte foldery,
                                    kolumny, później karty, kursory, zoom PDF, silnik, imgDir
  projects/<pid>/thumb.png          miniatura 1. strony PDF (karta na ekranie startowym)
  notes/  boards/                   Notatki i Tablica, globalne (jak w praSzczur)
  templates/                        szablony nowego projektu (wbudowane + własne)
<app cache>/build/<pid>/            .aux .log .synctex.gz PDF roboczy (można usunąć w każdej chwili)
```

- **Projekt** = nazwa + kolor/ikona + **dowolna liczba podpiętych folderów (rootów)** + plik
  główny + ustawienia. Foldery zostają tam, gdzie są, a projekt tylko na nie wskazuje (jak
  multi-root workspace w VS Code).
- Brakujący root (np. odłączony dysk) widać w drzewie jako wyszarzony z ikoną ostrzeżenia
  i akcją „wskaż ponownie”.
- **Nowy projekt** (3 drogi, wszystkie obrazkowe): z szablonu (tworzy folder), z istniejącego
  folderu (wykrywa plik główny), z `.zip` (np. pobrany z Overleaf, rozpakowany do wskazanego
  miejsca).
- Eksport/import projektu: `.zip` z rootami + `project.json` (jak eksport workspace'u
  w praSzczur).
- Zapisy stanu: debounce 500 ms + flush przy zamknięciu okna (wzorzec `close-requested` z praTRD).

---

## 9. Pliki: drzewo, watcher, DnD

- **Leniwe drzewo:** Rust zwraca tylko zawartość rozwiniętych folderów. Front ma płaską,
  wirtualną listę (wydajną przy tysiącach plików). Ukryte domyślnie: `.git`, `node_modules`,
  `.DS_Store` i pliki pomocnicze TeX-a (lista w Ustawieniach).
- **Watcher** (`notify`, debounce 100 ms) na każdym roocie. Zmiany z zewnątrz aktualizują
  drzewo, indeks i otwarte karty, a jeśli dotyczą plików dokumentu, to też kompilację.
- **Operacje:** nowy plik / folder (inline w drzewie), zmiana nazwy (F2 / Enter), przeniesienie,
  duplikat, usuń **do kosza systemowego** (`trash`, więc da się cofnąć), „pokaż w Finderze”,
  „ustaw jako plik główny”, kopiuj ścieżkę względną.
- **Zmiana nazwy lub przeniesienie pliku `.tex`/obrazu** → propozycja aktualizacji odwołań
  (`\input`, `\includegraphics`) w projekcie, z podglądem liczby zmian. Bez tego łatwo zepsuć
  dokument.
- **DnD wewnątrz drzewa:** Pointer Events (nie HTML5 DnD, które jest niestabilne w webview,
  lekcja z praSzczur). Duszek z ikoną pliku, podświetlenie folderu docelowego,
  autorozwijanie folderu po 600 ms zawisu, ⌥ = kopiuj zamiast przenieś.
- **DnD z Findera:** `onDragDropEvent` Tauri daje ścieżki i pozycję. Upuszczenie na folder
  w drzewie kopiuje tam pliki, a upuszczenie na edytor kopiuje do folderu obrazów projektu
  i wstawia `\includegraphics` lub `figure` (§UX 6).
- Konflikt nazw → mini-dialog z ikonami: zastąp / zachowaj oba (`nazwa-2.png`) / pomiń.

---

## 10. Komendy, skróty, snippety

### 10.1 Rejestr komend (jedno źródło prawdy)
`commands.ts`: `{id: "editor.bold", title, icon, defaultKeys, when, run}`. Z tego rejestru
korzystają: paleta komend, pasek „Wstaw”, menu kontekstowe, tooltipy (pokazują aktualny skrót),
okno skrótów `?` i edytor skrótów w Ustawieniach. Nowa funkcja = nowa komenda, a nie skrót
wpisany na sztywno w komponencie.

### 10.2 Skróty
- Domyślne w kodzie, nadpisania w `keybindings.json`. Format zgodny z VS Code
  (`{"key": "cmd+b", "command": "editor.bold", "when": "editorFocus"}`), więc da się wkleić
  własne przyzwyczajenia.
- Konteksty `when`: `editorFocus`, `treeFocus`, `pdfFocus`, `paletteOpen`.
- Akordy (`⌘K ⌘S`) obsługiwane. Kolizje wykrywane przy nagrywaniu (§UX 7).
- Skróty CodeMirror (wiele kursorów, zwijanie) są też komendami w rejestrze, więc też je
  widać i można je zmienić.

### 10.3 Snippety
- Format **VS Code** (`prefix`, `body` z `$1`, `${2:domyślne}`, `$0`, `${1|a,b|}`, zmienne
  `$TM_SELECTED_TEXT`, `$CURRENT_DATE`, `$CLIPBOARD`). Silnik: CodeMirror `snippet()` + nasz
  translator formatu VS Code (testy w vitest).
- **Import** pliku snippetów z VS Code (np. z rozszerzenia LaTeX Workshop) jednym przyciskiem.
- Zestaw wbudowany (ok. 60), pogrupowany: struktura, tekst, matematyka, rysunki/tabele,
  listy, odwołania, Beamer. Każdy snippet może mieć **skrót klawiszowy** (to też komenda
  `snippet.insert:<id>`) i ikonę na pasku „Wstaw”.
- **Owijanie zaznaczenia:** snippety z `$TM_SELECTED_TEXT`. Z zaznaczeniem ⌘B daje
  `\textbf{zaznaczenie}`, a bez zaznaczenia wstawia `\textbf{$1}` z kursorem w środku.

---

## 11. Wydajność: budżety i pomiary

| Metryka | Cel | Jak mierzymy |
|---|---|---|
| Zimny start → ekran projektów | < 800 ms | `performance.now()` od `DOMContentLoaded` + log Rust |
| Otwarcie projektu (drzewo + ostatni plik) | < 300 ms | log czasu w DEV |
| Opóźnienie klawisza w edytorze, plik 10 tys. linii | < 16 ms p95 | skrypt Playwright/WebKit (wzorzec z praTRD) |
| Zapis → widoczny nowy PDF, dokument 20 str. (ciepły cache) | < 2,5 s Tectonic, < 1,5 s pdfLaTeX | znacznik w `build:done` + czas podmiany |
| Przewijanie PDF 200 str. | 60 fps, ≤ 6 canvasów w pamięci | rAF p50/p95 |
| CPU w spoczynku (projekt otwarty) | ~0 % | Monitor aktywności |
| RAM (projekt otwarty, PDF 50 str.) | < 300 MB łącznie z WebKitem | Monitor aktywności |
| Rozmiar bundla `.app` | < 60 MB, z czego Tectonic 54 MB (zmierzone w E0: 56 MB) | CI |

Zasady w kodzie: zero `setInterval` w UI, każdy efekt Svelte bez czytania stanu, który sam
zapisuje (lekcja z praTRD), ciężkie komponenty (Tablica) ładowane leniwie (`import()` przy
pierwszym wejściu), pdf.js i CodeMirror w osobnych chunkach.

Haki pomiarowe tylko w DEV: `window.__pratex.bench*()`. `scripts/bench/` generuje syntetyczny
projekt (200 stron, 50 plików, 100 obrazów) do testów.

---

## 12. Struktura repo

```
praTexEditOR/
├── CLAUDE.md · README.md · CHANGELOG.md · VERSION
├── dev.sh · build.sh                    # jak w praTRD (bez uv)
├── .github/workflows/ci.yml             # clippy, cargo test, svelte-check, vitest (3 systemy)
├── .github/workflows/release.yml        # tag v*.*.* → .app.zip / .exe+.msi / .AppImage+.deb
├── docs/  00-vision · 01-qa · 02-plan · 03-ux · design/ui-tokens.md
├── templates/                           # wbudowane szablony (raport, artykuł, praca, beamer)
├── tests/fixtures/                      # prawdziwe logi, synctex, małe projekty TeX
├── scripts/  fetch-tectonic.sh (binarka per platforma do src-tauri/binaries), bench/
└── app/
    ├── src-tauri/src/
    │   ├── lib.rs                       # setup, menu, okno, close-requested
    │   ├── core/   paths, settings, projects, jsonio (atomowy zapis)
    │   ├── fs/     tree, watcher, ops, dnd
    │   ├── build/  queue, tectonic, latexmk, log_parser
    │   ├── synctex/ parser, index
    │   ├── index/  tex_scan, bib, include_graph
    │   ├── protocol.rs  pratex:// (PDF, obrazy, miniatury)
    │   └── boards.rs · notes.rs
    └── src/lib/
        ├── core/      tauri.ts, project.svelte.ts (wsGet/wsSet), appSettings.svelte.ts,
        │              persisted.ts, commands.ts, keymap.svelte.ts, events.svelte.ts
        ├── ui/        tokens.css, Icon.svelte, DialogHost, Toasts, Tooltip, Split, ContextMenu,
        │              CommandPalette, ShortcutsModal, KeyRecorder
        ├── start/     ekran projektów, karty, kreator nowego projektu
        ├── tree/      FileTree (wirtualny), TreeRow, dnd.svelte.ts
        ├── editor/    Editor.svelte, language.ts, theme.ts, snippets.ts, completions.ts,
        │              tabs.svelte.ts, breadcrumbs, insertBar, pasteImage
        ├── pdf/       PdfView.svelte, pages.ts (wirtualizacja), loader.ts (podmiana),
        │              synctexOverlay, darkMode.ts, StatusPill, LogDrawer
        └── tabs/      projekt/, tablica/, notatki/, ustawienia/
```

Limit ok. 600 linii na komponent (lekcja z praSzczur: `NodeGraphTab.svelte` miał 4,9 tys.).

---

## 13. Etapy

Każdy etap kończy się działającą aplikacją, zielonym CI i wpisem w `CHANGELOG.md`. Commity
i tagi robi właścicielka repo. Po etapie zgłaszam, co jest gotowe do commita.

| Etap | Zakres | Kryterium „gotowe” |
|---|---|---|
| **E0 Fundament** ✅ | scaffold Tauri 2 + SvelteKit 3 + Svelte 5, `tokens.css` + `Icon` + boot screen z praSzczur, ustawienia globalne, `persisted.ts`, `DialogHost`, Toasty, Tectonic jako `externalBin` (skrypt pobierający per platforma), `ci.yml` + `release.yml` | `.app`/`.exe`/`.AppImage` z CI startuje i kompiluje „Hello, świat” Tectonikiem na każdym systemie |
| **E1 Projekty + drzewo** ✅ | ekran startowy (karty z miniaturą), kreator (szablon / folder / zip), rejestr projektów, multi-root, układ 3 kolumn (splity, zwijanie, zapamiętane), drzewo leniwe + wirtualne, watcher, operacje plikowe, kosz, DnD w drzewie i z Findera | projekt z 2 folderami: tworzę, przenoszę i usuwam pliki myszą, a zmiany z Findera widać od razu |
| **E2 Edytor** ✅ | CodeMirror 6, gramatyka (próba `lang-tex`), motyw z tokenów, karty, autozapis, konflikt z dyskiem, szukaj/zamień, zwijanie, auto-pary, auto-`\end` | 10 tys. linii pisze się bez lagów (< 16 ms p95), stan kart przeżywa restart |
| **E3 Kompilacja + PDF** ✅ | kolejka łącząca, runner Tectonic, przełącznik auto, parser logu → znaczniki w edytorze + szuflada błędów, pdf.js z wirtualizacją, podmiana bez mrugania, zoom, eksport PDF, wybór silnika (`latexmk`) | pisanie pracy 20-stronicowej: PDF odświeża się sam, nie skacze ani nie mruga, a błąd prowadzi do linii |
| **E4 SyncTeX** ✅ | parser + indeksy w Rust, klik PDF → kod, ⌘+klik kod → PDF, podświetlenia, „podążaj za kursorem” | trafienie co do linii w projekcie z `\input` w podfolderach |
| **E5 Snippety + skróty + komendy** ✅ | rejestr komend, keymap z `when` i akordami, paleta ⌘⇧P, quick-open ⌘P, pasek „Wstaw”, snippety VS Code + import, owijanie zaznaczenia, wklejanie zrzutu, DnD obrazu do edytora, Ustawienia: edytor skrótów (nagrywanie) i snippetów, okno `?` | każda akcja z paska ma skrót i jest w palecie; zrzut ⌘⇧4 → ⌘V → rysunek w PDF w < 5 s |
| **E6 Indeks projektu** | skaner `.tex`/`.bib`, okruszki + outline ⌘⇧O, podpowiedzi `\ref`/`\cite`/`\input`/`\includegraphics` z podglądem (miniatura obrazu, karta pozycji bibliografii), podgląd obrazu po najechaniu, biblioteka `.bib` (modal), licznik słów, wykrywanie pliku głównego | praca dyplomowa: `\cite{` pokazuje autorów i tytuł, a outline odzwierciedla kolejność rozdziałów |
| **E7 Notatki, Tablica, szablony** | Notatki + pływający notatnik, Tablica (port z praTRD, przeniesione na Rust), zrzut fragmentu PDF → Tablica, szablony projektów (wbudowane + „Zapisz projekt jako szablon”) | jak w praTRD; nowy raport z szablonu w 2 klikach |
| **E8 Dopracowanie + 0.1.0** | ciemny PDF (2 tryby), pomiary z §11 na projekcie syntetycznym i poprawki, dostępność klawiaturowa, `README`, tag `v0.1.0` (właścicielka) | wszystkie budżety z §11 spełnione; release z 3 instalatorami |

Później (nie w 0.1): podgląd wzoru pod kursorem (render KaTeX w dymku), paleta symboli
matematycznych (siatka piktogramów), generator tabel (siatka jak w Wordzie → `tabular`),
porównanie wersji pliku (lokalna historia zapisów), biber w bundlu.

---

## 14. Ryzyka i kontrola

| Ryzyko | Kontrola |
|---|---|
| Tectonic + biblatex/biber: niezgodność wersji (biber spoza bundla) | domyślnie BibTeX/natbib; przy `biblatex` wykrywamy biber i jego wersję, a przy niezgodności pokazujemy podpowiedź „przełącz na latexmk”; później biber w bundlu dopasowany do bundla Tectonic |
| Tectonic wolniejszy niż pdfLaTeX (XeTeX, fontspec) | pliki pośrednie trzymane między przebiegami, kolejka łącząca, `latexmk -pdf` jako opcja; pomiar w E3 |
| Pierwsza kompilacja offline (brak pakietów w cache) | czytelny komunikat z ikoną „brak sieci”; po pierwszym pobraniu działa offline |
| pdf.js: pamięć przy dużych PDF-ach | wirtualizacja, pula canvasów, limit w ustawieniach; pomiar w E3 |
| SyncTeX: ścieżki (symlinki, `./`, wielkość liter) | normalizacja w Rust + testy na fixture'ach |
| Gramatyka `lang-tex` niedojrzała | próba w E2; fallback `stex`; gramatyka schowana za `language.ts` |
| Wklejanie obrazu w WKWebView/WebView2/WebKitGTK działa różnie | najpierw zdarzenie `paste`, w razie braku plugin schowka Tauri; test na 3 systemach w CI (smoke) |
| WebKitGTK na Linuksie (canvas, wydajność) | wspierany, nie referencyjny |
| Monolityczne komponenty | limit ~600 linii, podział od startu (§12) |
