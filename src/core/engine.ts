import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { encodeWav, readWav } from "./wav";
import {
  STEMS,
  type EngineDescriptor,
  type SeparationProgress,
  type SeparationRequest,
  type StemId,
} from "../shared/types";
import type { AudioMetadata } from "../shared/types";

export interface SeparationEngine {
  readonly descriptor: EngineDescriptor;
  separate(
    request: SeparationRequest,
    onProgress: (event: Omit<SeparationProgress, "jobId">) => void,
    signal: AbortSignal,
  ): Promise<StemId[]>;
}

const descriptor: EngineDescriptor = {
  id: "rigged.mock.bands",
  version: "1.0.0",
  label: "Rigged preview bands",
  supportedStems: [...STEMS],
  supportedFormats: ["wav/pcm_s16le"],
  devices: ["cpu"],
  precisions: ["float32"],
  license: "Rigged Audio test engine",
  mode: "mock",
};

function checkCanceled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("CANCELED: separation was canceled");
}

function clamp(value: number): number {
  return Math.max(-0.98, Math.min(0.98, value));
}

function makeStemSamples(
  input: Float32Array,
  channels: number,
  stem: StemId,
): Float32Array {
  const output = new Float32Array(input.length);
  let lowLeft = 0;
  let lowRight = 0;
  for (let frame = 0; frame < input.length / channels; frame += 1) {
    const left = input[frame * channels];
    const right = channels === 2 ? input[frame * channels + 1] : left;
    lowLeft += (left - lowLeft) * 0.035;
    lowRight += (right - lowRight) * 0.035;
    const highLeft = left - lowLeft;
    const highRight = right - lowRight;
    const mono = (left + right) / 2;
    let outLeft: number;
    let outRight: number;
    if (stem === "bass") {
      outLeft = lowLeft * 1.35;
      outRight = lowRight * 1.35;
    } else if (stem === "drums") {
      outLeft = highLeft * 0.42;
      outRight = highRight * 0.42;
    } else if (stem === "vocals") {
      outLeft = mono * 0.54;
      outRight = mono * 0.54;
    } else {
      outLeft = left - lowLeft * 0.8 - highLeft * 0.25 - mono * 0.54;
      outRight = right - lowRight * 0.8 - highRight * 0.25 - mono * 0.54;
    }
    output[frame * channels] = clamp(outLeft);
    if (channels === 2) output[frame * channels + 1] = clamp(outRight);
  }
  return output;
}

function metadataFor(source: AudioMetadata): AudioMetadata {
  return { ...source, codec: "pcm_s16le" };
}

export class MockSeparationEngine implements SeparationEngine {
  readonly descriptor = descriptor;

  async separate(
    request: SeparationRequest,
    onProgress: (event: Omit<SeparationProgress, "jobId">) => void,
    signal: AbortSignal,
  ): Promise<StemId[]> {
    const input = readWav(request.inputPath);
    mkdirSync(request.outputDirectory, { recursive: true });
    onProgress({
      state: "separating",
      phase: "inference",
      progress: 4,
      message: "Reading the source timeline",
    });
    const names = request.requestedStems.length
      ? request.requestedStems
      : [...STEMS];
    for (let index = 0; index < names.length; index += 1) {
      checkCanceled(signal);
      const name = names[index];
      await new Promise<void>((resolve) => setImmediate(resolve));
      const samples = makeStemSamples(
        input.samples,
        input.metadata.channels,
        name,
      );
      const encoded = encodeWav({
        metadata: metadataFor(input.metadata),
        samples,
      });
      const path = join(request.outputDirectory, `${name}.wav`);
      const tempPath = `${path}.tmp`;
      const { writeFileSync, renameSync } = await import("node:fs");
      writeFileSync(tempPath, encoded);
      renameSync(tempPath, path);
      onProgress({
        state: "separating",
        phase: "inference",
        progress: Math.round(((index + 1) / names.length) * 92),
        message: `Built ${name} preview`,
      });
    }
    checkCanceled(signal);
    onProgress({
      state: "validating",
      phase: "validation",
      progress: 96,
      message: "Checking stem alignment",
    });
    return names;
  }
}
