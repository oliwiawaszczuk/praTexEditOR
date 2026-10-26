# Changelog

## E8 Dopracowanie — w toku

- **Ciemny PDF** (ikona księżyca w pasku PDF, komenda `pdf.tone`): „Papier nocny” (kolory tekstu
  i linii w renderze pdf.js, obrazy bez zmian) i „Odwróć” (filtr CSS). Tylko podgląd, eksport bez zmian.
- Szuflada diagnostyki otwiera się sama przy błędach i wsuwa się animacją.
- ⌘+klik na własnej komendzie (`\arrow`) skacze do jej `\newcommand` w dowolnym pliku projektu.
- Widoczny fokus klawiatury, `scripts/bench/gen-project.sh` (projekt do pomiarów §11), `README`.

## E5 Snippety + skróty + komendy — 2026-10-23

- **Rejestr komend** (`core/commands.svelte.ts`) jako jedyne źródło akcji, ikon i skrótów. Jeden
  dyspozytor klawiszy w fazie przechwytywania okna (przed CodeMirror) z kontekstami `edytor` / `drzewo`
  / `PDF` / `wszędzie`, akordami (`⌘K ⌘S`, 1 s na drugi klawisz) i nadpisaniami użytkowniczki
  (`keybindings.json`). Zwykłe klawisze (np. `?`) nie przechwytują pisania w polach. Nawigacja (⌘1–3,
  ⌘,, ⌘⌥1–3), drzewo (⌘N, ⌘⇧N, F2, ⌘⌫…), edytor, kompilacja i PDF są komendami — tooltipy i menu
  pokazują skrót w mocy.
- **Paleta ⌘⇧P / szybkie otwieranie ⌘P** — jedno okno, prefiks `>` przełącza na komendy (jak w VS Code);
  dopasowanie rozmyte z podświetleniem, ostatnio otwierane pliki na górze. `@` / `#` (sekcje, etykiety)
  czekają na indeks projektu (E6).
- **Okno skrótów `?`** (też ikona w pasku): komendy w grupach z aktualnymi skrótami + zakładka snippetów.
- **Snippety w formacie VS Code** (`$1`, `${1:domyślne}`, `${1|a,b|}`, `$0`, `$TM_SELECTED_TEXT`,
  zmienne daty) tłumaczone na CodeMirror; 60 wbudowanych w 7 grupach. Z zaznaczeniem owijają tekst
  (⌘B → `\textbf{zaznaczenie}`), bez — wstawiają szkielet z kursorem w pierwszym polu (Tab / ⇧Tab, Esc).
  Prefiks + Tab (`fig`, `tab`, `eq`, `ali`, `itm`, `enu`, `sec`, `frm`…), każdy snippet to komenda
  (paleta, własny skrót).
- **Podpowiedzi po `\`**: komendy (ƒ), snippety (» z podglądem treści); `\begin{` → środowiska (▢),
  wybór wstawia `\end{…}` i kursor w środku.
- **Pasek „Wstaw”** nad edytorem (⌘⇧I): B I U │ H▾ • 1. │ Σ▾ ▣ ▦ │ ref cite — ikony z rejestru, klik nie
  zabiera zaznaczenia.
- **Ustawienia › Skróty**: lista komend z kontekstem, nagrywanie skrótu (pulsuje, akord drugim
  naciśnięciem, ⌫ usuwa), kolizja → „koliduje z: X [⇄ zamień] [✕ anuluj]”, ↺ przy zmienionych, filtr po
  nazwie albo po naciśniętym skrócie, import `keybindings.json` z VS Code (LaTeX Workshop i podstawy).
- **Ustawienia › Snippety**: lista w grupach, edycja (nazwa, prefiks z kontrolą powtórzeń, skrót, grupa,
  ikona z siatki, „na pasku Wstaw”, treść) z podglądem na żywo z zaznaczonymi polami; zapis od razu;
  wbudowane można zmienić (↺) albo ukryć; import pliku snippetów VS Code.
- **Obrazy:** ⌘V ze zrzutem → okienko (miniatura, nazwa zaznaczona, folder, „sam obraz” / „rysunek +
  podpis”, „nie pytaj”) → plik w folderze obrazów projektu (zapamiętany; domyślnie `img/` obok pliku
  głównego), kod ze ścieżką względem pliku głównego, kursor w `\caption{}`. Z „nie pytaj” wstawia od razu
  z toastem „Cofnij”. Upuszczenie obrazu z Findera albo z drzewa na edytor wstawia go w miejscu
  upuszczenia (z Findera kopiuje do folderu obrazów), `.tex` → `\input{…}`.
- Rust: `userdata_get/set` (keybindings.json, snippets.json), `import_json_file` (okno wyboru w Rust,
  JSON z komentarzami), `fs_files`, `fs_write_image` (surowe bajty, bez JSON, nigdy nie nadpisuje),
  `fs_ensure_dir`.
- Domyślne skróty wg `03-ux.md` §10, z wyjątkiem `$…$`: ⌘E zamiast ⌘M (⌘M minimalizuje okno w macOS).

Testy: vitest 39 (dyspozytor z akordami i nadpisaniami, kolizje, nagrywanie, import VS Code, translator
snippetów, wbudowane snippety, dopasowanie rozmyte, obrazy); Playwright WebKit: paleta, ⌘P, ⌘B na
zaznaczeniu, `fig`+Tab z polami, podpowiedzi, pasek Wstaw, okno `?`, wklejenie obrazu (plik + kod
rysunku), nagranie skrótu z kolizją i zamianą, akord.

## E4 SyncTeX — 2026-10-23

- Rust czyta `doc.synctex.gz` (strumieniowo, `flate2`) raz po każdej kompilacji (w tle, zanim padnie
  pierwsze kliknięcie) i trzyma indeks w pamięci: wiersz wydruku (hbox) + punkty słów z dokładną linią
  źródła. Zapytania `synctex_forward` / `synctex_inverse`; front nigdy nie dotyka pliku SyncTeX.
- **PDF → kod:** klik w stronę (albo ⌘+klik — Ustawienia › PDF) otwiera plik na tej linii i podświetla
  ją akcentem. Przeciągnięcie dalej zaznacza tekst w PDF i nie skacze.
- **Kod → PDF:** ⌘+klik w edytorze, ⌘J albo ikona celownika: PDF przewija się do miejsca (tylko gdy jest
  poza środkiem widoku) i rysuje pulsującą ramkę (1,3 s). Linia bez wydruku (pusta, `\input`) →
  najbliższa linia z tekstem.
- **Podąża za kursorem** (ikona łańcucha w pasku PDF, per projekt): najwyżej jedno zapytanie na 150 ms,
  ostatnia pozycja wygrywa, bez ramki.
- Dodatkowy kursor w edytorze przeszedł z ⌘+klik na ⌥+klik (jak w VS Code), bo ⌘+klik to teraz SyncTeX.
- Ścieżki: absolutne (Tectonic) i względne z `./` (pdfLaTeX) → kanoniczne; brane są tylko pliki projektu
  (klasy i pakiety TeX-a nie przechwytują kliknięcia).
- Ustawienia › PDF: tryb kliknięcia (klik / ⌘+klik) i ściąga skrótów SyncTeX.

Pomiary: test na prawdziwych plikach SyncTeX z Tectonic i pdfLaTeX (projekt z `\input` w `rozdzialy/`
i `rozdzialy/dodatki/`): obie strony trafiają co do linii, klik w każde słowo wraca do swojej linii
(≥ 95 %, w praktyce wszystkie). Dokument 175 stron: kompilacja 0,6 s, parsowanie SyncTeX 22 ms,
zapytanie PDF → kod ok. 1 µs.

## E3 Kompilacja + PDF — 2026-10-23

- **Kompilacja bez śmieci w folderze:** Tectonic dostaje tylko `main.tex` → PDF; pliki pośrednie
  (`.aux`, `.toc`, `.bbl`…) trzyma w pamięci i sam robi ponowne przebiegi i BibTeX. Na dysku, w cache
  aplikacji (`<cache>/build/<projekt>/`), zostają tylko trzy pliki: `doc.pdf`, `doc.synctex.gz` (pod
  SyncTeX w E4) i `doc.log` (pod listę błędów). Folder projektu dostaje PDF tylko na żądanie
  (eksport albo opcja „kopiuj PDF obok pliku głównego”).
- Kolejka łącząca w Rust: najwyżej jedna kompilacja na projekt; zlecenie w trakcie = dokładnie jedna
  następna (bez zabijania prawie skończonej). Auto-kompilacja po zapisie i po zmianie z zewnątrz
  (wspólna ścieżka przez watcher), opóźnienie 200 ms (ustawienie), przełącznik ▶/⏸ per projekt,
  ⌘S / ⌘Enter = zapisz + kompiluj teraz (echo własnego zapisu nie odpala drugiej kompilacji),
  ⌘. przerywa (zabija całą grupę procesów), limit 2 min. Przy otwarciu projektu: od razu ostatni PDF
  z cache + jedna kompilacja.
- Dokument z błędami i tak daje PDF (Tectonic `-Z continue-on-errors`, latexmk `-f`), jak w Overleaf;
  gdy PDF nie powstaje, zostaje poprzedni z czerwoną pigułką.
- Parser logu (Rust): sklejanie linii łamanych na 79 znakach, stos plików z nawiasów (cytaty kodu
  z błędów i overfull boxów nie psują śledzenia), `! …` + `l.N`, format `plik:linia:` (pdfLaTeX),
  ostrzeżenia LaTeX/pakietów z kontynuacjami, overfull/underfull, brakujące znaki; bez szumu
  „Rerun to get…”; podpowiedzi po polsku (np. „Nieznana komenda \inclugraphics — może
  \includegraphics?”, brak pakietu, `$`, nawiasy, polskie znaki w pdfLaTeX). Testy na prawdziwych
  logach w `tests/fixtures/logs/`.
- Edytor: znaczniki na marginesie (czerwony/żółty), falista linia, dymek z komunikatem i podpowiedzią;
  F8 / ⇧F8 przechodzi między błędami (też między plikami), skok podświetla linię. Drzewo: czerwona
  kropka przy pliku z błędami.
- Kolumna PDF: pigułka statusu (`● 0,4 s` / `⟳ kompiluję` / `☁ pakiety n` / `✕ 2 ⚠ 5`), szuflada błędów
  z filtrami (błędy / ostrzeżenia / boxy — domyślnie ukryte), klik = plik i linia, surowy log na
  żądanie. Pusty stan z ⌘S, szkielet strony z połyskiem przy pierwszej kompilacji.
- Przeglądarka pdf.js 6.4 (osobny chunk, jeden wspólny worker): wirtualna lista stron, canvas tylko
  dla widocznych ±1 (≤ 8 w pamięci), warstwa tekstu (zaznaczanie, kopiowanie) tylko na widocznych;
  podmiana nowego PDF bez mrugania (widoczne strony rysowane w tle, zamiana w jednej klatce, pozycja
  jako strona + punkty PDF); zoom −/+/100 %, dopasuj szerokość / stronę, ⌘= ⌘- ⌘0, gest szczypania
  i ⌘+kółko (natychmiast CSS, ostro po 150 ms); numer strony przy przewijaniu; zoom, dopasowanie
  i miejsce zapamiętane per projekt. CMaps, fonty standardowe i dekodery wasm w bundlu (`/pdfjs/`).
- Protokół `pratex://` (PDF i pliki projektu prosto z dysku, z zakresami bajtów, bez IPC/base64).
  Podgląd obrazów i PDF z drzewa w środkowej kolumnie.
- Eksport PDF: obok pliku głównego albo „Zapisz jako…” (okno systemowe otwiera Rust — ścieżka nie
  przychodzi z webview); „Otwórz w Podglądzie”; „Wyczyść pliki kompilacji”.
- Silniki: Tectonic (wbudowany) albo latexmk + pdfLaTeX / XeLaTeX / LuaLaTeX z systemowego TeX Live
  (wykrywanie także poza PATH, np. `/Library/TeX/texbin`), wybór domyślny w Ustawieniach, nadpisanie
  per projekt w menu ⋯ kolumny PDF. latexmk ma swój trwały folder pomocniczy w cache.
- Ustawienia › Kompilacja: auto-kompilacja, opóźnienie, kopiowanie PDF, silnik z wersjami, cache
  Tectonic (rozmiar, wyczyść → ponowna rozgrzewka).

Pomiary: dokument 26 stron (Tectonic, ciepły cache) 0,41 s; zmiana pliku z zewnątrz → nowy PDF
w cache 0,58 s (prawdziwa aplikacja); podmiana PDF w przeglądarce: 0 pustych klatek, pozycja
zachowana co do piksela (Playwright WebKit); pdf.js 131 kB gz, ładowany dopiero z projektem.

## E2 Edytor — 2026-10-23

- CodeMirror 6 w środkowej kolumnie, osobny chunk (ok. 95 kB gz) ładowany dopiero z projektem.
- Gramatyka: własny tokenizer LaTeX (StreamLanguage) w `editor/language.ts` — komendy, nazwy
  środowisk, tytuły sekcji, klucze `\label`/`\ref`/`\cite`, ścieżki `\input`/`\includegraphics`,
  matematyka (`$…$`, `$$…$$`, `\(…\)`, `\[…\]`, `equation`/`align`/… z gwiazdką), `verbatim`/`lstlisting`,
  `\verb`, `\url`; niedomknięty `$` kończy się na pustej linii. BibTeX: typ, klucz, pola.
  `lang-tex` odpadł w próbie (0.0.3 na przedpremierowym `@codemirror/next` 0.13),
  `codemirror-lang-latex` jest na AGPL.
- Motyw z tokenów (`--syn-*`, nowe: `--syn-key`, `--syn-path`, kolory porównania).
- Karty: jeden `EditorState` na plik (cofanie, zaznaczenie i przewinięcie przeżywają przełączanie
  i ukrycie kolumny), klik w drzewie = podgląd (kursywa, zastępowany), dwuklik / Enter = karta,
  kropka = niezapisane (też w drzewie), × / środkowy klik / ⌘W, ⌃Tab / ⌃⇧Tab, przeciąganie
  zmienia kolejność, menu (zamknij pozostałe/wszystkie, pokaż w drzewie, kopiuj ścieżkę, Finder).
  Karty, aktywna karta, kursor i miejsce przewinięcia przeżywają restart.
- Autozapis 400 ms po ostatnim klawiszu (atomowo w folderze pliku, zachowane CRLF, BOM
  i uprawnienia), ⌘S zapisuje od razu; zapis przed przełączeniem/zamknięciem projektu i okna.
  Pliki nie w UTF-8, binarne i > 16 MB otwierają się jako piktogram (bez ryzyka zniszczenia).
- Zmiana z zewnątrz: czysta karta → minimalny diff (kursor zostaje, da się cofnąć); karta ze
  zmianami → pasek konfliktu „moja / z dysku / porównaj” (porównanie: diff z przyciskami przy
  każdym fragmencie). Plik usunięty na dysku → przekreślona karta i pasek „zapisz ponownie”;
  autozapis nigdy sam nie nadpisuje nowszej wersji ani nie wskrzesza usuniętego pliku.
  Zmiana nazwy / przeniesienie w drzewie → otwarte karty idą za plikiem.
- Szukaj/zamień (⌘F, ⌘⌥F): panel z ikonami, wielkość liter / całe słowa / regex, licznik
  „3/17”, zaznacz wszystkie (⌥Enter → wiele kursorów), zamień / zamień wszystkie.
- Zwijanie `\begin…\end` i sekcji (do następnej sekcji tego samego lub wyższego poziomu),
  dopasowanie nawiasów, auto-pary `{}` `[]` `$$` (owijają zaznaczenie; `\$` bez pary),
  Enter po `\begin{…}` wstawia `\end{…}` (w `itemize`/`enumerate` także `\item`), wiele kursorów,
  ⌘/ komentarz `%`, zawijanie miękkie (⌥Z).
- Ustawienia › Edytor: zawijanie, numery wierszy, autozapis, wielkość tekstu, wcięcie 2/4
  (z „przywróć domyślne”).
- Rejestr komend `core/commands.ts` (zalążek E5): skróty okna i edytora pochodzą z rejestru.
- Menu: bez „Zamknij okno” pod ⌘W (⌘W zamyka kartę).

Pomiary (Playwright WebKit, build produkcyjny, plik 10 tys. linii): praca na klawisz p95 10 ms
(mały plik: 7 ms), klawisz → następna klatka p95 19 ms tak samo jak w małym pliku (wyrównanie
do klatki); otwarcie pliku 10 tys. linii ok. 35 ms ponad otwarcie małego.


## E1 Projekty + drzewo plików — 2026-10-23

- Ikona aplikacji od właścicielki (`icons/source-original.png` → siatka Apple 824/1024 → wszystkie
  rozmiary); logo na ekranie startowym i w „O aplikacji”.
- Projekty: rejestr (`projects/registry.json`), stan UI per projekt (`wsGet/wsSet`), wiele
  podpiętych folderów, plik główny, kolor; ostatni projekt otwiera się przy starcie (ustawienie).
- Ekran startowy: karty (szkic strony w kolorze projektu, liczba folderów, wiek, ostrzeżenie
  o brakującym folderze), menu kontekstowe (nazwa, kolor, Finder, usuń z listy — pliki zostają),
  upuszczenie folderu z Findera = nowy projekt.
- Kreator: Szablon (Pusty, Raport, Artykuł, Praca dyplomowa, Prezentacja — kompilują się Tectonikiem,
  wspólna preambuła XeTeX/pdfLaTeX), Folder (wykrywanie pliku głównego, wybór przy kilku),
  ZIP (np. eksport z Overleaf; zdejmuje wspólny folder, odrzuca niebezpieczne ścieżki).
- Pasek: chip projektu (ostatnie projekty, wszystkie, nowy), przełączniki kolumn ⌘⌥1/2/3,
  menu systemowe „Projekt”.
- Układ 3 kolumn: przeciągane splity (zapis na końcu gestu), dwuklik = domyślna szerokość,
  przeciągnięcie do krawędzi zwija kolumnę do paska z ikoną.
- Drzewo: leniwe (czyta tylko rozwinięte foldery), wirtualna lista, sortowanie naturalne, ikony
  i kolory typów, ★ plik główny, ukrywanie plików pomocniczych TeX i ukrytych (Ustawienia › Ogólne),
  filtr nazw, klawiatura (strzałki, Enter, F2, ⌘⌫, ⌘N, ⌘⇧N, ⌘A), menu kontekstowe, edycja nazwy
  w miejscu (zaznacza nazwę bez rozszerzenia), brakujący folder → „wskaż ponownie”.
- Operacje: nowy plik/folder, zmiana nazwy (też tylko wielkość liter), duplikat, przeniesienie
  i kopiowanie (DnD, ⌥ = kopia), do kosza systemowego, pokaż w Finderze, kopiuj ścieżkę względną
  do pliku głównego; konflikty nazw → okno z ikonami (zachowaj oba / zastąp / pomiń); toast
  z „Cofnij” dla przeniesień, kopii i zmian nazw; plik główny podąża za przeniesieniem.
- DnD: Pointer Events, duszek, podświetlony cel, autorozwijanie po 600 ms, autoprzewijanie przy
  krawędzi, Esc anuluje; pliki z Findera kopiowane do folderu pod kursorem.
- Watcher: zmiany z Findera widoczne od razu (seria zdarzeń → jedno odświeżenie folderów,
  `.git`/`node_modules` pomijane, wątek śpi, gdy nic się nie dzieje).
- Ustawienia › Projekty: lista z folderami, plikiem głównym, kolorem, podpinaniem/odłączaniem.
- Rozgrzewka silnika używa preambuły szablonów (rewizja 2 — maszyny po E0 rozgrzeją się ponownie).


## E0 Fundament — 2026-10-23

- Scaffold: Tauri 2 (sam Rust, bez sidecara) + SvelteKit 3 / Svelte 5, TS 6, Vite 8.
- Wygląd praSzczur: `tokens.css` (z praTRD + tokeny drzewa, składni i PDF), JetBrains Mono, pasek
  zakładek z ikonami (Projekt, Tablica, Notatki, Ustawienia; ⌘1–3, ⌘,), boot z logo.
- Logo i ikona aplikacji (kartka + „T” w akcencie), `icons/source.svg`.
- UI: wspólny tooltip z nazwą i skrótem (`use:tip`), DialogHost, Toasty, LoadingBar (zero animacji
  w spoczynku), Placeholder dla kolejnych etapów, Ustawienia z sekcjami i Diagnostyką.
- Rust: ścieżki danych/cache (osobne `.dev` dla trybu deweloperskiego), atomowy zapis JSON
  (uszkodzony plik → `.corrupt`), ustawienia globalne, rejestr procesów potomnych (kill przy wyjściu),
  strumieniowanie wyjścia bez pollingu.
- Silnik: Tectonic 0.17.0 jako `externalBin` (`scripts/fetch-tectonic.sh`, Linux: statyczny musl),
  rozgrzewka w tle przy pierwszym starcie z chipem postępu, test kompilacji w Ustawieniach.
- CI: `ci.yml` (svelte-check, vitest, clippy, cargo test + kompilacja Tectonic na macOS/Windows/Linux),
  `release.yml` (tag `v*.*.*` → .app.zip / .exe + .msi / .AppImage + .deb).

Pomiary (MacBook, build release): `.app` 56 MB (Tectonic 54 MB); pierwsza kompilacja na świeżym
cache 1:43, kolejne 0,3 s; rozgrzewka po instalacji 26 s (format już w cache); w spoczynku proces
Rust 27 MB / 0,0 % CPU, procesy WebKit ok. 97 MB / 0,0 % CPU.
