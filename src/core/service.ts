import { createHash } from "node:crypto";
import { basename, extname, join, relative, resolve } from "node:path";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { JsonStore } from "./store";
import { MockSeparationEngine, type SeparationEngine } from "./engine";
import { sha256File, validateWav, readWav } from "./wav";
import { StructuredLogger } from "./log";
import {
  STEMS,
  type JobError,
  type JobEvent,
  type JobRecord,
  type ProjectRecord,
  type SeparationProgress,
  type StemId,
} from "../shared/types";

const MAX_SOURCE_BYTES = 512 * 1024 * 1024;

function safeId(value: string, label: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value))
    throw new Error(`INVALID_${label.toUpperCase()}: invalid identifier`);
  return value;
}

function configHash(): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        engine: "rigged.mock.bands",
        version: "1.0.0",
        stems: STEMS,
      }),
    )
    .digest("hex");
}

function errorFor(error: unknown): JobError {
  const message = error instanceof Error ? error.message : String(error);
  const separator = message.indexOf(":");
  if (separator > 0 && /^[A-Z0-9_]+$/.test(message.slice(0, separator))) {
    return {
      code: message.slice(0, separator),
      message: message.slice(separator + 1).trim(),
    };
  }
  return { code: "SEPARATION_FAILED", message };
}

export class RiggedAudioService {
  private readonly store: JsonStore;
  private readonly projectsDirectory: string;
  private readonly engines: SeparationEngine[];
  private readonly logger: StructuredLogger;
  private readonly controllers = new Map<string, AbortController>();
  private readonly listeners = new Set<(event: JobEvent) => void>();

  constructor(
    private readonly dataDirectory: string,
    engines: SeparationEngine[] = [new MockSeparationEngine()],
  ) {
    this.store = new JsonStore(dataDirectory);
    this.logger = new StructuredLogger(dataDirectory);
    this.projectsDirectory = join(dataDirectory, "projects");
    mkdirSync(this.projectsDirectory, { recursive: true });
    this.engines = engines;
    this.recoverInterruptedJobs();
  }

  onJobEvent(listener: (event: JobEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  listProjects(): ProjectRecord[] {
    return this.store
      .projects()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getProject(projectId: string): ProjectRecord | null {
    safeId(projectId, "project_id");
    return (
      this.store.projects().find((project) => project.id === projectId) ?? null
    );
  }

  importAudio(sourcePath: string): ProjectRecord {
    const input = resolve(String(sourcePath ?? ""));
    if (!input || !existsSync(input) || !statSync(input).isFile())
      throw new Error("SOURCE_MISSING: choose a readable audio file");
    const stat = statSync(input);
    if (stat.size > MAX_SOURCE_BYTES)
      throw new Error("SOURCE_TOO_LARGE: source exceeds the 512 MB MVP limit");
    const extension = extname(input).toLowerCase();
    if (extension !== ".wav")
      throw new Error(
        "FORMAT_UNSUPPORTED: the vertical slice accepts PCM WAV files",
      );
    const source = readWav(input).metadata;
    const sourceSha256 = sha256File(input);
    const existing = this.store
      .projects()
      .find((project) => project.sourceSha256 === sourceSha256);
    if (existing) return existing;

    const id = `project_${sourceSha256.slice(0, 16)}`;
    const directory = this.projectDirectory(id);
    mkdirSync(join(directory, "source"), { recursive: true });
    const sourcePathInProject = join(directory, "source", "source.wav");
    const tempSource = `${sourcePathInProject}.tmp`;
    copyFileSync(input, tempSource);
    renameSync(tempSource, sourcePathInProject);
    const now = new Date().toISOString();
    const project: ProjectRecord = {
      id,
      title: basename(input, extension),
      originalPath: input,
      sourcePath: sourcePathInProject,
      sourceSha256,
      source,
      createdAt: now,
      updatedAt: now,
      jobIds: [],
      stems: {},
      mix: { master: 0.86, lanes: {} },
    };
    this.store.update((current) => ({
      ...current,
      projects: [project, ...current.projects],
    }));
    this.logger.info("project.imported", {
      projectId: project.id,
      bytes: source.bytes,
      sampleRate: source.sampleRate,
    });
    return project;
  }

  async startSeparation(projectId: string): Promise<{ jobId: string }> {
    const project = this.getProject(projectId);
    if (!project) throw new Error("PROJECT_MISSING: project was not found");
    const engine = this.engines[0];
    const hash = configHash();
    const existingJob = this.store
      .jobs()
      .find(
        (job) =>
          job.projectId === projectId &&
          job.configHash === hash &&
          job.state === "complete",
      );
    const artifactsReady = STEMS.every((stem) => {
      const artifact = project.stems[stem];
      if (!artifact?.valid) return false;
      try {
        return existsSync(this.ownedPath(project.id, artifact.path));
      } catch {
        return false;
      }
    });
    if (existingJob && artifactsReady) {
      return { jobId: existingJob.id };
    }
    const jobId = `job_${randomUUID()}`;
    const record: JobRecord = {
      id: jobId,
      projectId,
      state: "queued",
      phase: "queue",
      progress: 0,
      engineId: engine.descriptor.id,
      engineVersion: engine.descriptor.version,
      configHash: hash,
      requestedStems: [...STEMS],
      correlationId: randomUUID(),
    };
    this.store.update((current) => ({
      ...current,
      jobs: [...current.jobs, record],
      projects: current.projects.map((item) =>
        item.id === projectId
          ? {
              ...item,
              jobIds: [...item.jobIds, jobId],
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    }));
    void this.run(record, project, engine);
    return { jobId };
  }

  async cancelJob(jobId: string): Promise<void> {
    safeId(jobId, "job_id");
    this.controllers.get(jobId)?.abort();
  }

  readStems(projectId: string): Partial<Record<StemId, Uint8Array>> {
    const project = this.getProject(projectId);
    if (!project) throw new Error("PROJECT_MISSING: project was not found");
    const result: Partial<Record<StemId, Uint8Array>> = {};
    for (const stem of STEMS) {
      const artifact = project.stems[stem];
      if (artifact?.valid) {
        const path = this.ownedPath(project.id, artifact.path);
        if (existsSync(path)) result[stem] = new Uint8Array(readFileSync(path));
      }
    }
    return result;
  }

  async exportProject(
    projectId: string,
    destination: string,
  ): Promise<{ saved: boolean; path?: string }> {
    const project = this.getProject(projectId);
    if (!project) throw new Error("PROJECT_MISSING: project was not found");
    const folder = resolve(destination);
    mkdirSync(folder, { recursive: true });
    const output = join(
      folder,
      project.title.replace(/[\\/:*?"<>|]/g, "-").slice(0, 100) ||
        "rigged-audio",
    );
    mkdirSync(output, { recursive: true });
    const files: string[] = [];
    for (const stem of STEMS) {
      const artifact = project.stems[stem];
      if (!artifact?.valid)
        throw new Error(`OUTPUT_MISSING: ${stem} is not available`);
      const sourcePath = this.ownedPath(project.id, artifact.path);
      if (!existsSync(sourcePath))
        throw new Error(`OUTPUT_MISSING: ${stem} is not available`);
      const destinationPath = join(output, `${stem}.wav`);
      const tempPath = `${destinationPath}.tmp`;
      copyFileSync(sourcePath, tempPath);
      renameSync(tempPath, destinationPath);
      files.push(destinationPath);
    }
    const manifest = {
      projectId,
      title: project.title,
      source: project.source,
      engine: "rigged.mock.bands@1.0.0",
      exportedAt: new Date().toISOString(),
      files: files.map((file) => relative(output, file)),
    };
    writeFileSync(
      join(output, "manifest.json.tmp"),
      JSON.stringify(manifest, null, 2),
    );
    renameSync(
      join(output, "manifest.json.tmp"),
      join(output, "manifest.json"),
    );
    return { saved: true, path: output };
  }

  deleteProject(projectId: string): void {
    const project = this.getProject(projectId);
    if (!project) return;
    rmSync(this.projectDirectory(projectId), { recursive: true, force: true });
    this.store.update((current) => ({
      ...current,
      projects: current.projects.filter((item) => item.id !== projectId),
      jobs: current.jobs.filter((job) => job.projectId !== projectId),
    }));
  }

  updateMix(projectId: string, mix: ProjectRecord["mix"]): ProjectRecord {
    const project = this.getProject(projectId);
    if (!project) throw new Error("PROJECT_MISSING: project was not found");
    const next = {
      ...project,
      mix: this.normalizeMix(mix),
      updatedAt: new Date().toISOString(),
    };
    this.store.update((current) => ({
      ...current,
      projects: current.projects.map((item) =>
        item.id === projectId ? next : item,
      ),
    }));
    return next;
  }

  private async run(
    record: JobRecord,
    project: ProjectRecord,
    engine: SeparationEngine,
  ): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(record.id, controller);
    const temporary = join(
      this.projectDirectory(project.id),
      "artifacts",
      `.tmp-${record.id}`,
    );
    try {
      this.updateJob(record.id, {
        state: "preparing",
        phase: "prepare",
        progress: 1,
        startedAt: new Date().toISOString(),
      });
      this.emit({
        kind: "progress",
        data: {
          jobId: record.id,
          state: "preparing",
          phase: "prepare",
          progress: 1,
          message: "Preparing a private job workspace",
        },
      });
      rmSync(temporary, { recursive: true, force: true });
      mkdirSync(temporary, { recursive: true });
      const request = {
        jobId: record.id,
        projectId: project.id,
        inputPath: this.ownedPath(project.id, project.sourcePath),
        outputDirectory: temporary,
        requestedStems: record.requestedStems,
        configHash: record.configHash,
      };
      const names = await engine.separate(
        request,
        (progress) => {
          this.updateJob(record.id, {
            state: progress.state,
            phase: progress.phase,
            progress: progress.progress,
          });
          this.emit({
            kind: "progress",
            data: { jobId: record.id, ...progress },
          });
        },
        controller.signal,
      );
      const finalDirectory = join(
        this.projectDirectory(project.id),
        "artifacts",
        record.id,
      );
      for (const name of names)
        validateWav(join(temporary, `${name}.wav`), project.source);
      this.updateJob(record.id, {
        state: "validating",
        phase: "validation",
        progress: 98,
      });
      mkdirSync(join(this.projectDirectory(project.id), "artifacts"), {
        recursive: true,
      });
      rmSync(finalDirectory, { recursive: true, force: true });
      renameSync(temporary, finalDirectory);
      const artifacts = Object.fromEntries(
        names.map((name) => {
          const path = join(finalDirectory, `${name}.wav`);
          return [
            name,
            {
              id: name,
              path,
              metadata: readWav(path).metadata,
              sha256: sha256File(path),
              valid: true,
            },
          ];
        }),
      ) as ProjectRecord["stems"];
      const manifest = {
        schemaVersion: 1,
        jobId: record.id,
        engine: engine.descriptor,
        sourceSha256: project.sourceSha256,
        artifacts: Object.values(artifacts),
        createdAt: new Date().toISOString(),
      };
      writeFileSync(
        join(finalDirectory, "manifest.json.tmp"),
        JSON.stringify(manifest, null, 2),
      );
      renameSync(
        join(finalDirectory, "manifest.json.tmp"),
        join(finalDirectory, "manifest.json"),
      );
      const currentProject = this.getProject(project.id) ?? project;
      const nextProject = {
        ...currentProject,
        stems: artifacts,
        updatedAt: new Date().toISOString(),
      };
      this.store.update((current) => ({
        ...current,
        projects: current.projects.map((item) =>
          item.id === project.id ? nextProject : item,
        ),
      }));
      this.updateJob(record.id, {
        state: "complete",
        phase: "complete",
        progress: 100,
        finishedAt: new Date().toISOString(),
      });
      this.emit({
        kind: "complete",
        data: { projectId: project.id, jobId: record.id },
      });
      this.logger.info("job.completed", {
        projectId: project.id,
        jobId: record.id,
        correlationId: record.correlationId,
      });
    } catch (error) {
      const jobError = errorFor(error);
      const canceled =
        controller.signal.aborted || jobError.code === "CANCELED";
      rmSync(temporary, { recursive: true, force: true });
      this.updateJob(record.id, {
        state: canceled ? "canceled" : "failed",
        phase: canceled ? "canceled" : "failed",
        progress: 0,
        finishedAt: new Date().toISOString(),
        error: canceled
          ? { code: "CANCELED", message: "Separation canceled" }
          : jobError,
      });
      this.emit({
        kind: "failed",
        data: {
          projectId: project.id,
          jobId: record.id,
          error: canceled
            ? { code: "CANCELED", message: "Separation canceled" }
            : jobError,
        },
      });
      this.logger.error("job.failed", {
        projectId: project.id,
        jobId: record.id,
        code: canceled ? "CANCELED" : jobError.code,
      });
    } finally {
      this.controllers.delete(record.id);
    }
  }

  private updateJob(jobId: string, patch: Partial<JobRecord>): void {
    this.store.update((current) => ({
      ...current,
      jobs: current.jobs.map((job) =>
        job.id === jobId ? { ...job, ...patch } : job,
      ),
    }));
  }

  private emit(event: JobEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private projectDirectory(projectId: string): string {
    safeId(projectId, "project_id");
    return join(this.projectsDirectory, projectId);
  }

  private normalizeMix(mix: ProjectRecord["mix"]): ProjectRecord["mix"] {
    const master =
      typeof mix?.master === "number" && Number.isFinite(mix.master)
        ? Math.max(0, Math.min(1, mix.master))
        : 0.86;
    const lanes = Object.fromEntries(
      STEMS.map((id) => {
        const lane = mix?.lanes?.[id];
        const volume =
          typeof lane?.volume === "number" && Number.isFinite(lane.volume)
            ? Math.max(0, Math.min(1, lane.volume))
            : 1;
        return [
          id,
          { volume, muted: lane?.muted === true, solo: lane?.solo === true },
        ];
      }),
    ) as ProjectRecord["mix"]["lanes"];
    return { master, lanes };
  }

  private ownedPath(projectId: string, candidate: string): string {
    const root = resolve(this.projectDirectory(projectId));
    const path = resolve(candidate);
    const outside = relative(root, path).startsWith("..");
    if (outside)
      throw new Error(
        "PATH_REJECTED: artifact is outside the project directory",
      );
    return path;
  }

  private recoverInterruptedJobs(): void {
    const jobs = this.store.jobs();
    if (
      !jobs.some((job) =>
        ["queued", "preparing", "separating", "validating"].includes(job.state),
      )
    )
      return;
    this.store.update((current) => ({
      ...current,
      jobs: current.jobs.map((job) =>
        ["queued", "preparing", "separating", "validating"].includes(job.state)
          ? {
              ...job,
              state: "interrupted",
              phase: "interrupted",
              error: {
                code: "APP_RESTARTED",
                message: "The application stopped before this job completed",
              },
            }
          : job,
      ),
    }));
  }
}
