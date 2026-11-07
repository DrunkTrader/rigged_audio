export const YOUTUBE_ORIGIN = "https://www.youtube-nocookie.com";

const PLAYING = 1;
const BUFFERING = 3;
// A seek makes YouTube buffer; correcting again before it settles would loop.
const SEEK_COOLDOWN_MS = 1500;
const COMMAND_INTERVAL_MS = 500;

/** We store YouTube sources as watch?v=<id>, so the id is the only thing to read back. */
export function youTubeId(sourceUrl?: string): string | null {
  try {
    const id = sourceUrl ? new URL(sourceUrl).searchParams.get("v") : null;
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function thumbnailUrl(id: string): string {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

/** Slaved players are muted and have no controls: the stem mix is the sound. */
export function embedUrl(id: string, slaved: boolean): string {
  const params = new URLSearchParams({
    enablejsapi: "1",
    playsinline: "1",
    rel: "0",
    iv_load_policy: "3",
  });
  if (slaved) {
    params.set("controls", "0");
    params.set("disablekb", "1");
    params.set("mute", "1");
  }
  return `${YOUTUBE_ORIGIN}/embed/${id}?${params}`;
}

interface Target {
  postMessage(message: string, origin: string): void;
}

/**
 * Drives an embedded YouTube player over its postMessage protocol, so the page
 * loads no YouTube script. Shaped like a video element so syncVideo can drive it.
 */
export class YouTubeVideo {
  private reported = 0;
  private reportedAt = 0;
  private state = -1;
  private lastSeek = -Infinity;
  private lastCommand: Record<string, number> = {};

  constructor(
    private readonly target: () => Target | null | undefined,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Starts YouTube's state reports; call when the iframe loads. */
  listen(): void {
    this.post({ event: "listening", id: 1, channel: "widget" });
  }

  receive(event: Pick<MessageEvent, "origin" | "data" | "source">): void {
    if (event.origin !== YOUTUBE_ORIGIN || event.source !== this.target())
      return;
    let data: { event?: string; info?: Record<string, unknown> | null };
    try {
      data = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (data.event === "onReady") this.command("mute", [], true);
    const info = data.info ?? {};
    if (typeof info.currentTime === "number") {
      this.reported = info.currentTime;
      this.reportedAt = this.now();
    }
    if (typeof info.playerState === "number") this.state = info.playerState;
  }

  get currentTime(): number {
    const running = this.state === PLAYING;
    return (
      this.reported + (running ? (this.now() - this.reportedAt) / 1000 : 0)
    );
  }

  set currentTime(seconds: number) {
    if (this.now() - this.lastSeek < SEEK_COOLDOWN_MS) return;
    this.lastSeek = this.now();
    this.reported = seconds;
    this.reportedAt = this.now();
    this.command("seekTo", [seconds, true], true);
  }

  get paused(): boolean {
    return this.state !== PLAYING && this.state !== BUFFERING;
  }

  play(): Promise<void> {
    this.command("playVideo");
    return Promise.resolve();
  }

  pause(): void {
    this.command("pauseVideo");
  }

  private command(func: string, args: unknown[] = [], always = false): void {
    // syncVideo asks every frame until the player reports back; send at most twice a second.
    const last = this.lastCommand[func] ?? -Infinity;
    if (!always && this.now() - last < COMMAND_INTERVAL_MS) return;
    this.lastCommand[func] = this.now();
    this.post({ event: "command", func, args, id: 1, channel: "widget" });
  }

  private post(message: object): void {
    this.target()?.postMessage(JSON.stringify(message), YOUTUBE_ORIGIN);
  }
}
