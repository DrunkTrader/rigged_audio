<p align="center">
  <img src="assets/rigged_audio_logo_without_bg.png" alt="Rigged Audio" width="100" />
</p>

# Rigged Audio

A local desktop app that splits a song into six stems (vocals, drums, bass, guitar, piano, other) with the open-source Demucs AI model, then lets you mix and export them. No account, subscription or API key.

**Workflow:** import or search a song → preview → separate → mix → export.

![The stem workspace in the light theme: the YouTube video synced to the mix, export options, transport with presets, and per-stem lanes](assets/screenshots/workspace-light.png)

![Adding a song from YouTube in the dark theme](assets/screenshots/youtube-import-dark.png)

## Features

- Import MP3, WAV, FLAC, M4A, OGG and more, up to 20 minutes
- Real separation with Demucs `htdemucs_6s`, on NVIDIA, AMD (Linux) or Apple GPUs where available, otherwise CPU
- Progress, cancellation, and restart recovery; inference runs in its own process
- Six-lane mixer: waveforms, click or drag to seek, mute, solo, per-stem play, volume, master
- All stems share one audio clock, so they cannot drift; the YouTube video follows that clock
- Dark and light themes
- Presets: All Stems, Karaoke, Acapella, Drums + Bass
- Export single stems, all stems, or the current mix as 16-bit, 24-bit or 32-bit float WAV, at the original rate, 44.1 kHz or 48 kHz
- Optional YouTube search and download (see below)

Keyboard: Space plays and pauses, Left and Right skip 5 seconds, 1 to 6 mute a stem.

## Internet use

| When                       | What needs the network                                                  |
| -------------------------- | ----------------------------------------------------------------------- |
| First run, once            | Installer, private Python, PyTorch, Demucs, the 53 MB model (1 to 3 GB) |
| Separating, mixing, export | Nothing. Inference runs with Hugging Face forced offline.               |
| YouTube features           | YouTube itself, only when you use them                                  |

Your audio is never uploaded.

## YouTube

Search and download use [yt-dlp](https://github.com/yt-dlp/yt-dlp). This is the only route that needs no API key, and it has real limits:

- **Terms.** YouTube's Terms of Service restrict downloading without permission. The feature is opt-in behind a notice. Use it only for content you own or have rights to. You are responsible for your use. If you plan to distribute this app publicly, get legal advice about this feature first.
- **Reliability.** YouTube can refuse connections, especially from cloud and VPN addresses, and it changes often. The app explains a refusal and offers "Update YouTube support", which updates yt-dlp only.
- **Video.** Only the best audio stream is downloaded. The video plays in YouTube's own embedded player, muted and kept in time with the stem mix. YouTube rejects embeds that send no HTTP referrer (error 153), so the app identifies itself as `https://com.riggedaudio.desktop/` on embed requests only.
- The official YouTube Data API is not used: it needs a key, and its policies restrict separating audio from video.

## Install

Download from [Releases](https://github.com/DrunkTrader/rigged_audio/releases). Each release lists a `SHA256SUMS.txt` to verify downloads.

| Platform                | File                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| Windows 10/11 x64       | `Rigged-Audio-<version>-Windows-x64-Setup.exe` (installer), or `-Portable.exe` (no install) |
| macOS 12+ Apple Silicon | `Rigged-Audio-<version>-macOS-arm64.dmg`                                                    |
| macOS 12+ Intel         | `Rigged-Audio-<version>-macOS-x64.dmg`                                                      |
| Linux x64               | `Rigged-Audio-<version>-Linux-x86_64.AppImage`, or `rigged-audio_<version>_amd64.deb`       |

**Windows.** Run the Setup file. It asks whether to install for you or for everyone and lets you pick the folder, then adds Start Menu and Desktop shortcuts. Windows SmartScreen will say "Windows protected your PC" because the installer is not code-signed yet: choose **More info → Run anyway**.

**macOS.** Open the DMG and drag Rigged Audio to Applications. The app is not notarized by Apple yet, so the first launch is blocked: Control-click the app, choose **Open**, then **Open** again (on macOS 15, allow it under System Settings → Privacy & Security). If macOS says the app "is damaged", run `xattr -dr com.apple.quarantine "/Applications/Rigged Audio.app"`.

**Linux.** Either `chmod +x Rigged-Audio-*.AppImage` and run it (AppImages need FUSE 2: `sudo apt install libfuse2t64` on Ubuntu 24.04, `libfuse2` before), or install the package with `sudo apt install ./rigged-audio_*_amd64.deb`, which adds a menu entry and installs to `/opt/Rigged Audio`.

### First run

The installer holds only the app (about 100–125 MB). The first launch shows a setup screen that downloads the separation engine into your user folder: a private Python, PyTorch, Demucs, the 53 MB model, FFmpeg and yt-dlp. That is about 1 GB, or about 3 GB with an NVIDIA GPU, and takes a few minutes. It needs an internet connection once. After it, separation works offline. Nothing is installed system-wide and no Python is needed on your computer.

### Requirements

- Windows 10/11 x64, macOS 12+ (Intel or Apple Silicon), or a 64-bit Linux desktop with glibc 2.35+ (Ubuntu 22.04 or newer).
- 8 GB of free disk for setup. 8 GB of RAM or more is recommended.
- Playback holds every stem in memory, about 2.5 GB for a 20-minute song.
- Optional: an NVIDIA GPU (Windows, Linux), an AMD GPU with ROCm (Linux) or Apple Silicon for faster separation. Everything also runs on CPU.

CPU separation took about twice the song's length on a 2-core ARM server. GPU speed has not been measured for this app yet.

### Your data, updates and uninstalling

Your library, stems and the separation engine live in your user folder, not next to the app:

| Platform | Folder                                                    |
| -------- | --------------------------------------------------------- |
| Windows  | `%APPDATA%\rigged-audio\rigged-audio`                     |
| macOS    | `~/Library/Application Support/rigged-audio/rigged-audio` |
| Linux    | `~/.config/rigged-audio/rigged-audio`                     |

Installing a newer version over an older one keeps this folder, so songs and the 1–3 GB engine are not downloaded again. Uninstalling also keeps it; delete the folder yourself to free the space. Builds run from source (`npm run dev`) use the same folder.

## Run from source

Requires Node.js 22 or later. Python is not needed: the app installs its own on first run.

```bash
npm install
npm run dev         # build, then launch
npm test
npm run typecheck
```

Set `RIGGED_AUDIO_DATA_DIR=/tmp/rigged` to use a throwaway data folder.

## Build installers

Build each platform on that platform (the Windows installer needs Windows, or Wine on x64 Linux):

```bash
npm run dist:win     # Windows x64: NSIS Setup.exe and Portable.exe
npm run dist:mac     # macOS Intel + Apple Silicon: DMG and ZIP
npm run dist:linux   # Linux x64: AppImage and .deb
npm run release:check -- --artifacts   # check the installers, checksums and what was packaged
```

Output goes to `release/` with a `SHA256SUMS-<platform>.txt`. The installers stay around 100–125 MB because PyTorch is installed on first run instead of being bundled, which is also how the right GPU build gets selected.

**Unsigned builds.** No signing certificates are configured, so Windows builds are unsigned and macOS builds are ad-hoc signed and not notarized; users see the warnings described under [Install](#install). To sign, add the electron-builder signing secrets (`CSC_LINK`/`CSC_KEY_PASSWORD`, plus `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` for notarization) to the repository and to the release workflow.

## Publishing a release

`.github/workflows/release.yml` builds Windows, macOS and Linux on native GitHub runners, runs typecheck and tests on each, checks every installer, and publishes a GitHub Release with generated notes and `SHA256SUMS.txt`.

1. Set the new version: `npm version 0.2.0 --no-git-tag-version` (updates `package.json` and `package-lock.json`).
2. Commit it and merge to `main`.
3. Tag that commit and push the tag:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

The workflow refuses a tag that differs from `package.json` (`v0.2.0` ↔ `0.2.0`). A tag with a suffix such as `v0.2.0-beta.1` publishes a pre-release. To test the build without publishing, run the workflow manually from the Actions tab ("Run workflow"): the installers are attached to the run, not released.

## License

Rigged Audio is free software, licensed under the [GNU General Public License v3.0](LICENSE). You may use, study, share and modify it; if you distribute it or a modified version, you must do so under the same license and make the source available.

## Credits

[Demucs](https://github.com/adefossez/demucs) (MIT), [PyTorch](https://pytorch.org), [uv](https://github.com/astral-sh/uv), [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [FFmpeg](https://ffmpeg.org) via `imageio-ffmpeg`. These are downloaded at setup under their own licences, not redistributed in the installer.
