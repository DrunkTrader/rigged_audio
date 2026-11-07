import { describe, expect, it } from "vitest";
import { DemucsEngine } from "./engine";
import { fakeTool } from "./test-helper";
import { STEMS, type SeparationRequest } from "../shared/types";

const request: SeparationRequest = {
  jobId: "job",
  projectId: "project",
  inputPath: "/in.wav",
  outputDirectory: "/out",
  requestedStems: [...STEMS],
  configHash: "hash",
  source: {
    durationSeconds: 1,
    sampleRate: 48000,
    channels: 2,
    codec: "pcm_s24le",
    bytes: 1,
    frames: 48000,
  },
};

const say = (message: object): string =>
  `console.log(${JSON.stringify(JSON.stringify(message))});`;

function run(script: string, signal = new AbortController().signal) {
  const events: number[] = [];
  const engine = new DemucsEngine(() => fakeTool(script));
  return {
    events,
    result: engine.separate(request, (e) => events.push(e.progress), signal),
  };
}

describe("DemucsEngine", () => {
  it("passes the source format and turns worker lines into progress", async () => {
    const { events, result } = run(`
      const args = process.argv.slice(2);
      if (args[args.indexOf("--rate") + 1] !== "48000") process.exit(9);
      if (args[args.indexOf("--frames") + 1] !== "48000") process.exit(9);
      console.log("library chatter");
      ${say({ kind: "progress", progress: 40, message: "Separating" })}
      ${say({ kind: "done", stems: STEMS })}
    `);
    await expect(result).resolves.toEqual([...STEMS]);
    expect(events).toEqual([40]);
  });

  it("reports the worker's own error", async () => {
    const { result } = run(
      `${say({ kind: "error", message: "out of memory" })} process.exit(1);`,
    );
    await expect(result).rejects.toThrow("SEPARATION_FAILED: out of memory");
  });

  it("fails when the worker dies without saying why", async () => {
    await expect(run("process.exit(3);").result).rejects.toThrow();
  });

  it("will not report success with a stem missing", async () => {
    const { result } = run(say({ kind: "done", stems: ["vocals"] }));
    await expect(result).rejects.toThrow(/OUTPUT_MISSING: no drums/);
  });

  it("kills the worker on cancel", async () => {
    const controller = new AbortController();
    const { result } = run("setTimeout(() => {}, 60000);", controller.signal);
    setTimeout(() => controller.abort(), 100);
    await expect(result).rejects.toThrow(/CANCELED/);
  });
});
