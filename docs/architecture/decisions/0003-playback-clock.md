# ADR 0003: One Web Audio clock for the vertical slice

## Context

Independent media elements can drift and are difficult to control as a mix. The first slice needs synchronized stem playback without introducing C++ or a native audio dependency.

## Decision

Decode bounded WAV payloads into one `AudioContext`, create all stem sources at the same scheduled time, and derive position from the context clock. Seeking stops/recreates all sources at one offset. Add an explicit memory budget and treat streaming/native playback as a release gate for long files.

## Consequences

The slice is deterministic and easy to test, but it is not the final strategy for arbitrarily long recordings. Measurements will decide whether to add a native/streaming backend.
