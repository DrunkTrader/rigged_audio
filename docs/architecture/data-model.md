# Data model

The MVP uses an atomic versioned JSON store because records are small, the access pattern is single-user read/update, and Electron's bundled Node version does not provide a stable cross-platform SQLite API. `schemaVersion` and migration functions make the storage replaceable by SQLite when library search/concurrency justifies it.

```ts
type JobState =
  | "queued"
  | "preparing"
  | "separating"
  | "validating"
  | "exporting"
  | "complete"
  | "failed"
  | "canceled"
  | "interrupted";

interface AudioMetadata {
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  codec: string;
  bytes: number;
  frames: number;
}
interface StemArtifact {
  id: string;
  path: string;
  metadata: AudioMetadata;
  sha256: string;
  valid: boolean;
}
interface ProjectRecord {
  id: string;
  title: string;
  sourcePath: string;
  sourceSha256: string;
  source: AudioMetadata;
  createdAt: string;
  updatedAt: string;
  jobIds: string[];
  stems: StemArtifact[];
  mix: {
    master: number;
    lanes: Record<string, { volume: number; muted: boolean; solo: boolean }>;
  };
}
interface JobRecord {
  id: string;
  projectId: string;
  state: JobState;
  phase: string;
  progress: number;
  engineId: string;
  engineVersion: string;
  configHash: string;
  requestedStems: string[];
  startedAt?: string;
  finishedAt?: string;
  error?: { code: string; message: string; detail?: string };
  correlationId: string;
}
interface LibraryStore {
  schemaVersion: number;
  projects: ProjectRecord[];
  jobs: JobRecord[];
}
```

Project directories are `<data>/projects/<project-id>/` with `source/source.wav`, `artifacts/<job-id>/<stem>.wav`, `artifacts/<job-id>/manifest.json`, and `.tmp` for incomplete writes. A record points only inside its project directory after canonical path validation.
