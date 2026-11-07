import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDirectory, wavBytes } from "./test-helper";
import { sha256File, validateWav, wavInfo } from "./wav";

function file(bytes: Buffer): string {
  const path = join(tempDirectory(), "audio.wav");
  writeFileSync(path, bytes);
  return path;
}

describe("wavInfo", () => {
  it.each([
    [{ bits: 16 }, "pcm_s16le"],
    [{ bits: 24 }, "pcm_s24le"],
    [{ bits: 24, format: 0xfffe }, "pcm_s24le"],
    [{ bits: 32, format: 3 }, "pcm_f32le"],
  ])("reads %j", (options, codec) => {
    const info = wavInfo(file(wavBytes({ frames: 441, ...options })));
    expect(info).toMatchObject({ codec, frames: 441, sampleRate: 44100 });
    expect(info.durationSeconds).toBeCloseTo(0.01);
  });

  it("skips chunks before the audio data", () => {
    expect(wavInfo(file(wavBytes({ list: true }))).frames).toBe(100);
  });

  it("rejects truncated audio instead of reporting a short file", () => {
    const whole = wavBytes({ frames: 100 });
    expect(() => wavInfo(file(whole.subarray(0, whole.length - 10)))).toThrow(
      /WAV_INVALID: truncated/,
    );
  });

  it("rejects files that are not WAV", () => {
    expect(() => wavInfo(file(Buffer.alloc(64)))).toThrow(/WAV_INVALID/);
  });
});

describe("validateWav", () => {
  it("fails when a stem is one frame off the source timeline", () => {
    const expected = wavInfo(file(wavBytes({ frames: 100 })));
    expect(() => validateWav(file(wavBytes({ frames: 99 })), expected)).toThrow(
      /OUTPUT_MISMATCH/,
    );
  });
});

describe("sha256File", () => {
  it("hashes by streaming", async () => {
    const path = join(tempDirectory(), "x");
    writeFileSync(path, "abc");
    expect(await sha256File(path)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
