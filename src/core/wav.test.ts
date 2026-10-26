import { describe, expect, it } from "vitest";
import { encodeWav, parseWav } from "./wav";

describe("WAV codec", () => {
  it("round-trips a stereo PCM timeline", () => {
    const samples = new Float32Array([0, 0.25, -0.5, 0.75, 0.1, -0.1]);
    const encoded = encodeWav({
      metadata: {
        durationSeconds: 3 / 44100,
        sampleRate: 44100,
        channels: 2,
        codec: "pcm_s16le",
        bytes: 0,
        frames: 3,
      },
      samples,
    });
    const parsed = parseWav(encoded);
    expect(parsed.metadata.sampleRate).toBe(44100);
    expect(parsed.metadata.channels).toBe(2);
    expect(parsed.metadata.frames).toBe(3);
    expect(parsed.samples[0]).toBeCloseTo(0, 5);
    expect(parsed.samples[1]).toBeCloseTo(0.25, 4);
    expect(parsed.samples[2]).toBeCloseTo(-0.5, 4);
    expect(parsed.samples[3]).toBeCloseTo(0.75, 4);
    expect(parsed.samples[4]).toBeCloseTo(0.1, 4);
    expect(parsed.samples[5]).toBeCloseTo(-0.1, 4);
  });

  it("rejects unsupported sample formats instead of guessing", () => {
    const bytes = new Uint8Array(44);
    bytes.set([
      82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0,
      0, 3, 0, 1, 0,
    ]);
    expect(() => parseWav(bytes)).toThrow(/WAV_INVALID/);
  });
});
