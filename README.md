# praTexEditOR

Desktopowy edytor LaTeX (lokalny Overleaf): projekty z wieloma folderami, drzewo plików | edytor |
PDF odświeżany automatycznie, SyncTeX w obie strony. Tauri v2 (Rust) + SvelteKit 3 / Svelte 5,
kompilacja wbudowanym Tectonic.

## Stan

E0 Fundament: powłoka aplikacji w stylu praSzczur, ustawienia, wbudowany silnik Tectonic
z rozgrzewką przy pierwszym starcie, diagnostyka (Ustawienia › O aplikacji), CI na 3 systemy.
Plan: `docs/02-plan.md`.

## Rozwój

Wymagania: Rust (stable), Node LTS, `pnpm`.

```bash
./dev.sh      # tryb deweloperski (pobiera Tectonic przy pierwszym uruchomieniu)
./build.sh    # praTexEditOR.app (macOS)
```

Instalatory na macOS, Windows i Linux buduje `.github/workflows/release.yml` po wypchnięciu tagu `v*.*.*`.
Instalatory nie są podpisane. macOS: `xattr -dr com.apple.quarantine /Applications/praTexEditOR.app`.

Dokumentacja: `docs/` (wizja, Q&A, plan, UX), `CLAUDE.md` (konwencje), `CHANGELOG.md`.
