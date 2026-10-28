# CLAUDE.md

## Projekt

**praTexEditOR**: desktopowy edytor LaTeX (lokalny Overleaf). Projekty z wieloma folderami,
3 kolumny: drzewo plików | CodeMirror 6 | PDF (pdf.js), auto-kompilacja (Tectonic), SyncTeX.
Tauri v2 (sam Rust, bez sidecara) + SvelteKit 3 / Svelte 5. Wzorce i wygląd z praTRD/praSzczur
(`../praTRD`, `~/Desktop/Study/AI_MED/praSzczur`).

Wizja: `docs/00-vision.md`. Decyzje: `docs/01-qa.md`. Plan i etapy: `docs/02-plan.md`.
UX: `docs/03-ux.md`. Tokeny: `docs/design/ui-tokens.md`.

**Stan: E0–E8 gotowe (+ Notatki ⌘⇧M/⌘⇧N, własne szablony, Tablica z Konvą: `boards.rs`, zrzut fragmentu PDF → Tablica). E9 Wersje (git) gotowe: zakładka ⌘4.**

## Uruchamianie

```bash
./dev.sh          # Tauri dev + hot reload; dane w <app data>/com.praoliwia.praTexEditOR.dev
./build.sh        # build + praTexEditOR.app w roocie i instalacja w /Applications (--no-install: bez; --install-only: tylko kopia)
./scripts/fetch-tectonic.sh [triple]   # binarka Tectonic → app/src-tauri/binaries/ (externalBin)
./scripts/smoke-tectonic.sh <bin>      # kompilacja testowa z polskimi znakami

cd app && pnpm check && pnpm test                                   # front
cd app/src-tauri && cargo clippy --all-targets -- -D warnings && cargo test   # Rust
cargo test -- --ignored        # prawdziwa kompilacja Tectonic (może pobierać pakiety)
```

## Architektura (skrót)

```
app/src-tauri/src/
  lib.rs           setup, stan (Paths, Procs, EngineState), close-requested → flush → destroy
  core/            paths (data/cache, `.dev` w debug), jsonio (atomowy zapis, .corrupt), settings
  engine/          process (Procs + Killer: grupa procesów do zabicia, strumień linii bez pollingu),
                   tectonic (binarka obok exe), latexmk (wykrywanie TeX Live, komenda), status (rozgrzewka
                   z Condvar, selftest, cache Tectonic), build (kolejka łącząca, publikacja doc.pdf/.log/
                   .synctex.gz w cache, eksport), log (parser logu → Diagnostic + polskie podpowiedzi)
  git/             libgit2 bez sieci (`git2`, bez `git` w systemie): repo = root projektu; mod (repos, status, log),
                   diff (changes + file_diff: from/to = HEAD|index|work|root|<commit>), ops (init, discard plik/blok,
                   restore z commita → stary plik do kosza). Celowo BEZ commit/stage w appce; repo szukane w górę drzewa
  synctex.rs       doc.synctex.gz → Index (hboxy + punkty słów), forward (plik, linia → prostokąty),
                   inverse (strona, x, y → plik, linia); cache per projekt wg mtime, warm() po kompilacji
  protocol.rs      pratex:// — pdf/<pid> (PDF z cache) i file/<pid>?p= (plik projektu przez guard), Range
  projects/        registry (registry.json + <id>/state.json), templates (z ../../templates, wspólna
                   preamble.tex), detect (plik główny), zipimport, mod.rs (komendy, OpenProject)
  fs/              guard (ścieżki tylko w rootach projektu + walidacja nazw), tree (lista, sortowanie
                   naturalne, ukrywanie), ops (create/rename/transfer z polityką konfliktów/kosz),
                   text (odczyt/zapis atomowy, CRLF/BOM, znacznik mtime+size),
                   watcher (notify → kanał → seria → callback `fs-changed`)
app/src/lib/
  core/            tauri.ts (call/on + busy), appSettings, engine, nav (zakładki), keys (formatKeys), persisted
  ui/              tokens.css (JEDYNE kolory), Icon, tooltip (use:tip + TooltipHost), DialogHost, Toasts,
                   LoadingBar, EngineChip
  core/projects    lista, otwarty projekt, wsGet/wsSet (stan per projekt), tworzenie
  start/           StartScreen, ProjectCard, NewProject + wizard.svelte.ts (szablon/folder/zip/plik główny)
  tree/            tree.svelte.ts (TreeStore: leniwe foldery, wiersze, zaznaczenie, operacje + cofnij),
                   FileTree (wirtualna lista), dnd.svelte.ts (Pointer Events + Finder, `data-drop`), kinds
  editor/          osobny chunk (index.ts, import() w Workspace); docs.svelte.ts (Docs: karty, EditorState
                   per plik, autozapis, zmiany z dysku, konflikt), setup.ts (rozszerzenia + kompartmenty),
                   language.ts (JEDYNE miejsce z gramatyką), structure.ts (zwijanie, auto-\end), theme.ts,
                   SearchPanel, TabBar, EditorPane; bridge.svelte.ts = co reszta appki może (bez CodeMirror)
  build/           build.svelte.ts (Build per projekt: zlecenia z fs-changed, ⌘S/⌘Enter/⌘./F8, filtry,
                   activeBuild()), StatusPill, LogDrawer
  pdf/             PdfColumn (prawa kolumna, bez pdf.js), PdfView + viewer.ts (chunk pdf.js: wirtualizacja,
                   podmiana bez mrugania, zoom) — PdfView zawsze przez import()
  core/commands.svelte.ts  rejestr komend (id, ikona, keys, when, group) + dyspozytor (konteksty, akordy,
                   nadpisania); keybindings.ts (keybindings.json, import VS Code)
  palette/         Palette (⌘P / ⌘⇧P, fuzzy.ts), ShortcutsModal (`?`)
  snippets/        builtin.ts (wbudowane, składnia VS Code), vscode.ts (→ szablon CodeMirror), store (snippets.json)
  images/          wklejanie zrzutu i upuszczanie obrazów/.tex na edytor (ImageDialog)
  git/             git.svelte.ts (GitStore per projekt: zmiany vs HEAD, historia, porównanie, diff; odświeżany z `fs-changed` i fokusu
                   okna), rows.ts (hunki → wiersze unified/split), wordDiff.ts (podświetlenie słów)
  tabs/            wersje/ (zakładka ⌘4: Wersje, ChangesPane, HistoryPane, DiffView — wirtualny diff 20 px/wiersz),
                   Placeholder, projekt/ (Projekt {#key}, Workspace 3 kolumny, layout, Splitter),
                   ustawienia/ (Ogolne, Projekty, Diagnostics)
```

## Zasady pracy

- **Git tylko do odczytu, zero GitHuba** (żadnych commitów, pushy, `gh`). Na koniec etapu zgłaszam,
  co jest gotowe do commita.
- **Optymalizacja od pierwszej linii:** praca w Rust, webview tylko UI; zero pollingu i pętli w tle;
  PDF renderowany tylko widoczny; budżety w `02-plan.md` §11 mierzyć przed i po zmianie.
- **UX: obrazkowo, mniej tekstu.** Ikona + tooltip ze skrótem; nowa akcja = komenda w rejestrze
  (`core/commands.svelte.ts`), nigdy skrót wpisany w komponencie.
- Komentarze i nazwy w kodzie: EN. Dokumentacja i UI: PL. Ikony: inline SVG (`Icon.svelte`), bez emoji.
- Bez AI / LLM w aplikacji, nigdy.
- Foldery użytkownika zostają czyste: pliki pomocnicze kompilacji tylko w `<app cache>/build/<pid>/`.

## Konwencje E0

- Komenda Tauri zwraca `Result<T, String>` (`core::CmdResult`); błąd po polsku, front pokazuje go tak, jak jest.
- Front woła Rust tylko przez `call()` z `core/tauri.ts` (licznik dla LoadingBar); eventy przez `on()`.
- Proces potomny tylko przez `engine::process::run_streaming` (rejestr `Procs` → kill przy wyjściu).
- Tooltip: `use:tip={{ label, keys: "mod+b" }}`; nie dawać tooltipu tam, gdzie podpis już jest widoczny.
- Animacje nieskończone tylko na widocznych elementach (LoadingBar wyłącza animację, gdy ukryty) — 0 % CPU w spoczynku.
- Ikona aplikacji: `app/src-tauri/icons/source-original.png` (od właścicielki) → `source.png` (1024², grafika 824² — siatka Apple) → `pnpm tauri icon icons/source.png` (usunąć `android/`, `ios/`). W UI: `static/logo.png` (192²).

## Projekty i pliki (KONWENCJE)

- Widok projektu jest w `{#key project.id}` — stan per projekt tworzony w komponentach/storach
  na nowo przy przełączeniu; nic nie może przeciekać między projektami.
- Każda komenda plikowa bierze `pid` i przepuszcza ścieżki przez `fs::guard::inside` — nigdy nie
  dodawać komendy, która pisze po ścieżce bez tego. Nowe nazwy przez `guard::valid_name`.
- Konflikt nazw: najpierw `policy: "ask"` → lista konfliktów → pytanie (chooseOption) → ponownie
  z wybraną polityką. Nigdy ciche nadpisanie; „Zastąp” = stary plik do kosza.
- Cel upuszczenia = atrybut `data-drop` (ścieżka folderu albo `@new-project`); ten sam hit-test
  dla przeciągania w appce i z Findera (pozycje z Tauri są w px fizycznych → dzielić przez DPR).
- Po przeciągnięciu połykamy tylko kliknięcie z tej samej chwili (lekcja z E1: listener `once`
  bez limitu zjadał następne prawdziwe kliknięcie).
- Skróty z ⌥ na macOS: porównywać `e.code` (`Digit1`), nie `e.key` (⌥1 = „¡”).
- Test UI bez natywnego okna: Playwright WebKit + atrapa `__TAURI_INTERNALS__` (scratchpad
  `mock.js`); logika plików jest testowana w Rust.

## Edytor (KONWENCJE)

- `EditorState` nigdy w `$state` (głęboki proxy!) — trzymany w zwykłym polu `Doc.state`; reaktywne są
  tylko flagi (`dirty`, `gone`, `conflict`…). Stan widoczny = `view.state` (`Docs.stateOf`).
- Store `Docs` żyje w `Workspace` (per projekt), widok w `EditorPane` — ukrycie kolumny niszczy
  tylko widok (`detach` odkłada stan do karty).
- Nasze zmiany programowe (dysk → edytor) mają `userEvent: "external"` — nie liczą się jako pisanie.
- Autozapis nigdy nie pisze przy konflikcie ani do usuniętego pliku; nadpisanie tylko z decyzji
  użytkowniczki (`save(d, { force: true })`).
- Echo własnego zapisu z watchera odsiewa `fs_read(known: stamp)` → `unchanged` (bez czytania pliku).
- Ustawienia edytora → kompartmenty w `setup.ts`; `prefs.ts` bez importu CodeMirror (zakładka
  Ustawienia nie może ciągnąć chunka edytora). Nic z `#lib/editor/*` poza `bridge`/`prefs` nie
  importować statycznie spoza edytora.
- Skrót = wpis w rejestrze (`core/commands.svelte.ts`); wszystkie klawisze rozdziela `dispatchKey`
  (capture na oknie, przed CodeMirror) wg kontekstu z celu zdarzenia (`.cm-content` / `[role=tree]` /
  `.pdfv`). Komendy `app.*` działają zawsze, reszta tylko w widoku projektu. Nie pisać `keymap.of` ani
  `onkeydown` dla akcji, które mają być w palecie. ⌘W nie jest w menu natywnym (zamyka kartę, nie okno).
- `register()` z efektu: licznik wersji zmieniany w `untrack` (inaczej pętla efektu).
- Snippet = komenda `snippet.insert:<id>`; treść w składni VS Code (w stringach JS `\\\\` = LaTeX `\\`),
  w szablonach CodeMirror domyślna wartość pola nie może mieć `{}` (translator robi z niej tekst + puste pole).
- Test UI: `scratchpad/mock.js` ma też `fs_read/fs_write` i `__extWrite/__extDelete` (zdarzenie
  `fs-changed`); pomiar klawiszy na `duzy.tex` (10 tys. linii). Od E3 mock ma `build_*` (emituje
  `build-progress`/`build-done`, diagnostyki z `window.__diags`), `convertFileSrc` → `/__mock/…`
  (Playwright `route` podaje prawdziwy PDF); serwer: `pnpm exec vite preview --port 4173`.

- Kolory: jedyny popover to `ui/ColorPopupHost` (otwierany przez `openColor()`); przycisk-próbka to
  `ui/ColorPicker`, w kodzie LaTeX próbki rysuje `editor/colors.ts` (`{HTML}{…}`, `{RGB}{…}`, `{rgb}{…}`).
  Nowe pole z kolorem = `ColorPicker`, nigdy `<input type="color">`.

## Kompilacja i PDF (KONWENCJE)

- Wynik kompilacji zawsze w `<cache>/build/<pid>/` (`doc.pdf`, `doc.log`, `doc.synctex.gz`; outdiry
  `tectonic/` czyszczony, `latexmk/` trwały). Do folderu użytkowniczki tylko eksport / `build.copyPdf`.
  Pliki publikujemy przez ukrytą kopię `.nazwa.pratex~` + rename (watcher ignoruje `~`).
- Zlecenie kompilacji wychodzi z frontu (`Build`), wyzwalaczem jest `fs-changed` (też dla własnych
  zapisów); pliki pomocnicze TeX i eksportowany `main.pdf` nie wyzwalają (brak pętli). Rust łączy zlecenia.
- Front dostaje `Diagnostic[]`, nigdy log (surowy log tylko na żądanie z szuflady).
- PDF do webview tylko przez `pratex://` (`protoUrl()` w `core/tauri.ts`), nigdy przez IPC.
- pdf.js: jeden wspólny `PDFWorker`; dokument zwalnia `loadingTask.destroy()` (w 6.x nie ma
  `doc.destroy`). Nowy PDF: render widocznych stron poza ekranem, potem zamiana synchronicznie.
- SyncTeX: współrzędne zawsze w punktach PDF od lewego górnego rogu strony (strona 0-based) — tak
  liczą Rust i `viewer.ts` (`pointAt`, `showRects`). Rekordy punktów to końce słów; pdfLaTeX znaczy
  wcięcie akapitu linią jego końca → słowo pod kliknięciem = pierwszy punkt na prawo.
- ⌘+klik w edytorze = SyncTeX (`sync.toPdf`), dodatkowy kursor = ⌥+klik (`clickAddsSelectionRange`).
- Nowy log do testów parsera → `tests/fixtures/logs/` (ścieżki zanonimizowane, długość linii zachowana);
  SyncTeX → `tests/fixtures/synctex/` (`$PROJECT` zamiast ścieżki projektu `projekt/`).

## Konwencje przejęte z praTRD (nie łamać)

- SvelteKit 3: konfiguracja w `vite.config.js`, importy `#lib/...` z pełnym rozszerzeniem; TS 6.x.
- Stan UI per projekt → `wsGet/wsSet`; globalny → `getSetting/setSetting`; nigdy `localStorage`.
- `window.prompt/confirm/alert` nie działają w webview → `DialogHost`.
- DnD wewnątrz appki przez Pointer Events, nie HTML5 DnD.
- Svelte 5: efekt nie czyta stanu, który sam zapisuje.
- Zakładka jest dzieckiem flex → korzeń `flex: 1; min-width: 0`.
- Nie usuwać domyślnego menu Edytuj (⌘C/V w WKWebView). Nie zapisywać do wnętrza `.app`.
- Skrypty edytujące pliki: `assert old in s` przy każdej podmianie.
