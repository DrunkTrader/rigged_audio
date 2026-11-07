# Rigged Audio product requirements

## Product brief

Rigged Audio is a local-first desktop workspace for turning a mixed recording into independently playable stems. It is for musicians, DJs, remixers, karaoke creators, producers, and curious listeners who need a reliable path from source file to synchronized, exportable stems without uploading audio.

## Principles and constraints

1. **Audio truth before polish:** every success state is backed by validated artifacts.
2. **Local by default:** source audio and outputs stay on the machine; optional network actions are explicit.
3. **One clock:** stem playback is a mix, not a collection of unrelated media players.
4. **Recoverable work:** restart, cancellation, and failure are normal states.
5. **Explain trade-offs:** speed, memory, device, model, and quality are visible.
6. **Accessible studio:** keyboard navigation, focus visibility, labels, contrast, and non-color status are release requirements.

## Personas and jobs

- **Remix maker:** import a song, audition vocals/drums/bass, mute lanes, and export stems.
- **Karaoke creator:** get a dependable accompaniment preview and export a vocal-reduced mix.
- **DJ/performer:** make a quick preview on modest hardware and keep the source untouched.
- **Producer:** compare model configurations, inspect diagnostics, and retain reproducible manifests.
- **Library curator:** reopen projects, find previous work, and recover after source moves.

## MVP scope

The app supports import of any audio ffmpeg decodes, opt-in YouTube search and download through yt-dlp, a managed first-run runtime, real six-stem Demucs separation, structured progress, synchronized Web Audio playback, mix controls, presets, WAV and mix export, manifests, and restart recovery. It deliberately excludes telemetry, batch folders and alternative models. See `docs/architecture/model-runtime.md`.

## Functional requirements

| ID     | Requirement                                | MoSCoW                        | Acceptance criteria                                                                                                      |
| ------ | ------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| FR-001 | Import local audio by picker and drag/drop | Must                          | A valid WAV creates a project; invalid/missing files show a specific error and do not create success state.              |
| FR-002 | Inspect source metadata                    | Must                          | UI shows file name, duration, sample rate, channels, codec, and byte size before run.                                    |
| FR-003 | Preserve source                            | Must                          | Source is copied into the project store and original path is only a reference.                                           |
| FR-004 | Detect duplicates                          | Must                          | Same SHA-256 source and engine/config fingerprint reuse valid results.                                                   |
| FR-005 | Four-stem engine contract                  | Must                          | Engine registry declares vocals, drums, bass, other and returns validated aligned WAV files.                             |
| FR-006 | Persist jobs and phases                    | Must                          | Queue, preparation, separation, validation, export, complete, canceled, and failed states survive restart.               |
| FR-007 | Cancellation                               | Must                          | Cancel stops work, removes only incomplete temp artifacts, and records canceled status.                                  |
| FR-008 | Playback and mixing                        | Must                          | Play/pause/seek, mute, solo, volume, master, and presets operate from a common timeline.                                 |
| FR-009 | Export                                     | Must                          | One or all valid stems export atomically as WAV with a manifest.                                                         |
| FR-010 | Library                                    | Must                          | Projects can be searched, reopened, sorted by recent, and removed without deleting outside files.                        |
| FR-011 | Diagnostics                                | Should                        | Output validation reports duration/sample-rate/channel mismatches, invalid values, clipping, and silence warnings.       |
| FR-012 | Real separation adapter                    | Must for first public release | A Python model worker implements the same contract and reports model/version/device/precision.                           |
| FR-013 | Model manager                              | Must for first public release | Catalog states, checksum verification, resumable downloads, disk usage, and explicit removal exist.                      |
| FR-014 | Batch folders                              | Should                        | Folder import preserves relative paths, estimates disk use, schedules within resource limits, and retries safe failures. |
| FR-015 | Explainable recommendations                | Should                        | Presets state why a model/config was recommended for source duration and detected hardware.                              |
| FR-016 | Project portability                        | Could                         | Bundle export includes metadata, manifest, and only selected media.                                                      |
| FR-017 | Online source ingestion                    | Could                         | Only a reviewed, terms-compliant adapter may be enabled; local import remains independent.                               |

## Non-functional requirements

| ID      | Requirement          | Target / evidence                                                                                                                      |
| ------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-001 | Responsiveness       | UI event handlers do not run inference or blocking file I/O; a 60 Hz playback clock remains independent of jobs.                       |
| NFR-002 | Correctness          | Every output has matching duration within one sample-frame tolerance for the chosen format, sample rate, channels, and finite samples. |
| NFR-003 | Reliability          | Restarting during any phase yields recoverable or failed state, never a false complete state.                                          |
| NFR-004 | Privacy              | No source audio, filenames, paths, or telemetry leave the machine by default; verify with a blocked-network test.                      |
| NFR-005 | Security             | Renderer has no Node access; paths and IPC payloads are schema-validated; subprocess args are arrays, never shell strings.             |
| NFR-006 | Accessibility        | WCAG 2.2 AA targets: keyboard-complete core flow, visible focus, labels, contrast, and status announcements.                           |
| NFR-007 | Performance baseline | Record startup-to-usable UI, import, mock separation, export, and seek response on a named fixture before optimization.                |
| NFR-008 | Portability          | Supported targets are macOS 12+, Windows 10/11 x64, and Linux x64; each release target needs a packaging smoke result.                 |
| NFR-009 | Storage safety       | Writes use temp files + rename; incomplete artifacts have explicit markers and are not shown as valid outputs.                         |

## Platform and hardware tiers

- Tier A: CPU-only x64/arm64, 8 GB RAM minimum for the mock path and real-model sizing to be measured.
- Tier B: Apple Silicon with MPS, NVIDIA CUDA, or Linux AMD ROCm only after a real compute probe.
- Tier C: constrained disk/RAM devices; smart presets must explain when high-quality processing is unsuitable.

## Failure and recovery expectations

Corrupt source, missing source, insufficient disk, invalid model, worker crash, device loss, timeout, cancellation, and schema migration failures must be visible, actionable, and correlated to a job ID. No broad catch may turn these into an apparently successful project.

## Success metrics

- **Activation:** at least 80% of test users complete import → play → export on the first attempt in a clean local install.
- **Reliability:** zero false-success jobs in failure-injection suite; ≥99% fixture job completion without manual cleanup.
- **Audio correctness:** 100% of deterministic fixture outputs pass alignment/finite-sample/metadata checks.
- **Responsiveness:** UI remains interactive during mock and real worker jobs; measure p95 seek-to-audible response on each release fixture.
- **Trust:** no unconsented network request in offline test; diagnostics reproduce every failed fixture job.

## Accessibility, privacy, and open questions

Core controls need accessible names, keyboard shortcuts must not steal focus from text fields, statuses use text and icons in addition to color, and errors are announced via `role=status`/`role=alert`. Telemetry is opt-in only. Open questions are the first production model/license, streaming audio backend, SQLite migration threshold, supported codec matrix per OS, and release signing credentials.
