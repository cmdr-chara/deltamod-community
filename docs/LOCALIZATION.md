<!-- SPDX-FileCopyrightText: 2026 cmdr-chara -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Interface localization

Deltamod Community supports 17 complete interface catalogs. English is the
fallback for missing translations. New implementation code and translations in
the Community social/launch/localization change were written independently;
official DeltaMod release descriptions informed the feature comparison, and
no upstream implementation was copied or adapted.

| Catalog | Language | Direction |
| --- | --- | --- |
| `en` | English | LTR |
| `it` | Italian | LTR |
| `pl` | Polish | LTR |
| `es` | Spanish | LTR |
| `fr` | French | LTR |
| `de` | German | LTR |
| `pt-br` | Brazilian Portuguese | LTR |
| `ja` | Japanese | LTR |
| `ru` | Russian | LTR |
| `zh-CN` | Simplified Chinese | LTR |
| `zh-TW` | Traditional Chinese | LTR |
| `ko` | Korean | LTR |
| `tr` | Turkish | LTR |
| `es-419` | Latin American Spanish | LTR |
| `uk` | Ukrainian | LTR |
| `th` | Thai | LTR |
| `ar` | Arabic | RTL |

## Selection and formatting

The existing saved-language preference remains compatible. A recognized saved
choice takes precedence; otherwise the first supported browser language is
used, followed by English. Regional variants map to the appropriate catalog:
Chinese script and region tags distinguish Simplified and Traditional Chinese,
Latin American Spanish regions select `es-419`, and Portuguese selects the
existing `pt-br` catalog. `pt-br` remains the persisted identifier while HTML
and Intl use the canonical `pt-BR` tag.

The formatting locale retains the browser's matching regional preference when
possible. This lets English text use British dates or Latin American Spanish
text use Mexican number formatting. Dates, counts, relative timestamps, and
plural categories use the platform's `Intl` implementation. Formatters are
cached with a bounded cache; no locale-data runtime dependency is added.

Switching language updates document `lang` and `dir`, translated text and
attributes, bound computed values, and the native menu. It does not reload the
page, repeat provider requests, replace inputs, change selected mods, or discard
typed comments. Subsequent native dialogs use the selected language. Operating
system file-picker chrome uses the operating system's own language.

## Adding or changing text

`web/langs/en/language.json` is the canonical key set. Every other language must
contain the same keys. Keep keys stable, preserve numbered placeholders exactly,
and translate complete sentences instead of concatenating grammatical pieces.
Preserve product names, game titles, file extensions, identifiers, paths, URLs,
trusted markup, and paragraph breaks. Latin American Spanish should reuse the
Spanish wording where natural, with regional wording adjusted when useful.

The small `Localization` API lives in `web/modules/localization.js` and is typed
in `web/types/localization.d.ts`:

- `t(key, fallback, ...args)` resolves a key with English fallback.
- `text(englishSource, ...args)` resolves an exact, app-owned English source.
- `bind` and `bindText` register owned text; the attribute variants register
  accessible names, titles, tooltips, and placeholders.
- `bindComputed(element, render, attribute)` updates formatted counts, dates,
  plural labels, and other derived text when the language changes.
- `number`, `date`, `relativeTime`, and `plural` use the selected locale.
- `release(root)` removes bindings for a discarded subtree. Shared alerts call
  it when they close.

Bindings replace an earlier registration for the same element property while
retaining other properties. Use callbacks in shared alerts for owned titles,
messages, and actions so an already open dialog can update. Avoid rebuilding a
view just to translate it: that would lose keyboard focus and user state.

User names, mod titles, provider comments, file paths, logs, and editable content
are not translation inputs. Generated native/provider fallbacks carry explicit
source or fallback metadata so the renderer can distinguish app-owned labels
from genuine content with the same spelling. The one-time static text helper
only matches known English catalog sources and excludes code, editable content,
and marked user content. Do not add a broad DOM mutation translator.

Native strings use the same compiled JSON catalogs through
`src-tauri/src/localization.rs`. The optional locale on the existing
`backend_invoke` envelope is validated only after the main-window authorization
check. It does not add an IPC channel or expand native permissions. Locales are
matched against a fixed allowlist, never interpreted as file paths. Native
dialog translation distinguishes trusted app text from literal renderer and
provider text. Protocol error codes remain stable and diagnostics remain literal.

## Arabic and script rendering

Arabic changes the document direction and mirrors navigation placement,
directional icons, menu alignment, and gallery keyboard navigation. Game art,
media controls, and nondirectional icons retain their orientation. Form controls
and translated dialogs can wrap and grow. User content uses directional isolation
or automatic direction; technical text and logs retain left-to-right order.
Formatted placeholder values are isolated in Arabic so paths, game titles, and
identifiers do not reorder surrounding prose.

The existing Latin display face remains in use. Local WOFF2 Noto fonts cover
Arabic shaping, Chinese, Japanese, Korean, Thai, Cyrillic, and extended Latin
characters. Material icon fonts remain separate. All font assets work offline;
no production font network request or CSP expansion is needed. A single full
pan-CJK font retains OpenType localized forms for all four CJK catalogs rather
than bundling four copies. The added font payload totals 12,783,324 bytes before
application packaging.

Source URLs, pinned revisions, source and output SHA-256 digests, character maps,
and localized-form tags are recorded in `web/commons/fonts/provenance.json`.
Licenses are distributed beside the fonts and listed in
[`legal/THIRD_PARTY_NOTICES.md`](legal/THIRD_PARTY_NOTICES.md). Reproduce the WOFF2
transport conversion with FontTools and Brotli: open the pinned source using
`TTFont(source)`, set `font.flavor = 'woff2'`, and save the
result. Do not subset glyphs or change glyph designs. FontTools timestamps and tool-version differences
can change compressed bytes; update provenance only after checking the source,
coverage, localized forms, and licenses.

## Validation

Run these checks after catalog or localization behavior changes:

```sh
npm run verify:localization
npm run typecheck
npm test
npm run test:e2e
cargo test --workspace --all-targets --locked --manifest-path src-tauri/Cargo.toml
```

The catalog check enforces the 17-language key set, no duplicate or unsafe keys,
nonempty strings, exact placeholder multisets, trusted markup, paragraph breaks,
technical tokens, strict UTF-8, normalized Unicode, and absence of hidden
directional override characters. It also validates language metadata, Intl
support, plural-category coverage, font signatures/hashes, localized CJK forms,
and glyph coverage for the catalogs.

Runtime tests cover fallback and loading failures, saved and regional locale
selection, concurrent language changes, formatting/pluralization, safe
interpolation, explicit bindings, and cleanup. Browser fixtures exercise all 17
languages, Arabic direction, mixed paths, overflowing controls, and live switching
without losing state. Shared alerts, shop interactions, patch progress, and the
vanilla launch path have focused regressions. Fixtures do not replace packaged
native validation or a real game/account smoke test; record those separately.

`PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select an already installed Chromium binary
when the pinned Playwright browser download is unavailable. The default remains
Playwright's normal managed browser. Browser fixtures serve bundled fonts from a
mocked permitted origin; production still loads the packaged local files.

## Feature compatibility

The dedicated **Launch vanilla game** action requests the existing native
restore/patch/launch transaction with an empty mod selection. It does not bypass
recovery, change a saved profile, or launch directly over patched game files.
Existing installation restrictions, including patch-only and managed-copy rules,
still apply. Progress remains native-event driven, and diagnostic output stays
bounded, inert text.

GameBanana counts distinguish unavailable data from zero. A like changes the
displayed count only after a successful provider response; failures remain
retryable. Relative comment timestamps retain an absolute date for precision,
and provider text is displayed inertly. Existing pagination and provider features
are retained.

There is no AI-generated-mod filter. Import continues to preserve optional,
unknown metadata, including AI-disclosure metadata, without changing whether the
mod is accepted. Plugin research is a separate future design effort; this change
does not add an extension runtime, Electron compatibility layer, or plugin API.
