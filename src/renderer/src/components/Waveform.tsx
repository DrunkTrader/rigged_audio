import { memo, useEffect, useRef } from "react";
import { computePeaks } from "../audio/mixer";

const COLUMNS = 900;
const HEIGHT = 112;

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
    if (!buffer) return;
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
      buffer.getChannelData(i),
    );
    computePeaks(channels, COLUMNS).forEach((peak, x) => {
      const height = Math.max(1, peak * HEIGHT);
      context.fillRect(x, (HEIGHT - height) / 2, 1, height);
    });
  }, [buffer, color]);
  return <canvas ref={canvas} width={COLUMNS} height={HEIGHT} />;
});

export function Waveform({
  label,
  buffer,
  color,
  position,
  duration,
  onSeek,
}: {
  label: string;
  buffer?: AudioBuffer;
  color: string;
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
      <Peaks buffer={buffer} color={color} />
      <i style={{ left: `${percent}%` }} />
    </div>
  );
}
