import { createHash } from "node:crypto";
import { closeSync, createReadStream, existsSync, openSync } from "node:fs";
import { fstatSync, readSync } from "node:fs";
import type { AudioMetadata } from "../shared/types";

const PCM = 1;
const FLOAT = 3;
const EXTENSIBLE = 0xfffe;

function fail(message: string): never {
  throw new Error(`WAV_INVALID: ${message}`);
}

/** Reads the header only, so checking a large stem never loads its audio. */
export function wavInfo(path: string): AudioMetadata {
  if (!existsSync(path))
    throw new Error("SOURCE_MISSING: audio file was moved or deleted");
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const read = (position: number, length: number): Buffer => {
      const buffer = Buffer.alloc(length);
      if (readSync(fd, buffer, 0, length, position) !== length)
        fail("file ended inside a header");
      return buffer;
    };
    const riff = read(0, 12);
    if (
      riff.toString("latin1", 0, 4) !== "RIFF" ||
      riff.toString("latin1", 8, 12) !== "WAVE"
    )
      fail("missing RIFF/WAVE signature");

    let format = 0;
    let channels = 0;
    let sampleRate = 0;
    let bits = 0;
    let offset = 12;
    while (offset + 8 <= size) {
      const chunk = read(offset, 8);
      const id = chunk.toString("latin1", 0, 4);
      const length = chunk.readUInt32LE(4);
      if (id === "fmt ") {
        const fmt = read(offset + 8, Math.min(length, 26));
        format = fmt.readUInt16LE(0);
        channels = fmt.readUInt16LE(2);
        sampleRate = fmt.readUInt32LE(4);
        bits = fmt.readUInt16LE(14);
        if (format === EXTENSIBLE && fmt.length >= 26)
          format = fmt.readUInt16LE(24);
      }
      if (id === "data") {
        if (offset + 8 + length > size) fail("truncated audio data");
        const supported =
          (format === PCM && [16, 24, 32].includes(bits)) ||
          (format === FLOAT && bits === 32);
        if (!supported || !channels || !sampleRate)
          fail("unsupported sample format");
        const frames = Math.floor(length / (channels * (bits / 8)));
        if (!frames) fail("missing audio data");
        return {
          durationSeconds: frames / sampleRate,
          sampleRate,
          channels,
          codec: format === FLOAT ? "pcm_f32le" : `pcm_s${bits}le`,
          bytes: size,
          frames,
        };
      }
      offset += 8 + length + (length % 2);
    }
    return fail("missing audio data");
  } finally {
    closeSync(fd);
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function validateWav(
  path: string,
  expected: AudioMetadata,
): AudioMetadata {
  const actual = wavInfo(path);
  if (
    actual.sampleRate !== expected.sampleRate ||
    actual.channels !== expected.channels ||
    actual.frames !== expected.frames
  ) {
    throw new Error(
      "OUTPUT_MISMATCH: stem metadata does not match the source timeline",
    );
  }
  return actual;
}
