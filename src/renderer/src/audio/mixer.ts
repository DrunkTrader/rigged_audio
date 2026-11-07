import { laneGain, type Mix } from "../../../shared/mix";
import type { StemId } from "../../../shared/types";

type Buffers = Partial<Record<StemId, AudioBuffer>>;

const START_LEAD_SECONDS = 0.035;
const GAIN_RAMP_SECONDS = 0.012;
const VIDEO_TOLERANCE_SECONDS = 0.12;

/** All stems start at one AudioContext time, so they share a clock and cannot drift. */
export class StemMixer {
  private context: AudioContext | null = null;
  private buffers: Buffers = {};
  private gains: Partial<Record<StemId, GainNode>> = {};
  private master: GainNode | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private anchorPosition = 0;
  private anchorContextTime = 0;
  private playing = false;
  private generation = 0;

  constructor(
    private readonly createContext: () => AudioContext = () =>
      new AudioContext(),
  ) {}

  /** One stem at a time, to keep peak memory near the decoded size. */
  async load(urls: Partial<Record<StemId, string>>): Promise<Buffers> {
    this.dispose();
    const generation = this.generation;
    const context = this.ensureContext();
    const buffers: Buffers = {};
    for (const [id, url] of Object.entries(urls) as [StemId, string][]) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not read the ${id} stem`);
      const decoded = await context.decodeAudioData(
        await response.arrayBuffer(),
      );
      if (generation !== this.generation) return {};
      buffers[id] = decoded;
    }
    this.buffers = buffers;
    for (const id of Object.keys(buffers) as StemId[]) {
      const gain = context.createGain();
      gain.connect(this.master!);
      this.gains[id] = gain;
    }
    return buffers;
  }

  applyMix(mix: Mix): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const id of Object.keys(this.gains) as StemId[])
      this.gains[id]!.gain.setTargetAtTime(
        laneGain(mix, id),
        now,
        GAIN_RAMP_SECONDS,
      );
    this.master?.gain.setTargetAtTime(mix.master, now, GAIN_RAMP_SECONDS);
  }

  play(position = this.position()): void {
    if (!this.isLoaded()) return;
    this.playing = true;
    this.anchorPosition = position >= this.duration() ? 0 : position;
    this.startSources(this.anchorPosition);
  }

  pause(position = this.position()): void {
    this.anchorPosition = position;
    this.playing = false;
    this.stopSources();
  }

  seek(position: number): void {
    this.anchorPosition = Math.max(0, Math.min(this.duration(), position));
    if (this.playing) this.startSources(this.anchorPosition);
  }

  position(): number {
    if (!this.playing || !this.context) return this.anchorPosition;
    const elapsed = this.context.currentTime - this.anchorContextTime;
    return Math.min(
      this.duration(),
      this.anchorPosition + Math.max(0, elapsed),
    );
  }

  duration(): number {
    return Math.max(
      0,
      ...Object.values(this.buffers).map((buffer) => buffer?.duration ?? 0),
    );
  }

  isLoaded(): boolean {
    return Object.keys(this.buffers).length > 0;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** Call from the UI clock. Returns true on the tick playback reaches the end. */
  stopIfEnded(): boolean {
    if (!this.playing || this.position() < this.duration()) return false;
    this.pause(0);
    return true;
  }

  dispose(): void {
    this.generation += 1;
    this.stopSources();
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.buffers = {};
    this.gains = {};
    this.playing = false;
    this.anchorPosition = 0;
  }

  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = this.createContext();
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
    }
    return this.context;
  }

  private startSources(position: number): void {
    const context = this.ensureContext();
    void context.resume();
    this.stopSources();
    const startAt = context.currentTime + START_LEAD_SECONDS;
    for (const [id, buffer] of Object.entries(this.buffers) as [
      StemId,
      AudioBuffer,
    ][]) {
      if (position >= buffer.duration) continue;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gains[id]!);
      source.start(startAt, position);
      this.sources.push(source);
    }
    this.anchorContextTime = startAt;
  }

  private stopSources(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* source may already have ended */
      }
      source.disconnect();
    }
    this.sources = [];
  }
}

/** Video follows the audio clock and is corrected, never the other way round. */
export function syncVideo(
  video: Pick<HTMLVideoElement, "currentTime" | "paused" | "play" | "pause">,
  position: number,
  playing: boolean,
  tolerance = VIDEO_TOLERANCE_SECONDS,
): void {
  if (Math.abs(video.currentTime - position) > tolerance)
    video.currentTime = position;
  if (playing && video.paused) void video.play();
  if (!playing && !video.paused) video.pause();
}

/** Peak per column, strided so a long track never scans every sample. */
export function computePeaks(
  channels: Float32Array[],
  columns: number,
): Float32Array {
  const peaks = new Float32Array(columns);
  const length = channels[0]?.length ?? 0;
  const span = length / columns;
  const stride = Math.max(1, Math.floor(span / 256));
  for (let column = 0; column < columns; column += 1) {
    const end = Math.min(length, Math.floor((column + 1) * span));
    let peak = 0;
    for (const data of channels)
      for (let i = Math.floor(column * span); i < end; i += stride) {
        const value = Math.abs(data[i]);
        if (value > peak) peak = value;
      }
    peaks[column] = Math.min(1, peak);
  }
  return peaks;
}
