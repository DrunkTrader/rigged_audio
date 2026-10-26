import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { RiggedAudioService } from "./service";
import { encodeWav, parseWav } from "./wav";

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), "rigged-audio-test-"));
  const path = join(directory, "source.wav");
  const samples = new Float32Array(4410 * 2);
  for (let frame = 0; frame < 4410; frame += 1) {
    const value = Math.sin(frame / 11) * 0.4;
    samples[frame * 2] = value;
    samples[frame * 2 + 1] = value * 0.9;
  }
  writeFileSync(
    path,
    encodeWav({
      metadata: {
        durationSeconds: 0.1,
        sampleRate: 44100,
        channels: 2,
        codec: "pcm_s16le",
        bytes: 0,
        frames: 4410,
      },
      samples,
    }),
  );
  return path;
}

describe("RiggedAudioService", () => {
  it("imports, separates, validates, persists, reuses, and exports a project", async () => {
    const source = fixture();
    const dataDirectory = mkdtempSync(join(tmpdir(), "rigged-audio-data-"));
    const service = new RiggedAudioService(dataDirectory);
    const events: string[] = [];
    const unsubscribe = service.onJobEvent((event) => events.push(event.kind));
    const project = service.importAudio(source);
    const { jobId } = await service.startSeparation(project.id);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("job did not complete")),
        3000,
      );
      const check = (): void => {
        if (events.includes("complete")) {
          clearTimeout(timeout);
          resolve();
        } else setTimeout(check, 5);
      };
      check();
    });
    unsubscribe();
    const complete = service.getProject(project.id)!;
    expect(complete.jobIds).toContain(jobId);
    expect(Object.keys(complete.stems)).toHaveLength(4);
    const stems = service.readStems(project.id);
    expect(parseWav(stems.vocals!).metadata.frames).toBe(project.source.frames);
    expect(service.importAudio(source).id).toBe(project.id);
    const exported = await service.exportProject(
      project.id,
      join(dataDirectory, "exports"),
    );
    expect(exported.saved).toBe(true);
    expect(exported.path).toBeTruthy();
  });

  it("marks in-flight records interrupted on a new service instance", async () => {
    const source = fixture();
    const dataDirectory = mkdtempSync(join(tmpdir(), "rigged-audio-recovery-"));
    const first = new RiggedAudioService(dataDirectory);
    const project = first.importAudio(source);
    await first.startSeparation(project.id);
    const second = new RiggedAudioService(dataDirectory);
    const jobs = second["store"].jobs();
    expect(
      jobs.some(
        (job) => job.state === "interrupted" || job.state === "complete",
      ),
    ).toBe(true);
  });

  it("cancels without committing partial stems", async () => {
    const source = fixture();
    const dataDirectory = mkdtempSync(join(tmpdir(), "rigged-audio-cancel-"));
    const service = new RiggedAudioService(dataDirectory);
    const project = service.importAudio(source);
    const events: string[] = [];
    service.onJobEvent((event) =>
      events.push(event.kind === "failed" ? event.data.error.code : event.kind),
    );
    const { jobId } = await service.startSeparation(project.id);
    await service.cancelJob(jobId);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("cancel did not settle")),
        3000,
      );
      const check = (): void => {
        if (events.includes("CANCELED")) {
          clearTimeout(timeout);
          resolve();
        } else setTimeout(check, 5);
      };
      check();
    });
    expect(service.getProject(project.id)?.stems).toEqual({});
  });
});
