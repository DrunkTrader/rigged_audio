import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import type { AudioMetadata } from "../shared/types";

export interface PcmAudio {
  metadata: AudioMetadata;
  samples: Float32Array;
}

function fail(message: string): never {
  throw new Error(`WAV_INVALID: ${message}`);
}

export function parseWav(input: Uint8Array): PcmAudio {
  if (input.byteLength < 44) fail("file is shorter than a WAV header");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const ascii = (offset: number, length: number): string => {
    let value = "";
    for (let i = 0; i < length; i += 1)
      value += String.fromCharCode(view.getUint8(offset + i));
    return value;
  };
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE")
    fail("missing RIFF/WAVE signature");

  let format: number | undefined;
  let channels: number | undefined;
  let sampleRate: number | undefined;
  let bitsPerSample: number | undefined;
  let dataOffset: number | undefined;
  let dataSize = 0;
  let offset = 12;
  while (offset + 8 <= input.byteLength) {
    const chunkId = ascii(offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + chunkSize;
    if (end > input.byteLength) fail(`truncated ${chunkId} chunk`);
    if (chunkId === "fmt " && chunkSize >= 16) {
      format = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      bitsPerSample = view.getUint16(start + 14, true);
    }
    if (chunkId === "data") {
      dataOffset = start;
      dataSize = chunkSize;
      break;
    }
    offset = end + (chunkSize % 2);
  }
  if (
    format !== 1 ||
    (channels !== 1 && channels !== 2) ||
    !sampleRate ||
    bitsPerSample !== 16
  ) {
    fail("only PCM 16-bit mono or stereo WAV is supported in this slice");
  }
  if (dataOffset === undefined || dataSize === 0) fail("missing audio data");
  const blockAlign = channels * 2;
  if (dataSize % blockAlign !== 0) fail("audio data is not frame aligned");
  const frames = dataSize / blockAlign;
  const samples = new Float32Array(frames * channels);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(dataOffset + i * 2, true) / 32768;
  }
  return {
    metadata: {
      durationSeconds: frames / sampleRate,
      sampleRate,
      channels,
      codec: "pcm_s16le",
      bytes: input.byteLength,
      frames,
    },
    samples,
  };
}

export function encodeWav(audio: PcmAudio): Uint8Array {
  const { sampleRate, channels } = audio.metadata;
  if (channels !== 1 && channels !== 2)
    fail("encoder only supports mono or stereo");
  const output = new Uint8Array(44 + audio.samples.length * 2);
  const view = new DataView(output.buffer);
  const writeAscii = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i += 1)
      view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, output.byteLength - 8, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, audio.samples.length * 2, true);
  for (let i = 0; i < audio.samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, audio.samples[i]));
    view.setInt16(
      44 + i * 2,
      Math.round(sample * (sample < 0 ? 32768 : 32767)),
      true,
    );
  }
  return output;
}

export function readWav(path: string): PcmAudio {
  if (!existsSync(path))
    throw new Error("SOURCE_MISSING: source file was moved or deleted");
  const fd = openSync(path, "r");
  try {
    const size = statSync(path).size;
    if (size > 512 * 1024 * 1024)
      throw new Error("SOURCE_TOO_LARGE: source exceeds the 512 MB MVP limit");
    const bytes = Buffer.alloc(size);
    readSync(fd, bytes, 0, size, 0);
    return parseWav(bytes);
  } finally {
    closeSync(fd);
  }
}

export function sha256File(path: string): string {
  const fd = openSync(path, "r");
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    const size = statSync(path).size;
    while (position < size) {
      const bytes = readSync(
        fd,
        buffer,
        0,
        Math.min(buffer.byteLength, size - position),
        position,
      );
      if (bytes === 0) break;
      hash.update(buffer.subarray(0, bytes));
      position += bytes;
    }
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}

export function validateWav(
  path: string,
  expected: AudioMetadata,
): AudioMetadata {
  const actual = readWav(path).metadata;
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
