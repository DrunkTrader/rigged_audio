# ADR 0001: Electron + React for the first desktop slice

## Context

The product needs a cross-platform desktop UI, a local file boundary, a Python ML worker, and a testable path that can run in the current environment. The host has no Rust toolchain and no native audio SDK configured.

## Decision

Use Electron + React + TypeScript for the first implementation. Keep application-core contracts independent of Electron so a future Tauri/native shell remains possible.

## Alternatives

- Tauri 2: smaller and safer shell, but adds Rust/toolchain and native integration work before the vertical slice.
- Qt/C++: excellent native audio/device controls, but higher product/UI iteration and build complexity.

## Consequences

The app carries Chromium overhead and must maintain strict preload security. In exchange, the initial workflow is portable and testable with familiar web tooling.
