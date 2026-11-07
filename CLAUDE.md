# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run typecheck          # tsc for node (main/preload/core/shared) then web (renderer)
npm test                   # vitest run (only src/**/*.test.ts)
npx vitest run src/core/service.test.ts -t "<test name>"   # single file / single test
npm run build              # tsc -p tsconfig.node.json -> dist-electron/, then vite build -> dist/
npm run dev                # build + `electron .` (no HMR; rebuild to see changes)
npm run format:check       # prettier
npm run dist:linux|dist:win|dist:mac   # electron-builder + SHA256SUMS (see README)
```

CI runs `npm ci`, `typecheck`, `test`, `build`. Set `RIGGED_AUDIO_DATA_DIR=/tmp/x` to run the app against a throwaway data directory.

## Architecture

Local-first Electron + React app that splits a song into six stems (vocals/drums/bass/guitar/piano/other) with Demucs `htdemucs_6s`, run by `python/worker.py` in its own process. Product scope is in `docs/PRD.md`; runtime design is in `docs/architecture/model-runtime.md`.

Two separate TypeScript builds that meet only through `src/shared/types.ts`:

- **Node side** (`tsconfig.node.json`, CommonJS → `dist-electron/`): `src/main`, `src/preload`, `src/core`, `src/shared`.
- **Renderer** (`tsconfig.web.json`, Vite, root `src/renderer` → `dist/`): React UI. It never touches Node; everything goes through `window.riggedAudio`.

Flow of a call: `App.tsx` → `window.riggedAudio.*` (defined in `src/preload/preload.ts`, typed by `RiggedAudioApi` in `shared/types.ts`) → `ipcMain.handle` in `src/main/main.ts` → `RiggedAudioService` (`src/core/service.ts`). Adding an IPC method means editing all four places (types, preload, main, caller). Job progress flows the other way via the `job:event` channel (`onJobEvent`).

`src/core` is the electron-free domain layer (that is why vitest can test it directly):

- `service.ts` owns the project/job lifecycle: import (decode through ffmpeg to a 24-bit WAV in the project dir, dedupe by SHA-256), job state machine (queued → preparing → separating → validating → complete/failed/canceled), cancellation via `AbortController`, export, mix normalization, and marking in-flight jobs `interrupted` on restart. Stems are written to a temp dir, validated, then renamed into `projects/<id>/artifacts/<jobId>`.
- `engine.ts` defines the `SeparationEngine` contract and `DemucsEngine`, which spawns the worker and reads its JSON lines. Tests use a fake engine and fake executables (`test-helper.ts`); there is no mock in production code.
- `runtime.ts` is first-run setup: downloads a checksum-pinned `uv`, which installs private Python, PyTorch (`--torch-backend=auto` picks CUDA/ROCm/CPU), Demucs, ffmpeg (`imageio-ffmpeg`) and yt-dlp into `<data>/runtime`. Inference env forces `HF_HUB_OFFLINE=1`.
- `youtube.ts` wraps yt-dlp. Only a validated 11-character id is passed to it, never a user URL.
- `media.ts` holds `runProcess` and the ffmpeg commands. `store.ts` is a single-file JSON store (`library.json`, atomic temp+rename, corrupt files are renamed aside, schema 1 is migrated by dropping old mock stems); `log.ts` writes JSONL to `logs/app.jsonl`.
- `wav.ts` reads WAV headers only and validates stems against the source timeline; audio is never loaded in the main process.

Media reaches the renderer through the `rigged-media://media/<projectId>/<kind>` protocol in `main.ts` (with Range support), resolved by `service.mediaPath`. Stems never cross IPC.

Renderer audio: `renderer/src/audio/mixer.ts` (`StemMixer`) decodes the stem WAVs into Web Audio buffers and plays all stems from one shared clock; the YouTube player is slaved to that clock by `syncVideo`. `App.tsx` drives it and persists mix changes through `updateMix`. `shared/mix.ts` defines presets and `laneGain`, used by both playback and export so a mix exports as it sounds.

## Conventions worth knowing

- Errors cross IPC as `Error("CODE: message")`; `errorFor` in `service.ts` parses the `CODE:` prefix into a `JobError`. Keep that format.
- Any path from a stored record goes through `ownedPath`/`safeId` so it cannot escape the project directory; renderer and IPC input is treated as untrusted (`contextIsolation` on, `sandbox` on, no Node in renderer).
- Writes use temp file + rename; never leave partial artifacts marked valid.
- `vite.config.mts` must keep `base: "./"`: the packaged app loads `dist/index.html` over `file://`, and absolute `/assets/...` URLs give a blank window.
- Input is anything ffmpeg decodes, max 2 GB and 20 minutes. The duration cap exists because the mixer holds every stem decoded in memory.
- Do not import `demucs.api`: it needs `sphn`, which has no Intel macOS or Linux arm64 wheels. Setup excludes `sphn` and the worker uses `demucs.pretrained`/`demucs.apply` with ffmpeg for I/O.
- Stems must match the source frame count exactly. In ffmpeg, keep the resample inside `-af`: a separate `-ar` runs after the filter chain, so `atrim` would count at the wrong rate.
- yt-dlp's `--print` implies quiet mode; `--progress` is required to keep progress lines.
- The worker exits when the app dies, so a force-killed app does not leave inference running: on stdin EOF on macOS/Linux (keep `holdStdin` there), and by waiting on `--parent-pid` on Windows, where a thread blocked reading a pipe stalled jobs at 1%.
- YouTube video is never downloaded. `audio/youtube.ts` drives YouTube's embed over postMessage (no YouTube script in the page) and `syncVideo` slaves it to the mix clock. Embeds need the Referer header that `identifyEmbeds` in `main.ts` adds; without it YouTube shows error 153.
- Theme tokens live at the top of `styles.css` (`:root` dark, `[data-theme="light"]`); stem colours per theme are in `STEM_META` in `format.ts`.
