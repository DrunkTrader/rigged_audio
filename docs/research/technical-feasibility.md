# Technical feasibility

## Scope and evidence

This is a planning baseline for 2026-10-26. The repository was empty, the host has Node 22.23.3, npm 10.9.9, and Python 3.11.2, and no FFmpeg or Rust toolchain was detected in the initial audit. Hardware-accelerated inference is therefore **not tested** in this environment.

## Feasibility conclusions

| Area           | Evidence and conclusion                                                                                                                | Decision                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Desktop shell  | Electron is proven by the reference and available through npm. Tauri would require Rust and a native build toolchain not present here. | Electron for the vertical slice; keep IPC/domain core independent so a Tauri shell remains possible.           |
| GUI            | React + TypeScript supports accessible, testable desktop UI and fast iteration.                                                        | Use React 18, TypeScript, Vite.                                                                                |
| Local audio    | A deterministic PCM WAV path can be implemented without external binaries.                                                             | Ship WAV vertical slice first; use FFmpeg/native decoder adapter for broader formats in the real-engine phase. |
| Audio playback | Web Audio provides a common `AudioContext` clock, gain/mute/solo graph, and synchronized starts.                                       | Use a bounded Web Audio slice now; validate native/streaming audio for long files before release.              |
| ML inference   | Demucs, MDX, and Roformer ecosystems are Python/PyTorch-heavy.                                                                         | Isolate Python as a worker behind a file-based job protocol; no model weights in Git.                          |
| Persistence    | MVP records are small and append/update oriented. Atomic versioned JSON is sufficient for the first vertical slice.                    | Use an atomic JSON store now; migrate to SQLite when library scale or concurrent queries justify it.           |
| IPC            | Electron preload with explicit methods is sufficient.                                                                                  | No renderer Node access; validate every IPC argument in main.                                                  |
| Packaging      | Electron Builder supports macOS/Windows/Linux but CI signing and native binaries are platform-specific.                                | Add packaging configuration and smoke commands; release gate remains unverified until platform CI runs.        |

## Model and license work still required

Before shipping real weights, record the exact model artifact URL, checksum, model license, dependent library licenses, and redistribution permission in the model catalog. The reference's use of Demucs/Roformer is an ecosystem signal, not permission to redistribute any checkpoint.

## Known limits of the MVP

- The deterministic mock engine is for lifecycle, alignment, persistence, playback, and export verification; it is not a separation-quality claim.
- Full-file decode is bounded by an explicit byte budget in the renderer. Long-file streaming and peak-cache rendering are release work.
- Only PCM WAV is decoded locally without FFmpeg in the first slice. Other formats are rejected with a clear message rather than guessed at.
- GPU capability is represented as unavailable until a real worker performs a compute probe.
