# Contributing to Rigged Audio

Thanks for helping. Bug reports, fixes, docs and features are all welcome.

## Before you start

- **Bugs:** [open an issue](https://github.com/DrunkTrader/rigged_audio/issues) with your OS, the app version, what you did, what you expected and what happened. Logs are in `logs/app.jsonl` inside the data folder ([Quick start](docs/QUICK_START.md#your-data-updates-and-uninstalling)).
- **Features and larger changes:** open an issue first to agree on the approach, so your time is not wasted.
- **Security problems:** please report them privately via a [GitHub security advisory](https://github.com/DrunkTrader/rigged_audio/security/advisories/new), not a public issue.

## Development setup

You need Node.js 22 or later and Git. Python is not needed: the app installs its own runtime on first launch.

```bash
git clone https://github.com/DrunkTrader/rigged_audio.git
cd rigged_audio
npm install
npm run dev          # build, then launch (no hot reload: rerun after changes)
```

The first launch downloads the separation engine (1–3 GB). Set `RIGGED_AUDIO_DATA_DIR=/tmp/rigged` to use a throwaway data folder instead of your real library.

## How the code is organised

An Electron + React app with two TypeScript builds that meet only in `src/shared/types.ts`:

| Folder             | What it is                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `src/main`         | Electron main process: windows, IPC handlers, the `rigged-media://` protocol                  |
| `src/preload`      | The `window.riggedAudio` bridge the UI calls                                                  |
| `src/core`         | Electron-free domain logic: projects, jobs, setup, YouTube, WAV checks (unit-tested directly) |
| `src/renderer`     | The React UI and the Web Audio mixer                                                          |
| `src/shared`       | Types and mix presets shared by both sides                                                    |
| `python/worker.py` | The separation worker (Demucs), run in its own process                                        |

[`CLAUDE.md`](CLAUDE.md) has a detailed walkthrough of the architecture, and [`docs/architecture/`](docs/architecture/) covers the runtime, audio pipeline, data model and security.

## Checks

Run these before opening a pull request; CI runs them on Windows, macOS and Linux:

```bash
npm run typecheck
npm test
npm run build
npm run format:check   # npx prettier --write . to fix
```

Add or update tests in `src/**/*.test.ts` for any behaviour you change. Tests use fake executables, so they need neither Python nor the AI model.

## Conventions

- **Keep the renderer sandboxed.** The UI never touches Node; everything goes through `window.riggedAudio`. Adding an IPC method means editing four places: `RiggedAudioApi` in `src/shared/types.ts`, `src/preload/preload.ts`, the handler in `src/main/main.ts`, and the caller.
- **Treat IPC input as untrusted.** Any path from a stored record or the renderer goes through `ownedPath` / `safeId` so it cannot escape the project folder.
- **Errors cross IPC as `Error("CODE: message")`**; keep that format so the UI can show the right message.
- **Never leave half-written files.** Write to a temp file, then rename.
- **Don't import `demucs.api`** in the worker: it needs a package with no Intel macOS or Linux arm64 builds.
- Match the surrounding style; Prettier formats everything.

## Commits and pull requests

- Branch from `main` and keep each pull request to one change.
- Write commit messages in the imperative, with a short prefix where it helps: `fix: stop playback drifting after seek`, `docs: explain the data folder`.
- In the pull request, describe what changed, why, and how you tested it (include screenshots for UI changes).
- Don't commit build output (`release/`, `dist/`), audio files you don't have rights to, secrets or signing certificates.

Maintainers: building installers and publishing releases is described in [docs/RELEASING.md](docs/RELEASING.md).

## License

Rigged Audio is licensed under the [GNU General Public License v3.0](LICENSE). By contributing, you agree that your contributions are licensed under the same terms.
