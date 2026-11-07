import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SeparationEngine } from "./engine";
import { RiggedAudioService } from "./service";
import { ffmpegPath, tempDirectory } from "./test-helper";
import { wavInfo } from "./wav";
import { applyPreset } from "../shared/mix";
import { STEMS, type ExportOptions, type JobEvent } from "../shared/types";

/** Stands in for the model: valid aligned stems, without inference. */
class CopyEngine implements SeparationEngine {
  readonly descriptor = {
    id: "test.copy",
    version: "1",
    label: "Copy",
    supportedStems: [...STEMS],
    license: "test",
  };
  constructor(private readonly gate?: Promise<void>) {}
  async separate(
    request: Parameters<SeparationEngine["separate"]>[0],
    onProgress: Parameters<SeparationEngine["separate"]>[1],
    signal: AbortSignal,
  ) {
    onProgress({
      state: "separating",
      phase: "inference",
      progress: 50,
      message: "Working",
    });
    for (const stem of STEMS)
      copyFileSync(
        request.inputPath,
        join(request.outputDirectory, `${stem}.wav`),
      );
    if (this.gate)
      await Promise.race([
        this.gate,
        new Promise((_, reject) =>
          signal.addEventListener("abort", () =>
            reject(new Error("CANCELED: stopped")),
          ),
        ),
      ]);
    return [...STEMS];
  }
}

function tone(name = "song.mp3", args = ["-ac", "2"]): string {
  const path = join(tempDirectory(), name);
  execFileSync(ffmpegPath, [
    ...["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1"],
    ...args,
    path,
  ]);
  return path;
}

function setup(engine: SeparationEngine = new CopyEngine()) {
  const directory = tempDirectory("rigged-data-");
  const service = new RiggedAudioService(directory, engine, () => ffmpegPath);
  return { directory, service };
}

function finished(service: RiggedAudioService): Promise<JobEvent> {
  return new Promise((resolve) => {
    const stop = service.onJobEvent((event) => {
      if (event.kind === "progress") return;
      stop();
      resolve(event);
    });
  });
}

async function separated(service: RiggedAudioService, source = tone()) {
  const project = await service.importAudio(source);
  const done = finished(service);
  await service.startSeparation(project.id);
  await done;
  return service.getProject(project.id)!;
}

const options: ExportOptions = {
  stems: [...STEMS],
  mix: false,
  bitDepth: 24,
  sampleRate: "source",
};

describe("import", () => {
  it("decodes compressed audio into a project at its own sample rate", async () => {
    const { service } = setup();
    const source = tone("song.flac", ["-ac", "2", "-ar", "48000"]);
    const project = await service.importAudio(source);
    expect(project.title).toBe("song");
    expect(project.source).toMatchObject({
      sampleRate: 48000,
      channels: 2,
      codec: "pcm_s24le",
    });
    expect(project.source.durationSeconds).toBeCloseTo(1, 1);
  });

  it("reuses the project for identical audio", async () => {
    const { service } = setup();
    const source = tone();
    const first = await service.importAudio(source);
    expect((await service.importAudio(source)).id).toBe(first.id);
    expect(service.listProjects()).toHaveLength(1);
  });

  it("survives the same file being imported twice at once", async () => {
    const { service } = setup();
    const source = tone();
    const [first, second] = await Promise.all([
      service.importAudio(source),
      service.importAudio(source),
    ]);
    expect(second.id).toBe(first.id);
    expect(service.listProjects()).toHaveLength(1);
    expect(existsSync(first.sourcePath)).toBe(true);
  });

  it("rejects a file without audio and leaves nothing behind", async () => {
    const { directory, service } = setup();
    const path = join(tempDirectory(), "notes.mp3");
    writeFileSync(path, "this is not audio");
    await expect(service.importAudio(path)).rejects.toThrow(
      /FORMAT_UNSUPPORTED/,
    );
    expect(service.listProjects()).toEqual([]);
    expect(readdirSync(join(directory, "projects"))).toEqual([]);
  });

  it("refuses tracks too long for the mixer to hold", async () => {
    const { service } = setup();
    const path = join(tempDirectory(), "long.mp3");
    execFileSync(ffmpegPath, [
      ...["-v", "error", "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono"],
      ...["-t", "1201", path],
    ]);
    await expect(service.importAudio(path)).rejects.toThrow(/SOURCE_TOO_LONG/);
  });
});

describe("jobs", () => {
  it("commits aligned stems for all six targets", async () => {
    const { service } = setup();
    const project = await separated(service);
    expect(Object.keys(project.stems).sort()).toEqual([...STEMS].sort());
    for (const stem of STEMS)
      expect(project.stems[stem]?.metadata.frames).toBe(project.source.frames);
    expect(project.stems.vocals?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reuses a finished job, and the job record says it is complete", async () => {
    const { service } = setup();
    const project = await separated(service);
    const { jobId } = await service.startSeparation(project.id);
    expect(jobId).toBe(project.jobIds[0]);
    expect(service.listJobs().find((job) => job.id === jobId)?.state).toBe(
      "complete",
    );
  });

  it("never runs two jobs for one project", async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { service } = setup(new CopyEngine(gate));
    const project = await service.importAudio(tone());
    const first = await service.startSeparation(project.id);
    const second = await service.startSeparation(project.id);
    expect(second.jobId).toBe(first.jobId);
    release();
    await service.shutdown();
  });

  it("runs jobs for different songs one at a time", async () => {
    let active = 0;
    let peak = 0;
    class CountingEngine extends CopyEngine {
      override async separate(
        ...args: Parameters<SeparationEngine["separate"]>
      ) {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        const names = await super.separate(...args);
        active -= 1;
        return names;
      }
    }
    const { service } = setup(new CountingEngine());
    const first = await service.importAudio(tone());
    const second = await service.importAudio(
      tone("other.mp3", ["-ac", "2", "-t", "0.5"]),
    );
    await service.startSeparation(first.id);
    await service.startSeparation(second.id);
    await Promise.all(service["runs"].values());
    expect(peak).toBe(1);
    expect(service.listJobs().map((job) => job.state)).toEqual([
      "complete",
      "complete",
    ]);
  });

  it("a queued job can be canceled before it starts", async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { service } = setup(new CopyEngine(gate));
    const first = await service.importAudio(tone());
    const second = await service.importAudio(
      tone("other.mp3", ["-ac", "2", "-t", "0.5"]),
    );
    await service.startSeparation(first.id);
    const { jobId } = await service.startSeparation(second.id);
    const canceled = service.cancelJob(jobId);
    release();
    await canceled;
    expect(service.listJobs().find((job) => job.id === jobId)?.state).toBe(
      "canceled",
    );
    expect(service.getProject(second.id)?.stems).toEqual({});
  });

  it("cancel commits nothing and removes the temp folder", async () => {
    const gate = new Promise<void>(() => undefined);
    const { directory, service } = setup(new CopyEngine(gate));
    const project = await service.importAudio(tone());
    const { jobId } = await service.startSeparation(project.id);
    await service.cancelJob(jobId);
    expect(service.getProject(project.id)?.stems).toEqual({});
    expect(service.listJobs()[0].state).toBe("canceled");
    const artifacts = join(directory, "projects", project.id, "artifacts");
    expect(existsSync(artifacts) ? readdirSync(artifacts) : []).toEqual([]);
  });

  it("a stem off the source timeline fails instead of committing", async () => {
    class ShortEngine extends CopyEngine {
      override async separate(
        ...args: Parameters<SeparationEngine["separate"]>
      ) {
        const names = await super.separate(...args);
        const wrong = tone("short.wav", ["-ac", "2", "-t", "0.5"]);
        copyFileSync(wrong, join(args[0].outputDirectory, "bass.wav"));
        return names;
      }
    }
    const { service } = setup(new ShortEngine());
    const project = await service.importAudio(tone());
    const done = finished(service);
    await service.startSeparation(project.id);
    const event = await done;
    expect(event.kind).toBe("failed");
    expect(JSON.stringify(event)).toContain("OUTPUT_MISMATCH");
    expect(service.getProject(project.id)?.stems).toEqual({});
  });

  it("deleting a project stops its running job", async () => {
    const gate = new Promise<void>(() => undefined);
    const { service } = setup(new CopyEngine(gate));
    const project = await service.importAudio(tone());
    await service.startSeparation(project.id);
    await service.deleteProject(project.id);
    expect(service.listProjects()).toEqual([]);
    expect(service.listJobs()).toEqual([]);
  });

  it("a restart marks in-flight jobs interrupted and clears their temp files", async () => {
    const gate = new Promise<void>(() => undefined);
    const { directory, service } = setup(new CopyEngine(gate));
    const project = await service.importAudio(tone());
    const { jobId } = await service.startSeparation(project.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const next = new RiggedAudioService(
      directory,
      new CopyEngine(),
      () => ffmpegPath,
    );
    expect(next.listJobs().find((job) => job.id === jobId)?.state).toBe(
      "interrupted",
    );
    const artifacts = join(directory, "projects", project.id, "artifacts");
    expect(readdirSync(artifacts)).toEqual([]);
  });
});

describe("media paths", () => {
  it("resolves project media and refuses anything else", async () => {
    const { service } = setup();
    const project = await separated(service);
    expect(service.mediaPath(project.id, "vocals")).toContain(project.id);
    expect(() => service.mediaPath(project.id, "video")).toThrow(
      /OUTPUT_MISSING/,
    );
    expect(service.listJobs()[0].message).not.toMatch(/Waiting/);
    expect(() => service.mediaPath("../../etc", "source")).toThrow(/INVALID/);
  });

  it("refuses a tampered path that leaves the project", async () => {
    const { service } = setup();
    const project = await separated(service);
    service["store"].update((current) => ({
      ...current,
      projects: current.projects.map((item) => ({
        ...item,
        sourcePath: join(item.sourcePath, "..", "..", "..", "secret"),
      })),
    }));
    expect(() => service.mediaPath(project.id, "source")).toThrow(
      /PATH_REJECTED/,
    );
  });
});

describe("export", () => {
  it("writes named stems that stay aligned at the chosen format", async () => {
    const { service } = setup();
    const project = await separated(service);
    const folder = tempDirectory();
    const result = await service.exportProject(project.id, folder, {
      ...options,
      bitDepth: 16,
      sampleRate: 48000,
    });
    const files = readdirSync(result.path!);
    expect(files).toContain("song - Vocals.wav");
    expect(files).toContain("manifest.json");
    expect(files.filter((name) => name.endsWith(".tmp"))).toEqual([]);
    const infos = STEMS.map((stem) => {
      const label = stem[0].toUpperCase() + stem.slice(1);
      return wavInfo(join(result.path!, `song - ${label}.wav`));
    });
    expect(new Set(infos.map((info) => info.frames)).size).toBe(1);
    expect(infos[0]).toMatchObject({ sampleRate: 48000, codec: "pcm_s16le" });
  });

  it("keeps the source rate by default and can export one stem", async () => {
    const { service } = setup();
    const source = tone("song.wav", ["-ac", "2", "-ar", "22050"]);
    const project = await separated(service, source);
    const result = await service.exportProject(project.id, tempDirectory(), {
      ...options,
      stems: ["drums"],
    });
    expect(readdirSync(result.path!).sort()).toEqual([
      "manifest.json",
      "song - Drums.wav",
    ]);
    expect(wavInfo(join(result.path!, "song - Drums.wav")).sampleRate).toBe(
      22050,
    );
  });

  it("renders the mix with the lanes the listener hears", async () => {
    const { service } = setup();
    const project = await separated(service);
    const render = async (mix: typeof project.mix): Promise<string> => {
      service.updateMix(project.id, mix);
      const result = await service.exportProject(project.id, tempDirectory(), {
        ...options,
        stems: [],
        mix: true,
        bitDepth: 32,
      });
      return join(result.path!, "song - Mix.wav");
    };
    const samples = (path: string): Float32Array => {
      const bytes = readFileSync(path);
      const body = bytes.subarray(bytes.indexOf("data") + 8);
      return new Float32Array(
        body.buffer.slice(body.byteOffset, body.byteOffset + body.length),
      );
    };
    const rms = (data: Float32Array): number =>
      Math.sqrt(
        data.reduce((sum, value) => sum + value * value, 0) / data.length,
      );

    const unity = { ...project.mix, master: 1 };
    const one = rms(samples(await render(applyPreset(unity, "acapella"))));
    const two = rms(samples(await render(applyPreset(unity, "rhythm"))));
    // Every stem here is the same tone, so two lanes sum to twice one lane.
    expect(two / one).toBeCloseTo(2, 1);

    const halved = { ...applyPreset(unity, "acapella"), master: 0.5 };
    expect(rms(samples(await render(halved))) / one).toBeCloseTo(0.5, 1);
  });

  it("refuses an all-muted mix, an empty request and bad options", async () => {
    const { service } = setup();
    const project = await separated(service);
    const lanes = Object.fromEntries(
      STEMS.map((id) => [id, { volume: 1, muted: true, solo: false }]),
    );
    service.updateMix(project.id, { master: 1, lanes });
    const run = (patch: Partial<ExportOptions>): Promise<unknown> =>
      service.exportProject(project.id, tempDirectory(), {
        ...options,
        stems: [],
        ...patch,
      });
    const folder = tempDirectory();
    await expect(
      service.exportProject(project.id, folder, { ...options, mix: true }),
    ).rejects.toThrow(/muted/);
    expect(readdirSync(folder)).toEqual([]); // refused before writing any stems
    await expect(run({ mix: true })).rejects.toThrow(/muted/);
    await expect(run({})).rejects.toThrow(/EXPORT_INVALID/);
    await expect(run({ mix: true, bitDepth: 8 as 16 })).rejects.toThrow(
      /bit depth/,
    );
  });
});

describe("library migration", () => {
  it("keeps v1 sources but drops stems that came from the old test filter", () => {
    const directory = tempDirectory("rigged-data-");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "library.json"),
      JSON.stringify({
        schemaVersion: 1,
        projects: [
          {
            id: "project_a",
            title: "Old",
            stems: { vocals: {} },
            jobIds: ["j"],
          },
        ],
        jobs: [{ id: "j", state: "complete" }],
      }),
    );
    const service = new RiggedAudioService(
      directory,
      new CopyEngine(),
      () => ffmpegPath,
    );
    const [project] = service.listProjects();
    expect(project.title).toBe("Old");
    expect(project.stems).toEqual({});
    expect(service.listJobs()).toEqual([]);
  });
});
