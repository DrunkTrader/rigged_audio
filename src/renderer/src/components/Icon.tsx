// Inline strokes, so icons follow currentColor in both themes and need no icon package.
const PATHS = {
  play: "M8 5.6v12.8a.8.8 0 0 0 1.2.7l10.4-6.4a.8.8 0 0 0 0-1.4L9.2 4.9A.8.8 0 0 0 8 5.6z",
  pause: "M7 5h3v14H7zM14 5h3v14h-3z",
  plus: "M12 5v14M5 12h14",
  download: "M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14",
  external:
    "M14 4h6v6m0-6-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10",
  trash:
    "M4.5 7h15M10 11v6m4-6v6M6.5 7l.8 11.6A1.5 1.5 0 0 0 8.8 20h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7M9.5 7V4.5h5V7",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2m0 15v2m9.5-9.5h-2m-15 0h-2m16.2-6.7-1.4 1.4M6.7 17.3l-1.4 1.4m13.4 0-1.4-1.4M6.7 6.7 5.3 5.3",
  moon: "M19.5 14.6A7.5 7.5 0 0 1 9.4 4.5a7.5 7.5 0 1 0 10.1 10.1z",
  volume:
    "M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11",
  search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.8-4.8",
  upload: "M12 15.5V4m0 0L7.5 8.5M12 4l4.5 4.5M5 19.5h14",
  vocals:
    "M12 3.5a3 3 0 0 0-3 3V12a3 3 0 0 0 6 0V6.5a3 3 0 0 0-3-3zM6 11.5a6 6 0 0 0 12 0M12 17.5v3",
  drums:
    "M4 9.5c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5M7.5 4l3.5 4.5M16.5 4 13 8.5",
  bass: "M3 12h2.5l2-5 3 10 3-8 2 5 1.5-2H21",
  guitar:
    "M20 4l-6.5 6.5M18.5 2.5l3 3M11 11.5a3.6 3.6 0 0 0-5.1-.4c-1.6 1.4-3.4 4.6-1.4 6.6s5.2.2 6.6-1.4a3.6 3.6 0 0 0-.1-4.8zM8 15.5h.01",
  piano: "M4 5h16v14H4zM9.3 13v6M14.7 13v6M8 5v8h2.6V5M13.4 5v8H16V5",
  other:
    "M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9zM18.5 16l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z",
  note: "M9 18.5V6l11-2.5v12.5M9 18.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zm11-3a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z",
} as const;

export type IconName = keyof typeof PATHS;

const FILLED = new Set<IconName>(["play", "pause"]);

export function Icon({
  name,
  size = 18,
}: {
  name: IconName;
  size?: number;
}): React.ReactElement {
  const filled = FILLED.has(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Six bars rising like a stem meter. */
export function Logo(): React.ReactElement {
  return (
    <span className="logo" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="20" height="20">
        {[5, 9, 4, 11, 7, 3].map((height, index) => (
          <rect
            key={index}
            x={2.2 + index * 3.4}
            y={12 - height / 2 - 1}
            width="2"
            height={height + 2}
            rx="1"
            fill="currentColor"
          />
        ))}
      </svg>
    </span>
  );
}
