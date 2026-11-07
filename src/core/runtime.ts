import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { cpus, totalmem } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { runProcess } from "./media";
import type { RuntimeStatus, SetupEvent } from "../shared/types";

const UV_VERSION = "0.13.7";
const UV_BUILDS: Record<string, { file: string; sha256: string }> = {
  "darwin-arm64": {
    file: "uv-aarch64-apple-darwin.tar.gz",
    sha256: "81b811b57e4624df7ed3aac148e0359100d9962f3d9dce00aec533dc2e086731",
  },
  "darwin-x64": {
    file: "uv-x86_64-apple-darwin.tar.gz",
    sha256: "20c47e4c1f630b8abaff8c291fa9b9aa300fef92c4fbff95adf198b55287cda7",
  },
  "linux-x64": {
    file: "uv-x86_64-unknown-linux-gnu.tar.gz",
    sha256: "c5221ff41b7892bfc223543883600125f6a47fe845093e0f5bdff4f359196d83",
  },
  "linux-arm64": {
    file: "uv-aarch64-unknown-linux-gnu.tar.gz",
    sha256: "71279f8d3c67241e807b9d8db872d1bf541579fb9f08b7d1eb1682196d1e57dc",
  },
  "win32-x64": {
    file: "uv-x86_64-pc-windows-msvc.zip",
    sha256: "0cdc5b38fe5a8168ed6a25814f5ba43c21d313dd3187314fccb37b7cec46e021",
  },
};

// sphn has no Intel macOS or Linux arm64 wheels; numpy normally arrives through it.
const PACKAGES = ["demucs==4.1.0", "numpy", "imageio-ffmpeg"];
const YT_DLP = "yt-dlp[default,deno]";

export const MIN_FREE_BYTES = 8 * 1024 ** 3;

interface RuntimeInfo {
  device: string;
  deviceName: string | null;
  torch: string;
  ffmpeg: string;
}

export interface WorkerCommand {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** Downloads to a .part file and only keeps it if the checksum matches. */
export async function downloadVerified(
  url: string,
  destination: string,
  sha256: string,
  signal?: AbortSignal,
): Promise<void> {
  const part = `${destination}.part`;
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body)
    throw new Error(`DOWNLOAD_FAILED: ${url} returned ${response.status}`);
  const hash = createHash("sha256");
  await pipeline(
    Readable.fromWeb(response.body as never),
    async function* (source) {
      for await (const chunk of source) {
        hash.update(chunk as Buffer);
        yield chunk;
      }
    },
    createWriteStream(part),
  );
  if (hash.digest("hex") !== sha256) {
    rmSync(part, { force: true });
    throw new Error("CHECKSUM_FAILED: the download did not match its checksum");
  }
  renameSync(part, destination);
}

export class RuntimeManager {
  readonly directory: string;
  private readonly infoPath: string;
  private readonly venv: string;
  private info: RuntimeInfo | null = null;

  constructor(
    dataDirectory: string,
    private readonly workerPath: string,
  ) {
    this.directory = join(dataDirectory, "runtime");
    this.infoPath = join(this.directory, "runtime.json");
    this.venv = join(this.directory, "venv");
    mkdirSync(this.directory, { recursive: true });
    try {
      const info = JSON.parse(
        readFileSync(this.infoPath, "utf8"),
      ) as RuntimeInfo;
      if (existsSync(this.python()) && existsSync(info.ffmpeg))
        this.info = info;
    } catch {
      this.info = null;
    }
  }

  python(): string {
    return process.platform === "win32"
      ? join(this.venv, "Scripts", "python.exe")
      : join(this.venv, "bin", "python");
  }

  ffmpeg(): string {
    if (!this.info)
      throw new Error("RUNTIME_MISSING: finish setup before using audio tools");
    return this.info.ffmpeg;
  }

  /** Hugging Face stays offline here: after setup, inference never needs the network. */
  env(online = false): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${dirname(this.python())}${delimiter}${process.env.PATH ?? ""}`,
      HF_HOME: join(this.directory, "hf"),
      HF_HUB_DISABLE_TELEMETRY: "1",
      HF_HUB_OFFLINE: online ? "0" : "1",
      PYTORCH_ENABLE_MPS_FALLBACK: "1",
      PYTHONNOUSERSITE: "1",
      PYTHONUNBUFFERED: "1",
      PYTHONUTF8: "1", // Windows consoles would otherwise garble non-Latin titles
      UV_PYTHON_INSTALL_DIR: join(this.directory, "python"),
      UV_NO_CACHE: "1",
    };
    delete env.PYTHONHOME;
    delete env.PYTHONPATH;
    return env;
  }

  worker(): WorkerCommand {
    if (!this.info)
      throw new Error("RUNTIME_MISSING: finish setup before separating");
    return {
      command: this.python(),
      args: [this.workerPath],
      env: this.env(),
    };
  }

  ytDlp(): WorkerCommand {
    if (!this.info)
      throw new Error("RUNTIME_MISSING: finish setup before using YouTube");
    return {
      command: this.python(),
      args: ["-m", "yt_dlp", "--ignore-config", "--no-warnings"],
      env: this.env(true),
    };
  }

  async status(): Promise<RuntimeStatus> {
    return {
      ready: this.info !== null,
      supported: `${process.platform}-${process.arch}` in UV_BUILDS,
      device: this.info?.device ?? null,
      deviceName: this.info?.deviceName ?? null,
      torch: this.info?.torch ?? null,
      cpu: cpus()[0]?.model ?? "Unknown CPU",
      memoryBytes: totalmem(),
      diskFreeBytes: this.freeBytes(),
      gpuHint: await this.gpuHint(),
    };
  }

  async install(
    onEvent: (event: SetupEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const build = UV_BUILDS[`${process.platform}-${process.arch}`];
    if (!build)
      throw new Error(
        `PLATFORM_UNSUPPORTED: ${process.platform} ${process.arch} is not supported`,
      );
    if (this.freeBytes() < MIN_FREE_BYTES)
      throw new Error("INSUFFICIENT_DISK: setup needs 8 GB of free space");

    this.info = null;
    rmSync(this.infoPath, { force: true });
    const uv = await this.ensureUv(build, onEvent, signal);
    const env = this.env(true);
    const log =
      (step: SetupEvent["step"]) =>
      (line: string): void =>
        onEvent({ step, message: line.slice(0, 160) });

    onEvent({ step: "python", message: "Installing a private Python" });
    await runProcess(
      uv,
      // prettier-ignore
      ["venv", "--no-config", "--clear", "--python", "3.12",
       "--python-preference", "only-managed", this.venv],
      { env, signal, onLine: log("python") },
    );

    onEvent({
      step: "packages",
      message: "Installing PyTorch and Demucs. This is the largest download.",
    });
    const excludes = join(this.directory, "excludes.txt");
    writeFileSync(excludes, "sphn\n");
    await runProcess(
      uv,
      // prettier-ignore
      ["pip", "install", "--no-config", "--python", this.python(),
       "--torch-backend=auto", "--excludes", excludes, ...PACKAGES, YT_DLP],
      { env, signal, onLine: log("packages") },
    );

    onEvent({ step: "model", message: "Downloading the AI model" });
    await runProcess(this.python(), [this.workerPath, "prefetch"], {
      env,
      signal,
      onLine: log("model"),
    });

    onEvent({ step: "verify", message: "Checking your hardware" });
    let probe: RuntimeInfo | null = null;
    await runProcess(this.python(), [this.workerPath, "probe"], {
      env: this.env(),
      signal,
      onLine: (line) => {
        try {
          const message = JSON.parse(line) as RuntimeInfo & { kind?: string };
          if (message.kind === "probe") probe = message;
        } catch {
          /* library chatter, not a worker message */
        }
      },
    });
    if (!probe) throw new Error("RUNTIME_BROKEN: the hardware check failed");

    const temporary = `${this.infoPath}.tmp`;
    writeFileSync(temporary, JSON.stringify(probe, null, 2));
    renameSync(temporary, this.infoPath);
    this.info = probe;
    onEvent({ step: "done", message: "Setup complete" });
  }

  /** YouTube changes often, so yt-dlp alone is updatable without reinstalling. */
  async updateYtDlp(signal?: AbortSignal): Promise<void> {
    const uv = join(
      this.directory,
      process.platform === "win32" ? "uv.exe" : "uv",
    );
    await runProcess(
      uv,
      // prettier-ignore
      ["pip", "install", "--no-config", "--python", this.python(), "--upgrade", YT_DLP],
      { env: this.env(true), signal },
    );
  }

  private async ensureUv(
    build: { file: string; sha256: string },
    onEvent: (event: SetupEvent) => void,
    signal: AbortSignal,
  ): Promise<string> {
    const uv = join(
      this.directory,
      process.platform === "win32" ? "uv.exe" : "uv",
    );
    if (existsSync(uv)) return uv;
    onEvent({ step: "tools", message: "Downloading the installer" });
    const archive = join(this.directory, build.file);
    await downloadVerified(
      `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${build.file}`,
      archive,
      build.sha256,
      signal,
    );
    // Windows 10+ ships bsdtar, which also reads zip.
    const strip = process.platform === "win32" ? [] : ["--strip-components=1"];
    try {
      await runProcess(
        "tar",
        ["-xf", archive, "-C", this.directory, ...strip],
        { signal },
      );
    } catch (error) {
      rmSync(uv, { force: true }); // a partial binary must not pass existsSync next time
      throw error;
    } finally {
      rmSync(archive, { force: true });
    }
    return uv;
  }

  private freeBytes(): number {
    const stats = statfsSync(this.directory);
    return stats.bavail * stats.bsize;
  }

  private gpuHint(): Promise<string | null> {
    if (process.platform === "darwin")
      return Promise.resolve(process.arch === "arm64" ? "Apple GPU" : null);
    return new Promise((resolve) => {
      execFile("nvidia-smi", ["-L"], { timeout: 3000 }, (error, stdout) => {
        resolve(error ? null : stdout.split("\n")[0].replace(/ \(UUID.*/, ""));
      });
    });
  }
}
