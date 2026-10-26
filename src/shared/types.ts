export const STEMS = ["vocals", "drums", "bass", "other"] as const;
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
}

export interface EngineDescriptor {
  id: string;
  version: string;
  label: string;
  supportedStems: StemId[];
  supportedFormats: string[];
  devices: string[];
  precisions: string[];
  license: string;
  mode: "mock" | "python";
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

export interface RiggedAudioApi {
  pickAudio(): Promise<string | null>;
  pathForFile(file: File): string;
  importAudio(path: string): Promise<ProjectRecord>;
  listProjects(): Promise<ProjectRecord[]>;
  getProject(projectId: string): Promise<ProjectRecord | null>;
  startSeparation(projectId: string): Promise<{ jobId: string }>;
  cancelJob(jobId: string): Promise<void>;
  readStems(projectId: string): Promise<Partial<Record<StemId, Uint8Array>>>;
  exportProject(projectId: string): Promise<{ saved: boolean; path?: string }>;
  deleteProject(projectId: string): Promise<void>;
  updateMix(
    projectId: string,
    mix: ProjectRecord["mix"],
  ): Promise<ProjectRecord>;
  onJobEvent(callback: (event: JobEvent) => void): () => void;
}
