<p align="center">
  <img src="./web/img/gblogo-outline.png" width="360" alt="Deltamod Community">
</p>

<h1 align="center">Deltamod Community</h1>

<p align="center">
  <strong>Install, organize, and launch GameMaker mods without juggling game files.</strong><br>
  A community-built mod manager for DELTARUNE, UNDERTALE, and other supported games.
</p>

<p align="center">
  <a href="https://github.com/cmdr-chara/deltamod-community/releases/latest"><img alt="Latest stable release" src="https://img.shields.io/github/v/release/cmdr-chara/deltamod-community?style=for-the-badge&amp;label=stable&amp;color=7c5cff"></a>
  <a href="https://github.com/cmdr-chara/deltamod-community/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/cmdr-chara/deltamod-community/total?style=for-the-badge&amp;color=ef476f"></a>
  <a href="./LICENSE.txt"><img alt="License: EUPL 1.2" src="https://img.shields.io/badge/license-EUPL--1.2-4c8bf5?style=for-the-badge"></a>
</p>

<p align="center">
  <a href="https://github.com/cmdr-chara/deltamod-community/releases/latest"><strong>Download the latest release</strong></a>
  &nbsp;•&nbsp;
  <a href="#get-started">Get started</a>
  &nbsp;•&nbsp;
  <a href="#supported-games-and-platforms">Compatibility</a>
  &nbsp;•&nbsp;
  <a href="./.github/SUPPORT.md">Get help</a>
</p>

<p align="center">
  <img src="./docs/assets/thumbnail.png" alt="Deltamod Community artwork">
</p>

## What's new in 2.1.0

- **Improved macOS mod support.** Use a managed copy of the game and matching Windows reference files for supported xdelta patches. See [Patching on macOS](#patching-on-macos).
- **More robust mod import and patching.** Stronger validation, staging, rollback, and recovery across the native runtime.
- **More reliable mod browsing.** Improvements to provider shop handling, GameBanana comments, and UI localization.
- **Dependency and security updates.** Refreshed React, Tauri, Vite, Vitest, Playwright, Rust dependencies, and CI actions, including high-severity npm audit remediations.

CSX script mods are currently unavailable in the native desktop app on every platform. Use xdelta/G3M patches or file replacements. macOS mods targeting Windows `data.win` require matching Windows reference files.

## Why Deltamod Community?

Deltamod Community keeps each mod setup organized and gives you a safer path back when an installation goes wrong.

- **Find mods in one place.** Browse compatible content from GameBanana, ModDB, and Nexus Mods, or import a local archive.
- **Keep setups separate.** Use installations, profiles, and collections instead of repeatedly moving game files by hand.
- **Patch with recovery in mind.** Supported operations use staging, verification, and rollback paths before publishing changes to a game installation.
- **Understand what is installed.** Inspect mod health, versions, files, conflicts, and operation history from the Installed Mods view.
- **Use the platform you already have.** Native packages are available for Windows, Linux, Intel Mac, and Apple Silicon Mac.

You do **not** need Node.js, Rust, Git, or other development tools to use the app.

## Download

Get the newest **published stable** build from [GitHub Releases](https://github.com/cmdr-chara/deltamod-community/releases/latest). The release page, not a hardcoded version badge, is authoritative for available installers. For the **2.1.0 minor release**, see [What's new](#whats-new-in-210). Stable installer availability is subject to the release gates in [RELEASE-GATE.md](./docs/RELEASE-GATE.md).

| Your computer | Asset in the stable release |
| --- | --- |
| Windows x64 (Intel or AMD) | `Deltamod.Community.Setup.exe` |
| macOS Apple Silicon (M1 or newer) | `Deltamod.Community_<version>_aarch64.dmg` |
| macOS Intel | `Deltamod.Community_<version>_x64.dmg` |
| Debian/Ubuntu/Linux Mint x64 | `Deltamod.Community_<version>_amd64.deb` |

Replace `<version>` with the version displayed in the selected release. Windows uses a version-independent branded installer name.

<p align="center">
  <a href="https://github.com/cmdr-chara/deltamod-community/releases/latest">
    <img alt="Download the latest stable Deltamod Community" src="https://img.shields.io/badge/DOWNLOAD-latest%20stable-ef476f?style=for-the-badge&amp;logo=github">
  </a>
</p>

> [!TIP]
> Most players need only one `.exe`, `.dmg`, or `.deb`. The `.json` evidence files, updater signatures, checksum manifests, tool-source archives, and GitHub-generated source archives are not installers. Preview builds are separate prereleases and are not served by the stable updater.

> [!WARNING]
> Stable Windows and macOS **updater packages** use mandatory Tauri updater signatures, but there is no Authenticode publisher certificate, Apple Developer ID signature, or macOS notarization. Windows SmartScreen and macOS Gatekeeper warnings may appear. Verify `SHA256SUMS.txt` and available GitHub attestations. A checksum verifies file integrity, not publisher identity. Linux `.deb` updates are manual.

<details>
<summary><strong>Installation and checksum help</strong></summary>

### Windows

1. Download `Deltamod.Community.Setup.exe` from the latest stable release.
2. Compare its SHA-256 digest to the entry in `SHA256SUMS.txt`.
3. Run the installer and open **Deltamod Community**.

Windows SmartScreen may show **Windows protected your PC**. After verifying the download, choose **More info → Run anyway** only if you decide to proceed.

### macOS

1. Check **Apple menu → About This Mac** to determine your Mac's processor.
2. Download the matching DMG and verify its hash against `SHA256SUMS.txt`.
3. Open the DMG and move **Deltamod Community** to Applications.

If Gatekeeper blocks the verified app, try opening it once, then use **System Settings → Privacy & Security → Open Anyway**. Do not disable Gatekeeper globally.

### Linux

Download the Debian package into a directory containing no other matching installers. Use your graphical package manager, or:

```console
sudo apt install ./Deltamod.Community_*_amd64.deb
```

### Verify a checksum

| System | Command |
| --- | --- |
| Windows PowerShell | `Get-FileHash -Algorithm SHA256 -LiteralPath '.\Deltamod.Community.Setup.exe'` |
| macOS Apple Silicon | `shasum -a 256 Deltamod.Community_*_aarch64.dmg` |
| macOS Intel | `shasum -a 256 Deltamod.Community_*_x64.dmg` |
| Linux x64 | `sha256sum Deltamod.Community_*_amd64.deb` |

Compare the digest against the entry for the exact filename. If it does not match, delete and download the installer again.

</details>

## Get started

1. Open Deltamod Community and add your game installation.
2. Browse the Mod Shop or import a compatible mod archive.
3. Install the mod and choose the profile or collection where it belongs.
4. Review compatibility or conflict information, then patch and launch the game.
5. Keep separate profiles for mods or game versions that should not be combined.

Always check the mod author's compatibility notes. A supported game does not mean every mod supports every version of that game.

## See it in action

### Discover and install mods

<p align="center">
  <img src="./docs/assets/readme/deltamod-mod-shop.gif" width="960" alt="Deltamod Community browsing mods and following import progress">
</p>

### Manage separate setups

<p align="center">
  <img src="./docs/assets/readme/deltamod-app-tour.gif" width="960" alt="Deltamod Community navigating installed mods, installations, and collections">
</p>

<details>
<summary><strong>Personalize the app</strong></summary>

<p align="center">
  <img src="./docs/assets/readme/deltamod-personalization.gif" width="960" alt="Selecting a Deltamod theme and changing the interface language">
</p>

Deltamod Community includes community themes and 17 interface languages:
English, Italian, Polish, Spanish, French, German, Brazilian Portuguese,
Japanese, Russian, Simplified Chinese, Traditional Chinese, Korean, Turkish,
Latin American Spanish, Ukrainian, Thai, and Arabic. Language changes apply
without restarting, with regional date and number formatting and right-to-left
layout for Arabic. See the [localization guide](./docs/LOCALIZATION.md).

</details>

## Supported games and platforms

| Game | Support |
| --- | :---: |
| DELTARUNE | ✅ |
| DELTARUNE Demo | ✅ |
| DELTARUNE Demo (LTS) | ✅ |
| UNDERTALE | ✅ |
| Undertale Yellow | ✅ |
| Pizza Tower | ✅ |

| Platform | Status | Notes |
| --- | :---: | --- |
| Windows x64 | **Stable** | Recommended platform |
| Linux x64 | **Experimental** | Official package targets Debian-based distributions |
| macOS Apple Silicon | **Experimental** | Native app; xdelta/G3M patches need Windows reference files; `.csx` patches are unavailable |
| macOS Intel | **Experimental** | Native app; xdelta/G3M patches need Windows reference files |
| Wine / CrossOver | **Unofficial** | May work, but is not a release target |

**Patch formats:** the native desktop app supports file replacements and xdelta/G3M patches. **UndertaleModTool `.csx` script mods are currently unavailable on all platforms.** The app rejects these mods before applying them or launching the game; use an xdelta/G3M or file-replacement edition when available. Bundling the upstream CLI on Windows x64, Linux x64, and Intel Macs does not enable CSX execution in the app. The upstream CLI is also unavailable for Apple Silicon.

### Patching on macOS

- **Managed copy.** When you add DELTARUNE on a Mac, Deltamod copies only `DELTARUNE.app` into its own data folder and patches that copy. The game in `/Applications` is never changed, and Deltamod refuses to patch an installation that points at it.
- **Windows reference files.** Most DELTARUNE mods are xdelta patches made against the Windows `data.win`. The Mac `game.ios` files are packed differently, so those patches do not apply to them directly. Under **Options → Installation → Windows reference files**, choose a Windows copy of the same game version once. Deltamod applies mods to those `data.win` files with G3MTool and installs the result in the copy as `game.ios`. Mods that only replace files, such as music, do not need them.
- **Game-version checks.** For a mod's reference-backed patch targets, required-file checks use the Windows reference copy. Other required files are checked in the managed game copy. A missing, unsafe, or mismatching reference file still blocks the mod when hash checks are enabled.
- **Re-signing.** Changing files inside an app bundle breaks its signature, so Deltamod clears the quarantine flag on the copy and ad-hoc re-signs it with `codesign` after every patch and restore.
- **Saves are shared.** The copy and the original game both use `~/Library/Application Support/com.tobyfox.deltarune`. Back up your saves before trying new mods.

Options → Mac explains the same steps inside the app.

## Mod sources

| Source | How it works |
| --- | --- |
| **GameBanana** | Browse supported catalogue entries inside Deltamod |
| **ModDB** | Browse listings and open compatible downloads |
| **Nexus Mods** | Sign in from **Options → Nexus Mods** to browse Nexus content |
| **Local archive** | Import a compatible archive you already downloaded |

Nexus Premium members can download compatible archives through the API. Nexus may require non-Premium members to confirm a download on its website and then import the downloaded archive. GameBanana, ModDB, and local imports do not require a Nexus account.

## Play safely

- Back up important saves and game files before experimenting.
- Use mods from authors and sources you trust.
- Check that each mod supports your exact game version.
- Avoid combining mods unless their authors say they are compatible.
- CSX patches contain executable scripts. The native app currently refuses them; importing an archive does not enable script execution.

Deltamod adds validation, staging, and recovery around supported operations, but these safeguards do not replace your own backup.

## Help and contributing

- Read [SUPPORT.md](./.github/SUPPORT.md) or [open a bug report](https://github.com/cmdr-chara/deltamod-community/issues/new/choose).
- Read [CONTRIBUTING.md](./.github/CONTRIBUTING.md) before proposing a change.
- Report security vulnerabilities privately by following [SECURITY.md](./.github/SECURITY.md).

Never upload copyrighted game files, passwords, tokens, or other private data when requesting help.

<details>
<summary><strong>Developer setup</strong></summary>

Development is Tauri-only and requires Node.js 22, Rust, and the platform prerequisites for [Tauri](https://v2.tauri.app/start/prerequisites/). `npm run dev` stages the native workers and verified tools before starting Tauri. There is no Electron fallback.

```console
git clone https://github.com/cmdr-chara/deltamod-community.git
cd deltamod-community
npm ci
npm run acquire:g3mtool
# Windows, Linux and Intel macOS only:
npm run acquire:undertale-mod-tool
npm run dev
```

On Apple Silicon, skip the UndertaleModTool acquisition command. CSX is explicitly
unavailable there; G3MTool remains supported. Tool downloads are pinned and verified,
not installed by `npm ci`.

`npm run build:tauri` creates NSIS on Windows, a `.deb` on Linux, and app/DMG bundles
on macOS. To select another supported architecture on the same operating system,
set `TAURI_BUILD_TARGET` before the **whole** npm command so tool/worker staging and
the Tauri CLI agree. Install that Rust target first. Do not pass `--target` after
`npm run build:tauri`; the wrapper rejects it rather than package mismatched sidecars.
Use `npm run build:tauri:no-bundle` to compile without an installer.

Common checks:

```console
npm test
npm run typecheck
npm run security:audit
```

### Nexus integration contract

Deltamod uses **OAuth 2.0 Authorization Code with PKCE S256** for Nexus Mods sign-in. The registered loopback callback is fixed at `http://127.0.0.1:52817/callback`; the client **never falls back to a dynamic port**.

Nexus catalogue browsing uses a **bounded result page** of 50 items and fetches only the requested page. Quota handling honors `Retry-After` and quota reset metadata so requests can pause and retry instead of repeatedly hitting the API while limited.

See [CONTRIBUTING.md](./.github/CONTRIBUTING.md) for native checks and [RELEASE-GATE.md](./docs/RELEASE-GATE.md) for release requirements.

</details>

## About this community fork

Deltamod Community is an independent, community-maintained fork of Deltamod. It continues development across the application, native layer, recovery model, tests, and release system while supporting lawful creative expression and community safety.

The project is not affiliated with or endorsed by Toby Fox. Patching uses [G3MTool](https://github.com/y114git/G3MTool) and the [UndertaleModTool CLI](https://github.com/UnderminersTeam/UndertaleModTool).

## License and attribution

Deltamod Community is licensed under the [European Union Public Licence 1.2](./LICENSE.txt). Attribution, ownership boundaries, provenance, and bundled third-party software are documented in [NOTICE.md](./docs/legal/NOTICE.md), [COPYRIGHT.md](./docs/legal/COPYRIGHT.md), [PROVENANCE.md](./docs/legal/PROVENANCE.md), and [THIRD_PARTY_NOTICES.md](./docs/legal/THIRD_PARTY_NOTICES.md).

---

<p align="center">
  Made with <span aria-label="determination">❤️</span> by the Deltamod community.<br>
  <sub>An independent fan project. Not affiliated with or endorsed by Toby Fox.</sub>
</p>
