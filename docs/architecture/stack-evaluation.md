# Stack evaluation

Weights: playback/sync 18%, inference compatibility 18%, GUI 12%, packaging 12%, IPC/security 10%, memory/crash isolation 8%, testability 8%, maintenance/ecosystem 8%, long-term extensibility 6%. Scores are 1–5 and are a decision aid, not a benchmark result.

| Candidate                              | Playback | Inference | GUI | Packaging | IPC/security | Isolation | Tests | Maint. | Ext. | Weighted view |
| -------------------------------------- | -------: | --------: | --: | --------: | -----------: | --------: | ----: | -----: | ---: | ------------- |
| Electron + React + Python worker       |        4 |         5 |   5 |         4 |            4 |         4 |     5 |      4 |    4 | **4.35**      |
| Tauri 2 + React + Rust + Python worker |        4 |         5 |   4 |         4 |            5 |         5 |     4 |      4 |    5 | **4.40**      |
| Qt/C++ + Python worker                 |        5 |         4 |   4 |         3 |            4 |         5 |     3 |      3 |    5 | **4.05**      |
| Electron + native C++ inference/audio  |        5 |         4 |   5 |         3 |            3 |         4 |     4 |      3 |    4 | **3.95**      |

## Evidence and risks

### Electron + React

Evidence: the reference ships this combination; Electron provides mature windowing, preload IPC, Web Audio, and electron-builder targets. React is straightforward to component-test. Drawbacks are Chromium memory overhead, a large installer, and a broad security surface. Python packaging is still the primary operational complexity.

### Tauri 2 + React + Rust

Evidence: smaller shell and stronger native boundary are attractive, but the host has no Rust toolchain and the audio/ML worker still needs native integration. This is a strong post-MVP shell candidate, not the shortest path to a tested vertical slice here.

### Qt/C++

Evidence: native audio/device integration and mature desktop controls are strong. Costs are C++ build/toolchain complexity, slower UI iteration for a product-heavy workspace, and still needing Python or ONNX model integration.

### Electron + native C++

Evidence: can offer best audio timing, but it introduces a second native ABI and packaging path before the product has measured a need. Use an established native audio subsystem only after Web Audio/streaming measurements identify a blocker.

## Decision

Use **Electron + React + TypeScript**, with the domain/job core isolated from the shell and a separate Python worker seam reserved for real inference. The first implementation is intentionally smaller: Node main process, explicit preload API, React renderer, atomic JSON project store, deterministic mock engine, and bounded Web Audio playback. This keeps the UI useful without downloading gigabytes or claiming GPU support.

The decision is revisitable if long-track synchronization or memory measurements fail the NFR targets. Tauri is the likely shell alternative once Rust CI and native audio requirements are proven. No C++ is introduced until a profiled audio requirement justifies it.

## Dependency and licensing posture

Production model weights, FFmpeg binaries, and native audio libraries require a per-artifact license inventory and checksum registry. No downloaded artifact is committed. npm packages are pinned through the lockfile and scanned in CI.
