# Baseline measurements

These are baseline observations for the vertical slice, not separation-quality claims.

| Measurement               | Fixture/environment                                                | Observed result                                                  | Method                                                       |
| ------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| Core lifecycle tests      | Linux arm64 container, Node 22.23.3, 0.1 s stereo 44.1 kHz PCM WAV | 5 tests passed in 1.67 s suite wall time                         | `npm test` / Vitest output                                   |
| Renderer production build | Same host                                                          | 138 ms Vite build in the final verification run                  | `npm run build` output                                       |
| TypeScript checks         | Same host                                                          | Passed                                                           | `npm run typecheck`                                          |
| Packaged shell launch     | Linux arm64, Electron 45, Xvfb, GPU disabled                       | Stayed alive for an 8 s smoke window; no renderer crash observed | `xvfb-run ... release/linux-arm64-unpacked/rigged-audio ...` |

Not measured yet: real-model real-time factor, model initialization/download, peak RAM/GPU memory, long-file waveform generation, seek-to-audible latency, synchronization drift, export throughput, macOS/Windows packaging, and subjective/objective separation quality. Those measurements require a licensed real engine, representative fixtures, and native hardware.
