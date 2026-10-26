# Rigged Audio

Rigged Audio is a local-first desktop workspace for turning a mixed recording into independently playable stems.

## Current slice

The working vertical slice supports:

- PCM WAV import by picker or drag/drop
- source metadata inspection and source preservation
- persisted local projects and job records
- duplicate detection by SHA-256
- deterministic four-stem preview engine
- structured progress, cancellation, validation, and restart recovery state
- synchronized Web Audio playback with mute, solo, volume, seek, and export
- atomic WAV exports with a manifest

The preview engine is deliberately not a separation-quality claim. Real model adapters, broader codec support, model downloads, and verified accelerator backends are documented next steps.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

The app stores local data under the Electron user-data directory. Tests use temporary directories. For a deterministic manual run, set `RIGGED_AUDIO_DATA_DIR=/tmp/rigged-audio-data` before launching.

## Release build

```bash
npm run dist:win    # Windows portable .exe
npm run dist:linux  # Linux AppImage
npm run dist:mac    # macOS Intel + Apple Silicon DMG and ZIP
```

Each command writes standalone artifacts and a platform-specific `release/SHA256SUMS-<platform>.txt` file. The release workflow builds on native Windows, Linux, and macOS runners and attaches artifacts for `v*` tags. Local artifacts are unsigned; platform signing and notarization are optional CI configuration for trusted distribution.

## Architecture and evidence

- Product requirements: [`docs/PRD.md`](docs/PRD.md)
- Reference analysis: [`docs/research/stemkit-analysis.md`](docs/research/stemkit-analysis.md)
- Stack decision: [`docs/architecture/stack-evaluation.md`](docs/architecture/stack-evaluation.md)
- Execution status: [`audit/progress.md`](audit/progress.md)
