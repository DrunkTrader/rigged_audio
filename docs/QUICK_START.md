# Quick start

From download to your first separated song in a few minutes.

## 1. Download

Get the latest version from [Releases](https://github.com/DrunkTrader/rigged_audio/releases).

| Your computer          | Download                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| Windows 10/11 (64-bit) | `Rigged-Audio-<version>-Windows-x64-Setup.exe` (installer), or `-Portable.exe` (no install) |
| Mac with Apple Silicon | `Rigged-Audio-<version>-macOS-arm64.dmg`                                                    |
| Mac with Intel         | `Rigged-Audio-<version>-macOS-x64.dmg`                                                      |
| Linux (64-bit)         | `Rigged-Audio-<version>-Linux-x86_64.AppImage`, or `rigged-audio_<version>_amd64.deb`       |

Each release has a `SHA256SUMS.txt` if you want to verify the download.

## 2. Install

The installers are not code-signed yet, so your system will warn you the first time. This is expected.

**Windows.** Run the Setup file. Choose whether to install for you or everyone, and where; it adds Start Menu and Desktop shortcuts. If SmartScreen says "Windows protected your PC", choose **More info → Run anyway**.

**macOS.** Open the DMG and drag Rigged Audio to Applications. The first launch is blocked because the app is not notarized by Apple: Control-click the app, choose **Open**, then **Open** again. On macOS 15, allow it under **System Settings → Privacy & Security** instead. If macOS says the app "is damaged", run:

```bash
xattr -dr com.apple.quarantine "/Applications/Rigged Audio.app"
```

**Linux.** Install the `.deb` with `sudo apt install ./rigged-audio_*_amd64.deb` (adds a menu entry), or make the AppImage executable and run it:

```bash
chmod +x Rigged-Audio-*.AppImage
./Rigged-Audio-*.AppImage
```

AppImages need FUSE 2: `sudo apt install libfuse2t64` on Ubuntu 24.04, `libfuse2` on older versions.

## 3. First run

The installer holds only the app (about 100–125 MB). On first launch, Rigged Audio shows a setup screen that downloads its separation engine: a private Python, PyTorch, the Demucs AI model, FFmpeg and yt-dlp. That is about 1 GB (about 3 GB with an NVIDIA GPU) and takes a few minutes.

You need an internet connection once, for this step. Nothing is installed system-wide, and you don't need Python on your computer. After setup, separation works offline.

## 4. Split a song

1. **Add a song.** Drop an audio file on the window or choose **Choose a file** (MP3, WAV, FLAC, M4A, OGG and more, up to 20 minutes), or use the **YouTube** tab.
2. **Separate.** Choose **Separate into 6 stems**. On a CPU this takes roughly twice the song's length; a GPU is much faster.
3. **Mix.** Each stem gets its own lane with a waveform, volume, **M**ute and **S**olo. Presets switch common mixes in one click: **All Stems**, **Karaoke** (no vocals), **Acapella** (vocals only) and **Drums + Bass**. Click or drag on any waveform to seek.
4. **Export.** **Export all stems**, **Export mix** (exactly what you hear), or the download button on a single lane. Choose 16-bit, 24-bit or 32-bit float WAV at the original rate, 44.1 kHz or 48 kHz.

**Keyboard:** <kbd>Space</kbd> plays and pauses, <kbd>←</kbd> <kbd>→</kbd> skip 5 seconds, <kbd>1</kbd>–<kbd>6</kbd> mute a stem. The sun and moon button in the sidebar switches between dark and light themes.

## YouTube

You can search YouTube or paste a link. Rigged Audio downloads the best audio stream for separating, and plays the video in YouTube's own player, muted and in time with your mix. It uses [yt-dlp](https://github.com/yt-dlp/yt-dlp), so no account or API key is needed.

- **Only use content you own or have permission to use.** YouTube's Terms of Service restrict downloading, so the feature is off until you accept a notice, and you are responsible for how you use it.
- YouTube sometimes refuses connections, especially from VPNs and cloud servers, and it changes often. If a download fails, choose **Update YouTube support**, which updates yt-dlp.

## Privacy and internet use

Your audio is never uploaded. The network is used only for:

| When                          | What                                             |
| ----------------------------- | ------------------------------------------------ |
| First run, once               | Downloading the separation engine (1–3 GB)       |
| Separating, mixing, exporting | Nothing: all processing happens on your computer |
| YouTube features              | YouTube itself, only when you use them           |

## System requirements

- Windows 10/11 x64, macOS 12+ (Intel or Apple Silicon), or 64-bit Linux with glibc 2.35+ (Ubuntu 22.04 or newer).
- 8 GB of free disk space for setup, and 8 GB of RAM or more.
- Optional for faster separation: an NVIDIA GPU (Windows, Linux), an AMD GPU with ROCm (Linux) or Apple Silicon. Everything also runs on the CPU.

Playback keeps every stem in memory, about 2.5 GB for a 20-minute song.

## Your data, updates and uninstalling

Your library, stems and the separation engine are stored in your user folder:

| System  | Folder                                                    |
| ------- | --------------------------------------------------------- |
| Windows | `%APPDATA%\rigged-audio\rigged-audio`                     |
| macOS   | `~/Library/Application Support/rigged-audio/rigged-audio` |
| Linux   | `~/.config/rigged-audio/rigged-audio`                     |

Installing a newer version keeps this folder, so your songs and the engine are not downloaded again. Uninstalling also keeps it: delete the folder yourself to free the space.

## Troubleshooting

- **Setup failed or was interrupted.** Open the app again and choose **Try again**; it resumes cleanly. Make sure you have 8 GB free and a working connection.
- **Setup says it needs 8 GB of free disk.** Free some space, then reopen the app.
- **Separation is slow.** Without a supported GPU it runs on the CPU; it still works, just slower. The sidebar shows which one is in use ("Engine ready · CPU" or "· CUDA").
- **Something else.** [Open an issue](https://github.com/DrunkTrader/rigged_audio/issues) with your system, the app version and what you did. Logs are in `logs/app.jsonl` inside the data folder above.
