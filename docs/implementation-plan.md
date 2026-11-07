# Implementation plan

| Phase                  | Outcome                                                         | Status        | Evidence                                                         |
| ---------------------- | --------------------------------------------------------------- | ------------- | ---------------------------------------------------------------- |
| 0 Audit                | Reference, feasibility, parity, assumptions                     | Complete      | `docs/research/*`                                                |
| 1 Product/architecture | PRD, stack decision, diagrams, data/audio/security/test docs    | Complete      | `docs/PRD.md`, `docs/architecture/*`, `docs/testing/strategy.md` |
| 2 Foundation           | Electron shell, typed preload, store, scripts, mock engine      | Verified      | Source files, checks, packaging, and launch smoke                |
| 3 Vertical slice       | Import → persist → mock split → play/mix → export → restart     | Core verified | Service lifecycle tests; interactive GUI E2E remains open        |
| 4 Real engine          | Python worker, first licensed model, model manager              | Planned       | Requires model/license decision                                  |
| 5 Product parity       | Long-file waveform cache, queue/library, export controls        | Planned       | Requires performance baselines                                   |
| 6 Smart features       | Recommendations, A/B comparison, batch, portability             | Planned       | Gate on core reliability                                         |
| 7 Release              | packaging, security, accessibility, performance, platform smoke | Planned       | Native CI evidence required                                      |

## Current execution gates

- No real model weights or network ingestion before engine/license evidence exists.
- No production-quality claim before an evaluation corpus and repeatable benchmark exist.
- No “complete” job without output validation and atomic manifest commit.
- No release-ready claim while platform packaging and long-file playback are untested.
