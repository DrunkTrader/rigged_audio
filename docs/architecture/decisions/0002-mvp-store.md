# ADR 0002: Atomic versioned JSON store for the MVP

## Context

The first slice has a single-user, low-volume project library and must work without a native database build. Durable state is more important than query sophistication.

## Decision

Use a versioned JSON store written through a temporary file and rename. Keep project records and job records separate from in-memory queue state. Define migrations now and revisit SQLite when large-library benchmarks or concurrent access justify it.

## Consequences

The implementation is small and portable, but large libraries will eventually need indexed queries and SQLite. The migration seam prevents the JSON shape from becoming the UI contract.
