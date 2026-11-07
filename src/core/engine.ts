import { runProcess } from "./media";
import type { WorkerCommand } from "./runtime";
import {
  STEMS,
  type EngineDescriptor,
  type SeparationProgress,
  type SeparationRequest,
  type StemId,
} from "../shared/types";

export interface SeparationEngine {
  readonly descriptor: EngineDescriptor;
  separate(
    request: SeparationRequest,
    onProgress: (event: Omit<SeparationProgress, "jobId">) => void,
    signal: AbortSignal,
  ): Promise<StemId[]>;
}

interface WorkerMessage {
  kind: string;
  progress?: number;
  message?: string;
  stems?: string[];
}

/** Runs python/worker.py in its own process and maps its JSON lines to job progress. */
export class DemucsEngine implements SeparationEngine {
  readonly descriptor: EngineDescriptor = {
    id: "demucs.htdemucs_6s",
    version: "4.1.0",
    label: "Demucs 6-stem",
    supportedStems: [...STEMS],
    license: "MIT",
  };

  constructor(private readonly worker: () => WorkerCommand) {}

  async separate(
    request: SeparationRequest,
    onProgress: (event: Omit<SeparationProgress, "jobId">) => void,
    signal: AbortSignal,
  ): Promise<StemId[]> {
    const { command, args, env } = this.worker();
    let stems: string[] | null = null;
    let failure: string | null = null;
    const onLine = (line: string): void => {
      if (!line.startsWith("{")) return; // library chatter on stderr
      let message: WorkerMessage;
      try {
        message = JSON.parse(line) as WorkerMessage;
      } catch {
        return;
      }
      if (message.kind === "progress")
        onProgress({
          state: "separating",
          phase: "inference",
          progress: message.progress ?? 0,
          message: message.message ?? "Separating stems",
        });
      else if (message.kind === "done") stems = message.stems ?? [];
      else if (message.kind === "error") failure = message.message ?? null;
    };
    try {
      await runProcess(
        command,
        // prettier-ignore
        [...args, "separate", "--input", request.inputPath,
         "--output", request.outputDirectory,
         "--rate", String(request.source.sampleRate),
         "--channels", String(request.source.channels),
         "--frames", String(request.source.frames),
         "--parent-pid", String(process.pid)],
        // Windows watches --parent-pid instead: a pending stdin read there can stall the worker.
        { env, signal, onLine, holdStdin: process.platform !== "win32" },
      );
    } catch (error) {
      if (failure) throw new Error(`SEPARATION_FAILED: ${failure}`);
      throw error;
    }
    const produced = (stems ?? []) as string[];
    const missing = STEMS.filter((stem) => !produced.includes(stem));
    if (missing.length)
      throw new Error(`OUTPUT_MISSING: no ${missing.join(", ")} stem`);
    return [...STEMS];
  }
}
