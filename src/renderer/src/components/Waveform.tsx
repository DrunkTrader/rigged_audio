import { memo, useEffect, useRef } from "react";
import { computePeaks } from "../audio/mixer";

const COLUMNS = 600;
const HEIGHT = 96;

const Peaks = memo(function Peaks({
  buffer,
  color,
}: {
  buffer?: AudioBuffer;
  color: string;
}): React.ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, COLUMNS, HEIGHT);
    context.fillStyle = color;
    // A hairline centre, so silent passages still read as part of the track.
    context.fillRect(0, HEIGHT / 2 - 0.5, COLUMNS, 1);
    if (!buffer) return;
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
      buffer.getChannelData(i),
    );
    computePeaks(channels, COLUMNS).forEach((peak, x) => {
      // Square root, roughly how loudness is heard, so quiet stems stay readable.
      const height = Math.max(1, Math.sqrt(peak) * HEIGHT);
      context.fillRect(x, (HEIGHT - height) / 2, 0.7, height);
    });
  }, [buffer, color]);
  return <canvas ref={canvas} width={COLUMNS} height={HEIGHT} />;
});

export function Waveform({
  label,
  buffer,
  color,
  restColor,
  position,
  duration,
  onSeek,
}: {
  label: string;
  buffer?: AudioBuffer;
  color: string;
  /** Unplayed part; the played part is drawn in the stem colour. */
  restColor: string;
  position: number;
  duration: number;
  onSeek: (seconds: number) => void;
}): React.ReactElement {
  const seekTo = (event: React.PointerEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, Math.min(1, fraction)) * duration);
  };
  const percent = duration ? Math.min(100, (position / duration) * 100) : 0;
  return (
    <div
      className="waveform"
      role="slider"
      tabIndex={0}
      aria-label={`Seek using the ${label} waveform`}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(position)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        seekTo(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          seekTo(event);
      }}
      onKeyDown={(event) => {
        const step = { ArrowLeft: -5, ArrowRight: 5 }[event.key];
        if (!step) return;
        event.preventDefault();
        event.stopPropagation();
        onSeek(position + step);
      }}
    >
      <Peaks buffer={buffer} color={restColor} />
      {/* clip-path, not a redraw: the playhead moves 20 times a second. */}
      <div
        className="played"
        style={{ clipPath: `inset(0 ${100 - percent}% 0 0)` }}
      >
        <Peaks buffer={buffer} color={color} />
      </div>
      <i style={{ left: `${percent}%` }} />
    </div>
  );
}
