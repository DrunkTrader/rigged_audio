import { createHash, randomUUID } from "node:crypto";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { JsonStore } from "./store";
import type { SeparationEngine } from "./engine";
import { decodeToWav, renderMix, renderStem } from "./media";
import { sha256File, validateWav, wavInfo } from "./wav";
import { StructuredLogger } from "./log";
import { laneGain } from "../shared/mix";
import {
  STEMS,
  type ExportOptions,
  type JobError,
  type JobEvent,
  type JobRecord,
  type ProjectRecord,
  type StemId,
} from "../shared/types";

const MAX_SOURCE_BYTES = 2 * 1024 ** 3;
// Playback decodes every stem to float in the renderer: 20 minutes is about 2.5 GB.
const MAX_DURATION_SECONDS = 20 * 60;
const ACTIVE_STATES = ["queued", "preparing", "separating", "validating"];

export type MediaKind = StemId | "source" | "video";

export interface ImportExtras {
  title?: string;
  videoPath?: string;
  sourceUrl?: string;
  signal?: AbortSignal;
}

function safeId(value: string, label: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value))
    throw new Error(`INVALID_${label.toUpperCase()}: invalid identifier`);
  return value;
}

function configHash(engine: SeparationEngine): string {
  const { id, version } = engine.descriptor;
  return createHash("sha256")
    .update(JSON.stringify({ engine: id, version, stems: STEMS }))
    .digest("hex");
}

function fileTitle(title: string): string {
  const safe = title
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "-")
    .replace(/[. ]+$/, "")
    .slice(0, 100);
  return safe || "rigged-audio";
}

function stemLabel(stem: StemId): string {
  return stem[0].toUpperCase() + stem.slice(1);
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
  private readonly logger: StructuredLogger;
  private readonly controllers = new Map<string, AbortController>();
  private readonly runs = new Map<string, Promise<void>>();
  private readonly imports = new Map<string, Promise<ProjectRecord>>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(event: JobEvent) => void>();

  constructor(
    dataDirectory: string,
    private readonly engine: SeparationEngine,
    private readonly ffmpeg: () => string,
  ) {
    this.store = new JsonStore(dataDirectory);
    this.logger = new StructuredLogger(dataDirectory);
    this.projectsDirectory = join(dataDirectory, "projects");
    mkdirSync(this.projectsDirectory, { recursive: true });
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

  listJobs(): JobRecord[] {
    return this.store.jobs();
  }

  async importAudio(
    sourcePath: string,
    extras: ImportExtras = {},
  ): Promise<ProjectRecord> {
    const input = resolve(String(sourcePath ?? ""));
    if (!input || !existsSync(input) || !statSync(input).isFile())
      throw new Error("SOURCE_MISSING: choose a readable audio file");
    if (statSync(input).size > MAX_SOURCE_BYTES)
      throw new Error("SOURCE_TOO_LARGE: source exceeds the 2 GB limit");
    const sourceSha256 = await sha256File(input);
    const existing = this.store
      .projects()
      .find((project) => project.sourceSha256 === sourceSha256);
    if (existing) return existing;
    // The same file twice at once would otherwise share one temp path.
    const pending = this.imports.get(sourceSha256);
    if (pending) return pending;
    const work = this.createProject(input, sourceSha256, extras).finally(() =>
      this.imports.delete(sourceSha256),
    );
    this.imports.set(sourceSha256, work);
    return work;
  }

  private async createProject(
    input: string,
    sourceSha256: string,
    extras: ImportExtras,
  ): Promise<ProjectRecord> {
    const id = `project_${sourceSha256.slice(0, 16)}`;
    const directory = this.projectDirectory(id);
    mkdirSync(join(directory, "source"), { recursive: true });
    const sourcePathInProject = join(directory, "source", "source.wav");
    const tempSource = `${sourcePathInProject}.tmp`;
    let source;
    try {
      await decodeToWav(
        this.ffmpeg(),
        input,
        tempSource,
        MAX_DURATION_SECONDS + 1, // one over, so the check below can report it
        extras.signal,
      );
      source = wavInfo(tempSource);
      if (source.durationSeconds > MAX_DURATION_SECONDS)
        throw new Error(
          "SOURCE_TOO_LONG: tracks over 20 minutes are not supported yet",
        );
      renameSync(tempSource, sourcePathInProject);
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
    let videoPath: string | undefined;
    if (extras.videoPath) {
      videoPath = join(directory, "source", "video.mp4");
      copyFileSync(extras.videoPath, videoPath);
    }
    const now = new Date().toISOString();
    const project: ProjectRecord = {
      id,
      title: extras.title ?? basename(input, extname(input)),
      originalPath: input,
      sourcePath: sourcePathInProject,
      sourceSha256,
      source,
      createdAt: now,
      updatedAt: now,
      jobIds: [],
      stems: {},
      mix: { master: 0.86, lanes: {} },
      videoPath,
      sourceUrl: extras.sourceUrl,
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
    const engine = this.engine;
    const running = this.store
      .jobs()
      .find(
        (job) =>
          job.projectId === projectId && ACTIVE_STATES.includes(job.state),
      );
    if (running) return { jobId: running.id };
    const hash = configHash(engine);
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
      message: "Waiting for the current song to finish",
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
    const controller = new AbortController();
    this.controllers.set(jobId, controller);
    // One job at a time: two models at once fight over GPU memory and RAM.
    const run = this.queue
      .then(() => this.run(record, project, engine, controller))
      .finally(() => this.runs.delete(jobId));
    this.queue = run.catch(() => undefined);
    this.runs.set(jobId, run);
    return { jobId };
  }

  async cancelJob(jobId: string): Promise<void> {
    safeId(jobId, "job_id");
    this.controllers.get(jobId)?.abort();
    await this.runs.get(jobId);
  }

  /** Stops every worker, so quitting never leaves inference running. */
  async shutdown(): Promise<void> {
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.all(this.runs.values());
  }

  /** The only way a renderer URL becomes a file path. */
  mediaPath(projectId: string, kind: string): string {
    const project = this.getProject(projectId);
    if (!project) throw new Error("PROJECT_MISSING: project was not found");
    const candidate =
      kind === "source"
        ? project.sourcePath
        : kind === "video"
          ? project.videoPath
          : project.stems[kind as StemId]?.path;
    if (!candidate) throw new Error("OUTPUT_MISSING: media is not available");
    return this.ownedPath(project.id, candidate);
  }

  async exportProject(
    projectId: string,
    destination: string,
    options: ExportOptions,
  ): Promise<{ saved: boolean; path?: string }> {
    const project = this.getProject(projectId);
    if (!project) throw new Error("PROJECT_MISSING: project was not found");
    const stems = STEMS.filter((stem) => options.stems?.includes(stem));
    const bitDepth = options.bitDepth;
    if (![16, 24, 32].includes(bitDepth))
      throw new Error("EXPORT_INVALID: unsupported bit depth");
    if (!["source", 44100, 48000].includes(options.sampleRate))
      throw new Error("EXPORT_INVALID: unsupported sample rate");
    if (!stems.length && !options.mix)
      throw new Error("EXPORT_INVALID: choose something to export");
    const rate =
      options.sampleRate === "source"
        ? project.source.sampleRate
        : options.sampleRate;
    const stemPath = (stem: StemId): string => {
      const artifact = project.stems[stem];
      const path = artifact?.valid
        ? this.ownedPath(project.id, artifact.path)
        : null;
      if (!path || !existsSync(path))
        throw new Error(`OUTPUT_MISSING: ${stem} is not available`);
      return path;
    };
    const mixLanes = STEMS.map((stem) => ({
      stem,
      gain: laneGain(project.mix, stem),
    })).filter((lane) => lane.gain > 0);
    if (options.mix && !mixLanes.length)
      throw new Error("EXPORT_INVALID: every stem is muted in this mix");
    const title = fileTitle(project.title);
    const output = join(resolve(destination), `${title} stems`);
    mkdirSync(output, { recursive: true });
    const ffmpeg = this.ffmpeg();
    const files: string[] = [];
    const write = async (
      name: string,
      render: (temporary: string) => Promise<void>,
    ): Promise<void> => {
      const path = join(output, `${title} - ${name}.wav`);
      const temporary = `${path}.tmp`;
      try {
        await render(temporary);
        renameSync(temporary, path);
      } finally {
        rmSync(temporary, { force: true });
      }
      files.push(path);
    };
    for (const stem of stems)
      await write(stemLabel(stem), (temporary) =>
        renderStem(ffmpeg, stemPath(stem), temporary, bitDepth, rate),
      );
    if (options.mix) {
      await write("Mix", (temporary) =>
        renderMix(
          ffmpeg,
          mixLanes.map(({ stem, gain }) => ({ path: stemPath(stem), gain })),
          project.mix.master,
          temporary,
          bitDepth,
          rate,
        ),
      );
    }
    const manifest = {
      projectId,
      title: project.title,
      source: project.source,
      engine: `${this.engine.descriptor.id}@${this.engine.descriptor.version}`,
      bitDepth,
      sampleRate: rate,
      exportedAt: new Date().toISOString(),
      files: files.map((file) => relative(output, file)),
    };
    const manifestPath = join(output, "manifest.json");
    writeFileSync(`${manifestPath}.tmp`, JSON.stringify(manifest, null, 2));
    renameSync(`${manifestPath}.tmp`, manifestPath);
    return { saved: true, path: output };
  }

  async deleteProject(projectId: string): Promise<void> {
    const project = this.getProject(projectId);
    if (!project) return;
    await Promise.all(project.jobIds.map((jobId) => this.cancelJob(jobId)));
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
    controller: AbortController,
  ): Promise<void> {
    const temporary = join(
      this.projectDirectory(project.id),
      "artifacts",
      `.tmp-${record.id}`,
    );
    try {
      if (controller.signal.aborted)
        throw new Error("CANCELED: canceled while waiting");
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
        source: project.source,
      };
      const names = await engine.separate(
        request,
        (progress) => {
          this.updateJob(record.id, {
            state: progress.state,
            phase: progress.phase,
            progress: progress.progress,
            message: progress.message,
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
              sha256: "",
              metadata: wavInfo(path),
              valid: true,
            },
          ];
        }),
      ) as ProjectRecord["stems"];
      for (const artifact of Object.values(artifacts))
        artifact.sha256 = await sha256File(artifact.path);
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
    const inside = relative(root, path);
    // isAbsolute catches another Windows drive, where relative() cannot use "..".
    if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))
      throw new Error(
        "PATH_REJECTED: artifact is outside the project directory",
      );
    return path;
  }

  private recoverInterruptedJobs(): void {
    for (const project of this.store.projects()) {
      const artifacts = join(this.projectDirectory(project.id), "artifacts");
      if (!existsSync(artifacts)) continue;
      for (const entry of readdirSync(artifacts))
        if (entry.startsWith(".tmp-"))
          rmSync(join(artifacts, entry), { recursive: true, force: true });
    }
    if (!this.store.jobs().some((job) => ACTIVE_STATES.includes(job.state)))
      return;
    this.store.update((current) => ({
      ...current,
      jobs: current.jobs.map((job) =>
        ACTIVE_STATES.includes(job.state)
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
