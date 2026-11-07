import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { BitDepth } from "../shared/types";

export interface ProcessOptions {
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  onLine?: (line: string) => void;
  /** Holds stdin open for the child's lifetime, so it can notice this process dying. */
  holdStdin?: boolean;
}

/** Runs a tool with array arguments (never a shell). Rejects with its stderr tail. */
export function runProcess(
  command: string,
  args: string[],
  { signal, env, onLine, holdStdin }: ProcessOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("CANCELED: canceled"));
    const child = spawn(command, args, {
      env,
      stdio: [holdStdin ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
    }) as ChildProcessByStdio<Writable | null, Readable, Readable>;
    const abort = (): void => void child.kill();
    signal?.addEventListener("abort", abort, { once: true });
    let stderr = "";
    const lines = (stream: NodeJS.ReadableStream): void => {
      let pending = "";
      stream.setEncoding("utf8");
      stream.on("data", (text: string) => {
        pending += text;
        const parts = pending.split(/\r?\n|\r/);
        pending = parts.pop() ?? "";
        for (const line of parts) if (line) onLine?.(line);
      });
    };
    lines(child.stdout);
    lines(child.stderr);
    child.stderr.on("data", (text: string) => {
      stderr = (stderr + text).slice(-2000);
    });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", abort);
      reject(new Error(`RUNTIME_MISSING: ${error.message}`));
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) reject(new Error("CANCELED: canceled"));
      else if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `process exited with ${code}`));
    });
  });
}

/** Decodes any audio ffmpeg reads to a 24-bit WAV at the source sample rate. */
export async function decodeToWav(
  ffmpeg: string,
  input: string,
  output: string,
  maxSeconds: number,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await runProcess(
      ffmpeg,
      // prettier-ignore
      ["-v", "error", "-y", "-i", input, "-map", "0:a:0",
       "-t", String(maxSeconds),
       "-af", "aformat=channel_layouts=mono|stereo",
       "-c:a", "pcm_s24le", "-f", "wav", output],
      { signal },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/^(CANCELED|RUNTIME_MISSING):/.test(message)) throw error;
    throw new Error("FORMAT_UNSUPPORTED: this file has no readable audio");
  }
}

const CODECS: Record<BitDepth, string> = {
  16: "pcm_s16le",
  24: "pcm_s24le",
  32: "pcm_f32le",
};

function outputArgs(
  bitDepth: BitDepth,
  rate: number,
  output: string,
): string[] {
  return ["-c:a", CODECS[bitDepth], "-ar", String(rate), "-f", "wav", output];
}

function ditherFilter(bitDepth: BitDepth): string {
  return bitDepth === 16 ? "aresample=dither_method=triangular" : "anull";
}

export function renderStem(
  ffmpeg: string,
  input: string,
  output: string,
  bitDepth: BitDepth,
  rate: number,
): Promise<void> {
  return runProcess(ffmpeg, [
    ...["-v", "error", "-y", "-i", input, "-af", ditherFilter(bitDepth)],
    ...outputArgs(bitDepth, rate, output),
  ]);
}

export function mixGraph(
  gains: number[],
  master: number,
  bitDepth: BitDepth,
): string {
  const inputs = gains.map(
    (gain, index) => `[${index}:a]volume=${gain}[s${index}]`,
  );
  const labels = gains.map((_, index) => `[s${index}]`).join("");
  const dither = ditherFilter(bitDepth);
  return (
    `${inputs.join(";")};${labels}amix=inputs=${gains.length}:normalize=0:duration=longest,` +
    `volume=${master},${dither}[out]`
  );
}

/** Sums lanes at their current gains, so the file matches what the mixer plays. */
export function renderMix(
  ffmpeg: string,
  lanes: { path: string; gain: number }[],
  master: number,
  output: string,
  bitDepth: BitDepth,
  rate: number,
): Promise<void> {
  return runProcess(ffmpeg, [
    ...["-v", "error", "-y"],
    ...lanes.flatMap((lane) => ["-i", lane.path]),
    ...[
      "-filter_complex",
      mixGraph(
        lanes.map((l) => l.gain),
        master,
        bitDepth,
      ),
    ],
    ...["-map", "[out]"],
    ...outputArgs(bitDepth, rate, output),
  ]);
}

/** Parses a single-range HTTP Range header; video seeking depends on it. */
export function byteRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Number(match[2]) : size - 1;
  if (start >= size || start > end) return null;
  return { start, end: Math.min(end, size - 1) };
}
