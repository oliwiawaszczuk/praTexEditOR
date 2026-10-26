# praTexEditOR

Desktopowy edytor LaTeX (lokalny Overleaf): projekty z wieloma folderami, drzewo plików | edytor |
PDF odświeżany automatycznie, SyncTeX w obie strony. Tauri v2 (Rust) + SvelteKit 3 / Svelte 5,
kompilacja wbudowanym Tectonic.

## Stan

Wersja 0.1: projekty z wieloma folderami, edytor CodeMirror 6, auto-kompilacja (Tectonic /
latexmk), PDF z SyncTeX i ciemnym podglądem, snippety i paleta komend, indeks projektu
(outline, `\ref`, `\cite`), Notatki, Tablica i szablony. Bez AI.
Plan: `docs/02-plan.md`. Pomiary wydajności: `scripts/bench/gen-project.sh` generuje projekt
syntetyczny (~200 stron, 100 obrazów).

## Rozwój

Wymagania: Rust (stable), Node LTS, `pnpm`.

```bash
./dev.sh      # tryb deweloperski (pobiera Tectonic przy pierwszym uruchomieniu)
./build.sh    # praTexEditOR.app (macOS)
```

Instalatory na macOS, Windows i Linux buduje `.github/workflows/release.yml` po wypchnięciu tagu `v*.*.*`.
Instalatory nie są podpisane. macOS: `xattr -dr com.apple.quarantine /Applications/praTexEditOR.app`.

Dokumentacja: `docs/` (wizja, Q&A, plan, UX), `CLAUDE.md` (konwencje), `CHANGELOG.md`.
