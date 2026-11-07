import { readdirSync } from "node:fs";
import { join } from "node:path";
import { runProcess } from "./media";
import type { WorkerCommand } from "./runtime";
import type { YouTubeProgress, YouTubeResult } from "../shared/types";

const HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);
const ID = /^[\w-]{11}$/;

/** Only a bare video id ever reaches yt-dlp, never a user-supplied URL. */
export function parseYouTubeId(input: string): string {
  const value = input.trim();
  if (ID.test(value)) return value;
  let id: string | null = null;
  try {
    const url = new URL(value);
    if (HOSTS.has(url.hostname) && url.protocol === "https:") {
      const segments = url.pathname.split("/").filter(Boolean);
      if (url.hostname === "youtu.be") id = segments[0] ?? null;
      else if (["shorts", "embed", "live"].includes(segments[0]))
        id = segments[1] ?? null;
      else id = url.searchParams.get("v");
    }
  } catch {
    id = null;
  }
  if (!id || !ID.test(id))
    throw new Error("YOUTUBE_URL_INVALID: paste a YouTube video link");
  return id;
}

export function parseSearchResults(lines: string[]): YouTubeResult[] {
  return lines.flatMap((line) => {
    try {
      const entry = JSON.parse(line) as {
        id?: string;
        title?: string;
        channel?: string;
        uploader?: string;
        duration?: number;
      };
      if (!entry.id || !ID.test(entry.id) || !entry.title) return [];
      return [
        {
          id: entry.id,
          title: entry.title,
          channel: entry.channel ?? entry.uploader ?? "",
          durationSeconds: entry.duration ?? null,
          thumbnail: `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg`,
        },
      ];
    } catch {
      return [];
    }
  });
}

export function youTubeError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/^(CANCELED|RUNTIME_MISSING):/.test(message)) return new Error(message);
  if (/confirm you.re not a bot|HTTP Error 429/i.test(message))
    return new Error(
      "YOUTUBE_BLOCKED: YouTube refused this connection. Try another network, or import a local file instead.",
    );
  const last = message.trim().split("\n").pop() ?? "";
  return new Error(`YOUTUBE_FAILED: ${last.replace(/^ERROR:\s*/, "")}`);
}

export class YouTubeClient {
  constructor(private readonly tool: () => WorkerCommand) {}

  async search(query: string, signal?: AbortSignal): Promise<YouTubeResult[]> {
    const text = query.trim().slice(0, 200);
    if (!text) return [];
    const { command, args, env } = this.tool();
    const lines: string[] = [];
    try {
      await runProcess(
        command,
        [...args, "--flat-playlist", "--dump-json", `ytsearch12:${text}`],
        { env, signal, onLine: (line) => lines.push(line) },
      );
    } catch (error) {
      throw youTubeError(error);
    }
    return parseSearchResults(lines.filter((line) => line.startsWith("{")));
  }

  /** Fetches the best audio stream only; the video plays from YouTube's own player. */
  async download(
    id: string,
    directory: string,
    ffmpeg: string,
    onProgress: (event: YouTubeProgress) => void,
    signal: AbortSignal,
  ): Promise<{ audio: string; title: string }> {
    const { command, args, env } = this.tool();
    let title = id;
    try {
      await runProcess(
        command,
        // prettier-ignore
        // --print implies quiet mode, which would hide progress without --progress
        [...args, "--no-playlist", "--newline", "--no-simulate", "--progress",
         "--match-filter", "duration<=?1200",
         "--print", "before_dl:TITLE %(title)s",
         "--progress-template", "download:PCT %(progress._percent_str)s",
         // Highest bitrate audio-only stream, kept as-is: ffmpeg decodes it once on import.
         "--ffmpeg-location", ffmpeg, "-f", "bestaudio/best", "-S", "abr",
         "-o", join(directory, "audio.%(ext)s"),
         "--", `https://www.youtube.com/watch?v=${id}`],
        {
          env,
          signal,
          onLine: (line) => {
            const percent = line.match(/^PCT\s+([\d.]+)%/);
            if (percent)
              onProgress({
                progress: Math.round(Number(percent[1])),
                message: "Downloading audio",
              });
            else if (line.startsWith("TITLE ")) title = line.slice(6);
          },
        },
      );
    } catch (error) {
      throw youTubeError(error);
    }
    const file = readdirSync(directory).find(
      (item) => item.startsWith("audio.") && !item.endsWith(".part"),
    );
    if (!file)
      throw new Error(
        "YOUTUBE_FAILED: nothing was downloaded. Videos over 20 minutes are not supported.",
      );
    return { audio: join(directory, file), title };
  }
}
