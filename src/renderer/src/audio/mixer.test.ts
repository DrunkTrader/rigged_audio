import { beforeEach, describe, expect, it, vi } from "vitest";
import { computePeaks, StemMixer, syncVideo } from "./mixer";

class FakeSource {
  buffer: { duration: number } | null = null;
  started: { when: number; offset: number } | null = null;
  stopped = false;
  connect(): void {}
  disconnect(): void {}
  start(when: number, offset: number): void {
    this.started = { when, offset };
  }
  stop(): void {
    this.stopped = true;
  }
}

class FakeContext {
  currentTime = 10;
  destination = {};
  sources: FakeSource[] = [];
  closed = false;
  gains: { gain: { setTargetAtTime: ReturnType<typeof vi.fn> } }[] = [];
  createGain() {
    const node = {
      connect: () => undefined,
      gain: { setTargetAtTime: vi.fn() },
    };
    this.gains.push(node);
    return node;
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  decodeAudioData = async () => ({ duration: 100 });
  resume = async () => undefined;
  close = async () => {
    this.closed = true;
  };
}

let context: FakeContext;

async function loaded(): Promise<StemMixer> {
  context = new FakeContext();
  const mixer = new StemMixer(() => context as unknown as AudioContext);
  await mixer.load({ vocals: "a", drums: "b", bass: "c" });
  return mixer;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    })),
  );
});

describe("shared clock", () => {
  it("schedules every stem at one time and one offset", async () => {
    const mixer = await loaded();
    mixer.play(12.5);
    const starts = context.sources.map((source) => source.started);
    expect(starts).toHaveLength(3);
    expect(new Set(starts.map((start) => start?.when)).size).toBe(1);
    expect(new Set(starts.map((start) => start?.offset))).toEqual(
      new Set([12.5]),
    );
  });

  it("derives position from the audio clock, so it cannot accumulate error", async () => {
    const mixer = await loaded();
    mixer.play(5);
    const startedAt = context.sources[0].started!.when;
    context.currentTime = startedAt + 42;
    expect(mixer.position()).toBeCloseTo(47);
    context.currentTime = startedAt + 90;
    expect(mixer.position()).toBeCloseTo(95);
  });

  it("does not run backwards during the start lead-in", async () => {
    const mixer = await loaded();
    mixer.play(5);
    expect(mixer.position()).toBe(5);
  });

  it("a seek while playing restarts every stem together", async () => {
    const mixer = await loaded();
    mixer.play(0);
    const first = [...context.sources];
    context.currentTime = 20;
    mixer.seek(30);
    expect(first.every((source) => source.stopped)).toBe(true);
    const next = context.sources.slice(first.length);
    expect(next.map((source) => source.started?.offset)).toEqual([30, 30, 30]);
    expect(new Set(next.map((source) => source.started?.when)).size).toBe(1);
  });

  it("clamps seeks to the track", async () => {
    const mixer = await loaded();
    mixer.seek(-4);
    expect(mixer.position()).toBe(0);
    mixer.seek(5000);
    expect(mixer.position()).toBe(100);
  });

  it("pause keeps the position", async () => {
    const mixer = await loaded();
    mixer.play(5);
    context.currentTime = context.sources[0].started!.when + 3;
    mixer.pause();
    context.currentTime += 50;
    expect(mixer.position()).toBeCloseTo(8);
  });

  it("stops at the end, and playing again restarts from zero", async () => {
    const mixer = await loaded();
    mixer.play(99);
    expect(mixer.stopIfEnded()).toBe(false);
    context.currentTime = context.sources[0].started!.when + 2;
    expect(mixer.stopIfEnded()).toBe(true);
    expect(mixer.isPlaying()).toBe(false);
    expect(mixer.position()).toBe(0);
  });

  it("dispose clears state and closes the context", async () => {
    const mixer = await loaded();
    mixer.play(1);
    mixer.dispose();
    expect(context.closed).toBe(true);
    expect(mixer.isLoaded()).toBe(false);
    expect(mixer.isPlaying()).toBe(false);
  });

  it("drops a load overtaken by another song", async () => {
    context = new FakeContext();
    const mixer = new StemMixer(() => context as unknown as AudioContext);
    const stale = mixer.load({ vocals: "a" });
    mixer.dispose();
    expect(await stale).toEqual({});
    expect(mixer.isLoaded()).toBe(false);
  });

  it("ramps gains, which avoids clicks, and applies solo", async () => {
    const mixer = await loaded();
    mixer.applyMix({
      master: 0.5,
      lanes: { vocals: { volume: 0.8, muted: false, solo: true } },
    });
    const [master, vocals, drums] = context.gains.map(
      (node) => node.gain.setTargetAtTime.mock.calls[0]?.[0],
    );
    expect(master).toBe(0.5);
    expect(vocals).toBe(0.8);
    expect(drums).toBe(0);
  });
});

describe("syncVideo", () => {
  const video = (currentTime: number, paused: boolean) => ({
    currentTime,
    paused,
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
  });

  it("leaves small drift alone, so video does not stutter", () => {
    const element = video(10.05, false);
    syncVideo(element, 10, true);
    expect(element.currentTime).toBe(10.05);
  });

  it("snaps large drift back to the audio clock", () => {
    const element = video(11, false);
    syncVideo(element, 10, true);
    expect(element.currentTime).toBe(10);
  });

  it("follows play and pause", () => {
    const paused = video(0, true);
    syncVideo(paused, 0, true);
    expect(paused.play).toHaveBeenCalled();
    const running = video(0, false);
    syncVideo(running, 0, false);
    expect(running.pause).toHaveBeenCalled();
  });
});

describe("computePeaks", () => {
  it("finds the loudest sample in each column across channels", () => {
    const left = new Float32Array(100);
    const right = new Float32Array(100);
    left[10] = 0.5;
    right[60] = -0.9;
    const peaks = computePeaks([left, right], 2);
    expect(peaks[0]).toBeCloseTo(0.5);
    expect(peaks[1]).toBeCloseTo(0.9);
  });

  it("handles silence and empty audio", () => {
    expect(Array.from(computePeaks([new Float32Array(10)], 2))).toEqual([0, 0]);
    expect(Array.from(computePeaks([], 2))).toEqual([0, 0]);
  });
});
