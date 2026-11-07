# Rigged Audio

A local desktop app that splits a song into six stems (vocals, drums, bass, guitar, piano, other) with the open-source Demucs AI model, then lets you mix and export them. No account, subscription or API key.

**Workflow:** import or search a song → preview → separate → mix → export.

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

## Requirements

- Windows 10/11 x64, macOS 12+ (Intel or Apple Silicon), or Linux x64/arm64
- 8 GB of free disk for setup. 8 GB of RAM or more is recommended.
- Playback holds every stem in memory, about 2.5 GB for a 20-minute song.

CPU separation took about twice the song's length on a 2-core ARM server. GPU speed has not been measured for this app yet.

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

Build each platform on that platform:

```bash
npm run dist:win    # Windows portable .exe
npm run dist:mac    # macOS Intel + Apple Silicon DMG and ZIP
npm run dist:linux  # Linux x64 AppImage
```

Output goes to `release/` with a `SHA256SUMS-<platform>.txt`. Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds all three on native runners and publishes them. Builds are unsigned by default, so Windows SmartScreen and macOS Gatekeeper will warn until signing credentials are added.

The installers stay around 120 MB because PyTorch is installed on first run instead of being bundled, which is also how the right GPU build gets selected.

## Credits

[Demucs](https://github.com/adefossez/demucs) (MIT), [PyTorch](https://pytorch.org), [uv](https://github.com/astral-sh/uv), [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [FFmpeg](https://ffmpeg.org) via `imageio-ffmpeg`. These are downloaded at setup under their own licences, not redistributed in the installer.
