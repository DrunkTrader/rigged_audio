import type { MixLane, ProjectRecord, StemId } from "../../../shared/types";

type Buffers = Partial<Record<StemId, AudioBuffer>>;

export class StemMixer {
  private context: AudioContext | null = null;
  private buffers: Buffers = {};
  private gains: Partial<Record<StemId, GainNode>> = {};
  private master: GainNode | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private anchorPosition = 0;
  private anchorContextTime = 0;
  private playing = false;

  async load(payload: Partial<Record<StemId, Uint8Array>>): Promise<Buffers> {
    this.stopSources();
    const context = this.ensureContext();
    const decoded = await Promise.all(
      Object.entries(payload).map(async ([id, bytes]) => {
        if (!bytes) return [id, null] as const;
        const copy = bytes.slice().buffer;
        return [id, await context.decodeAudioData(copy)] as const;
      }),
    );
    this.buffers = Object.fromEntries(
      decoded.filter(([, buffer]) => buffer),
    ) as Buffers;
    this.gains = {};
    for (const id of Object.keys(this.buffers) as StemId[]) {
      const gain = context.createGain();
      gain.connect(this.master!);
      this.gains[id] = gain;
    }
    this.seek(0);
    return this.buffers;
  }

  applyMix(mix: ProjectRecord["mix"]): void {
    const entries = Object.entries(mix.lanes) as [
      StemId,
      MixLane | undefined,
    ][];
    const soloed = new Set(
      entries.filter(([, lane]) => lane?.solo).map(([id]) => id),
    );
    for (const id of Object.keys(this.gains) as StemId[]) {
      const lane = mix.lanes[id];
      const audible = !lane?.muted && (soloed.size === 0 || soloed.has(id));
      this.gains[id]!.gain.value = audible ? (lane?.volume ?? 1) : 0;
    }
    if (this.master) this.master.gain.value = mix.master;
  }

  play(position = this.position()): void {
    this.playing = true;
    this.anchorPosition = position;
    this.startSources(position);
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
    return Math.min(
      this.duration(),
      this.anchorPosition + (this.context.currentTime - this.anchorContextTime),
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

  dispose(): void {
    this.stopSources();
    void this.context?.close();
    this.context = null;
    this.buffers = {};
  }

  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
    }
    return this.context;
  }

  private startSources(position: number): void {
    const context = this.ensureContext();
    void context.resume();
    this.stopSources();
    const startAt = context.currentTime + 0.035;
    for (const [id, buffer] of Object.entries(this.buffers) as [
      StemId,
      AudioBuffer,
    ][]) {
      if (!buffer || position >= buffer.duration) continue;
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
