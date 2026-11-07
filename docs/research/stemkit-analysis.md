# StemKit reference analysis

**Source inspected:** <https://github.com/danielravina/stemkit> (public `main` tree and README, inspected 2026-10-26). This is a behavior and product benchmark only; no source, assets, copy, or branding are reused by Rigged Audio.

## Evidence boundary

The README and public source tree were available. Findings below are **observed** when they cite a file or README section, **inferred** when behavior follows from several observed files, and **proposed** when it is a Rigged Audio decision. GitHub issues, release artifacts, and an installed binary were not used as implementation authority.

## User-facing feature set

Observed in `README.md` and the renderer:

- YouTube search or pasted URL ingestion.
- Local audio-file import through the native file picker.
- Instrument selection and engine choice based on requested stems.
- Local separation with vocals, drums, bass, other, and optional guitar/piano targets.
- One-click All, Karaoke, Acapella, and Drums + Bass presets.
- Per-stem mute, solo, volume, pan, seekable waveform lanes, and synchronized playback.
- Background splitting with progress events and cancellation.
- WAV export for one stem or all stems; optional AAC export through FFmpeg.
- Local library persisted under an application data directory.
- Optional thumbnail caching, YouTube video playback, update checks, and settings.
- CPU operation, Apple MPS, NVIDIA CUDA, and experimental Linux AMD ROCm paths.

## Architecture and communication

Observed source layout:

| Area            | Evidence                                      | Finding                                                                                         |
| --------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Desktop shell   | `package.json`, `src/main/index.ts`           | Electron + Vite + React + TypeScript.                                                           |
| Renderer bridge | `src/preload/index.ts`                        | Context-isolated, typed-ish `contextBridge` API over named IPC channels.                        |
| Pipeline        | `src/main/pipeline.ts`                        | Main process spawns Python/FFmpeg/yt-dlp child processes and forwards JSON progress to windows. |
| ML              | `python/separate.py`, `python/roformer.py`    | Demucs and Mel-Band Roformer Python scripts emit line-delimited JSON events.                    |
| Persistence     | `src/main/library.ts`                         | JSON library index plus per-song directories containing WAV files and pan settings.             |
| Playback        | `src/renderer/src/lib/engine.ts`              | Web Audio API creates one buffer source per stem and uses a shared anchor clock.                |
| UI              | `src/renderer/src/components/*`               | React components for sidebar, processing, player, lanes, transport, and settings.               |
| Packaging       | `electron-builder.yml`, `.github/workflows/*` | macOS DMG, Windows NSIS/ZIP, Linux AppImage/DEB; release workflow is tag-driven.                |

## Separation models and targets

Observed:

- Default hybrid path: Mel-Band Roformer for vocals plus Demucs `htdemucs` for drums/bass/other.
- Optional `htdemucs_ft` fine-tuned weights.
- Optional `htdemucs_6s` path for guitar and piano.
- `shifts` controls Demucs refinement passes.
- GPU engine installation swaps CPU PyTorch for CUDA or ROCm builds.

Inferred: model choice is encoded into a cache tag so changing effective engine settings invalidates prior outputs. The current implementation is optimized around a small fixed set of model scripts rather than a general registry.

## Input, output, and audio handling

Observed:

- Local extensions include MP3, WAV, M4A, AAC, FLAC, OGG, OPUS, WMA, AIFF, ALAC, and WEBM.
- FFmpeg converts input to stereo, 44.1 kHz, signed 16-bit WAV before inference.
- Separation outputs are expected as `<stem>.wav` files.
- WAV duration is read from RIFF chunks for local files.
- Export copies WAV or transcodes to AAC; an all-stems export also includes the mix when present.

Risk: the fixed stereo/44.1 kHz conversion is pragmatic but is a hidden transformation unless surfaced to the user. A future engine needs explicit source/output metadata and validation for offsets, length, channel layout, and clipping.

## Progress, cancellation, and failure handling

Observed:

- Progress stages are metadata, download, convert, separate, and finalize.
- Main-process jobs are tracked in a map, limited to two active separation slots, and canceled by killing the child process and deleting its song directory.
- Stderr tails are included in process errors.
- Existing output is reused when model and requested stems cover the request.
- Partial directories are removed on cancellation and model mismatches.

Gap: restart recovery is not a durable state machine. A process termination during inference leaves enough files to inspect but no persisted job record to resume safely.

## Caching, library, and downloads

Observed:

- A JSON library index stores song title, duration, timestamps, model tag, stems, and elapsed time.
- Output directories are keyed by YouTube ID or a deterministic local-file ID.
- Model/runtime downloads use `.part` files, HTTP range requests where supported, and rename-on-completion.
- Downloaded model artifacts are not described by a general catalog/checksum schema in the UI.

## Playback and waveform behavior

Observed:

- Web Audio decodes each whole stem into an `AudioBuffer`.
- Each playback start creates a source for every loaded stem at a common `AudioContext` time and offset.
- `expected()` derives position from the audio context clock; YouTube playback is periodically resynchronized against it.
- Waveform lanes render from decoded buffers in the renderer.

Inferred limitation: long files can create large renderer memory pressure because IPC transfers full WAV payloads and the UI decodes entire tracks. Rigged Audio will use bounded waveform caches and an explicit audio-buffer budget instead of making this the long-term architecture.

## Network, privacy, and security

Observed:

- Local separation is the default after setup.
- YouTube search/download uses yt-dlp and may require a JavaScript runtime.
- One anonymous install/usage ping is sent to a Cloudflare Worker unless removed or blocked.
- External URL opening is allow-listed to YouTube, the project website, and the project GitHub repository.
- The renderer does not receive unrestricted Node.js access.

Rigged Audio decision: local file processing is the MVP and telemetry is disabled by default. Online ingestion is a separate, consented, policy-reviewed adapter.

## Packaging and technical debt signals

Observed:

- First launch may download a private Python runtime, a virtual environment, PyTorch, Demucs, and optional model weights; README estimates roughly 2 GB for the base engine.
- FFmpeg is bundled or fetched by platform-specific scripts.
- macOS signing/notarization and Windows SmartScreen behavior require release configuration.
- Tests cover a small data-dir unit test, audio engine behavior, and pan persistence; CI includes smoke workflows.

Risks to carry forward:

1. Large first-run runtime and model downloads.
2. Python/PyTorch compatibility and accelerator-specific failures.
3. Full-buffer renderer memory use for long sources.
4. Network-dependent YouTube and model paths.
5. JSON persistence and cache invalidation edge cases.
6. Audio quality claims without a reference-backed evaluation set.

## Clean-room product boundary

Rigged Audio will use different product naming, interaction hierarchy, visual design, domain types, persistence layout, job protocol, and engine registry. It will begin with a deterministic local mock engine so the app can be tested without downloading weights. Real model adapters, FFmpeg decoding, and optional online ingestion remain replaceable services.
