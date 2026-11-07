import { STEMS, type ProjectRecord, type StemId } from "./types";

export type Mix = ProjectRecord["mix"];

export const PRESETS = {
  all: { label: "All Stems", stems: STEMS as readonly StemId[] },
  karaoke: {
    label: "Karaoke",
    stems: STEMS.filter((id) => id !== "vocals") as readonly StemId[],
  },
  acapella: { label: "Acapella", stems: ["vocals"] as readonly StemId[] },
  rhythm: {
    label: "Drums + Bass",
    stems: ["drums", "bass"] as readonly StemId[],
  },
};
export type PresetId = keyof typeof PRESETS;

/** Presets only flip mute and solo: volumes and the audio are left alone. */
export function applyPreset(mix: Mix, preset: PresetId): Mix {
  const enabled = PRESETS[preset].stems;
  return {
    ...mix,
    lanes: Object.fromEntries(
      STEMS.map((id) => [
        id,
        {
          volume: mix.lanes[id]?.volume ?? 1,
          muted: !enabled.includes(id),
          solo: false,
        },
      ]),
    ),
  };
}

export function activePreset(mix: Mix): PresetId | null {
  const matches = (preset: PresetId): boolean =>
    STEMS.every(
      (id) =>
        !mix.lanes[id]?.solo &&
        !!mix.lanes[id]?.muted !== PRESETS[preset].stems.includes(id),
    );
  return (Object.keys(PRESETS) as PresetId[]).find(matches) ?? null;
}

/** The one definition of what a lane sounds like, for playback and for export. */
export function laneGain(mix: Mix, id: StemId): number {
  const soloing = STEMS.some((stem) => mix.lanes[stem]?.solo);
  const lane = mix.lanes[id];
  if (lane?.muted || (soloing && !lane?.solo)) return 0;
  return lane?.volume ?? 1;
}
