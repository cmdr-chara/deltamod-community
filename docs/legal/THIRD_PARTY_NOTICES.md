# Third-party notices

Deltamod Community includes third-party software. Each component remains under
its own license.

## G3MTool

- Project: [y114git/G3MTool](https://github.com/y114git/G3MTool)
- Pinned release: [CLI 1.3.0](https://github.com/y114git/G3MTool/releases/tag/2026.09.12) (tag `2026.09.12`)
- Pinned source revision: `3a6bf08b98b700873636ebe9fab186e2d5121b4a`
- License: GPL-3.0-only

The unmodified G3MTool release files bundled with Deltamod Community include
their `LICENSE`, `THIRD_PARTY_NOTICES.md`, `SECURITY.md`, and `licenses`
directory. Every Deltamod Community release also provides the exact
corresponding G3MTool source archive alongside the application installers.

G3MTool is a separate executable invoked by Deltamod Community. Its GPL license
does not replace the EUPL-1.2 license covering Deltamod Community.

## UndertaleModTool CLI

- Project: [UnderminersTeam/UndertaleModTool](https://github.com/UnderminersTeam/UndertaleModTool)
- Pinned release: [0.9.1.2](https://github.com/UnderminersTeam/UndertaleModTool/releases/tag/0.9.1.2)
- Pinned source revision: `3eba065fdf70712fba0a33b6fafa7539588d0906`
- License: GPL-3.0-only

The unmodified UndertaleModTool CLI release is bundled to execute explicitly
approved `.csx` mod patches. Its release archive includes `LICENSE.txt`.
Deltamod Community releases provide the exact corresponding UndertaleModTool
source archive beside the installers. UndertaleModTool CLI remains a separate
process under GPL-3.0-only; Deltamod Community remains under EUPL-1.2.
## butler

Deltamod Community packages butler 15.30.0 from https://broth.itch.zone/butler.
butler is Copyright itch.io contributors and is distributed under the MIT License.
Source: https://github.com/itchio/butler

## Noto interface fonts

The application bundles Noto Sans, Noto Sans Arabic, Noto Sans Thai, and Noto
Sans CJK to render supported scripts without a network connection. These font
assets are third-party material under the SIL Open Font License 1.1; they are
not claimed as Community-original code.

- Noto Sans CJK: [notofonts/noto-cjk](https://github.com/notofonts/noto-cjk),
  revision `f8d157532fbfaeda587e826d4cd5b21a49186f7c`.
- Noto Sans, Arabic, and Thai: [google/fonts](https://github.com/google/fonts),
  revision `9862abc066c9b83bf84c3e8ed1fc2d8d48f9bbf0`.
- The four complete license notices, source URLs, SHA-256 digests, and glyph
  coverage records are included in [`web/commons/fonts`](../../web/commons/fonts).

The source fonts were converted to WOFF2 transport format without subsetting or
changing glyph designs. Noto Sans CJK retains its Japanese, Korean, Simplified
Chinese, and Traditional Chinese localized forms. Font licensing does not
replace the EUPL-1.2 license covering Deltamod Community code.
