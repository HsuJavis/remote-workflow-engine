# Vendored fonts — provenance (DES-199)

Both families ship as static WOFF2 files beside this note and `OFL.txt`, per DES-199's boundary:
fonts are vendored FILES (never `data:` URIs, never a runtime fetch to a foreign host), and the
licence travels with the binaries. All fields below were read directly off the vendored binaries'
own `name` table (nameID 0 copyright, 5 version, 14 license URL via `fontTools`) and `sha256sum` —
not transcribed from memory — so the recorded hash is the one `lookupStaticAsset` actually serves.

| file | family (embedded) | version | sha256 |
|---|---|---|---|
| `archivo-400.woff2` | Archivo SemiBold Regular | 2.001 | `07f9160163da2ec0f6376ef9d27a2bb8163f98019ba798da4baafb154e30056e` |
| `archivo-500.woff2` | Archivo SemiBold Medium | 2.001 | `ab74eca5ad115fe4cfec82ba641e5d37e4d92c58dfb1bfc1e464e9039c9d17cf` |
| `archivo-600.woff2` | Archivo SemiBold SemiBold | 2.001 | `d9e8c29fdd348edde2a4f9aae438e569dd165bbbdebda78495824a2d9aaa67e8` |
| `jetbrains-mono-400.woff2` | JetBrains Mono Regular | 2.211 | `14425ba9c695763c1547f48a206b7aa60350a33ae23de09f0407877f3fcd89eb` |
| `jetbrains-mono-500.woff2` | JetBrains Mono Medium | 2.211 | `cb182feeed4d798ff6961d3c79f7026279448fca0676438aaecb21f3fc39553a` |

- **Upstream:** Archivo — https://github.com/Omnibus-Type/Archivo · JetBrains Mono —
  https://github.com/JetBrains/JetBrainsMono. Both are distributed by Google Fonts under the SIL
  Open Font License 1.1; `OFL.txt` in this directory is the unmodified licence body (both
  families' preamble copyright lines, one shared OFL 1.1 body — the two upstream `OFL.txt` files
  are byte-identical past their copyright line, confirmed by diff against each repo's own
  `OFL.txt`).
- **Subset:** each file carries ~230 codepoints spanning `U+000D`–`U+FEFF` (Basic Latin +
  Latin-1 Supplement + General Punctuation + the `U+FEFF` BOM/ZWNBSP) — consistent with Google
  Fonts' "latin" unicode-range subset. No Han/CJK glyphs are present; zh-TW UI text falls through
  to the CSS fallback stack declared on every `@font-face` (DES-199), which is expected — these
  faces cover the Latin UI chrome only.
- **Vendoring date/actor:** unrecorded — the woff2 bytes landed in commit `f86ea25` ("Gate 6
  partial — src/dashboard/ lands (23 files, vendored fonts)") without this note; this task backfills
  the provenance for bytes that were already on disk. The sha256 above is measured against those
  same bytes (`git show f86ea25:src/dashboard/fonts/<file> | sha256sum` matches the table), so no
  byte moved between vendoring and this record.
- **Naming note (surfaced, not fixed here):** the embedded family name for all three "archivo-*"
  files is **"Archivo SemiBold"**, not base "Archivo" — i.e. `archivo-400/500/600.woff2` are the
  Regular/Medium/SemiBold static instances *within* Archivo's SemiBold width/weight group, not
  Archivo's own Regular/Medium/SemiBold weights. Whether that is the intended REQ-131 typographic
  choice or a subsetting mistake at vendoring time is outside TASK-204's DoD (registration + cache
  policy only) and is flagged here for the design/product owner rather than silently corrected.
