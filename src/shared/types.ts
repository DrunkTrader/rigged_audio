export const STEMS = [
  "vocals",
  "drums",
  "bass",
  "guitar",
  "piano",
  "other",
] as const;
export type StemId = (typeof STEMS)[number];

export type JobState =
  | "queued"
  | "preparing"
  | "separating"
  | "validating"
  | "complete"
  | "failed"
  | "canceled"
  | "interrupted";

export interface AudioMetadata {
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  codec: string;
  bytes: number;
  frames: number;
}

export interface StemArtifact {
  id: StemId;
  path: string;
  metadata: AudioMetadata;
  sha256: string;
  valid: boolean;
}

export interface MixLane {
  volume: number;
  muted: boolean;
  solo: boolean;
}

export interface ProjectRecord {
  id: string;
  title: string;
  originalPath: string;
  sourcePath: string;
  sourceSha256: string;
  source: AudioMetadata;
  createdAt: string;
  updatedAt: string;
  jobIds: string[];
  stems: Partial<Record<StemId, StemArtifact>>;
  mix: {
    master: number;
    lanes: Partial<Record<StemId, MixLane>>;
  };
  videoPath?: string;
  sourceUrl?: string;
}

export interface JobError {
  code: string;
  message: string;
  detail?: string;
}

export interface JobRecord {
  id: string;
  projectId: string;
  state: JobState;
  phase: string;
  progress: number;
  message?: string;
  engineId: string;
  engineVersion: string;
  configHash: string;
  requestedStems: StemId[];
  correlationId: string;
  startedAt?: string;
  finishedAt?: string;
  error?: JobError;
}

export interface LibraryStore {
  schemaVersion: number;
  projects: ProjectRecord[];
  jobs: JobRecord[];
}

export interface SeparationRequest {
  jobId: string;
  projectId: string;
  inputPath: string;
  outputDirectory: string;
  requestedStems: StemId[];
  configHash: string;
  source: AudioMetadata;
}

export interface EngineDescriptor {
  id: string;
  version: string;
  label: string;
  supportedStems: StemId[];
  license: string;
}

export interface SeparationProgress {
  jobId: string;
  state: JobState;
  phase: string;
  progress: number;
  message: string;
}

export type JobEvent =
  | { kind: "progress"; data: SeparationProgress }
  | { kind: "complete"; data: { projectId: string; jobId: string } }
  | {
      kind: "failed";
      data: { projectId: string; jobId: string; error: JobError };
    };

export interface RuntimeStatus {
  ready: boolean;
  supported: boolean;
  device: string | null;
  deviceName: string | null;
  torch: string | null;
  cpu: string;
  memoryBytes: number;
  diskFreeBytes: number;
  gpuHint: string | null;
}

export interface SetupEvent {
  step:
    "tools" | "python" | "packages" | "model" | "verify" | "done" | "failed";
  message: string;
}

export interface YouTubeResult {
  id: string;
  title: string;
  channel: string;
  durationSeconds: number | null;
  thumbnail: string;
}

export interface YouTubeProgress {
  progress: number;
  message: string;
}

export type BitDepth = 16 | 24 | 32;

export interface ExportOptions {
  stems: StemId[];
  mix: boolean;
  bitDepth: BitDepth;
  sampleRate: "source" | 44100 | 48000;
}

export interface RiggedAudioApi {
  pickAudio(): Promise<string | null>;
  pathForFile(file: File): string;
  importAudio(path: string): Promise<ProjectRecord>;
  listProjects(): Promise<ProjectRecord[]>;
  listJobs(): Promise<JobRecord[]>;
  startSeparation(projectId: string): Promise<{ jobId: string }>;
  cancelJob(jobId: string): Promise<void>;
  exportProject(
    projectId: string,
    options: ExportOptions,
  ): Promise<{ saved: boolean; path?: string }>;
  deleteProject(projectId: string): Promise<void>;
  updateMix(
    projectId: string,
    mix: ProjectRecord["mix"],
  ): Promise<ProjectRecord>;
  runtimeStatus(): Promise<RuntimeStatus>;
  installRuntime(): Promise<void>;
  cancelInstall(): Promise<void>;
  searchYouTube(query: string): Promise<YouTubeResult[]>;
  importYouTube(urlOrId: string): Promise<ProjectRecord>;
  cancelYouTube(): Promise<void>;
  updateYouTubeSupport(): Promise<void>;
  onJobEvent(callback: (event: JobEvent) => void): () => void;
  onSetupEvent(callback: (event: SetupEvent) => void): () => void;
  onYouTubeProgress(callback: (event: YouTubeProgress) => void): () => void;
}
