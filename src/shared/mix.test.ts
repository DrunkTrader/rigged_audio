import { describe, expect, it } from "vitest";
import { activePreset, applyPreset, laneGain, type Mix } from "./mix";
import { STEMS } from "./types";

const base: Mix = {
  master: 0.7,
  lanes: { bass: { volume: 0.4, muted: true, solo: true } },
};

const audible = (mix: Mix): string[] =>
  STEMS.filter((id) => laneGain(mix, id) > 0);

describe("presets", () => {
  it("Karaoke mutes vocals only", () => {
    expect(audible(applyPreset(base, "karaoke"))).toEqual([
      "drums",
      "bass",
      "guitar",
      "piano",
      "other",
    ]);
  });

  it("Acapella isolates vocals", () => {
    expect(audible(applyPreset(base, "acapella"))).toEqual(["vocals"]);
  });

  it("All Stems enables everything", () => {
    expect(audible(applyPreset(base, "all"))).toEqual([...STEMS]);
  });

  it("Drums + Bass enables exactly those", () => {
    expect(audible(applyPreset(base, "rhythm"))).toEqual(["drums", "bass"]);
  });

  it("keeps volumes and master, and clears solo", () => {
    const mix = applyPreset(base, "all");
    expect(mix.master).toBe(0.7);
    expect(mix.lanes.bass).toEqual({ volume: 0.4, muted: false, solo: false });
  });

  it("recognises the active preset, and stops once it is edited", () => {
    const mix = applyPreset(base, "karaoke");
    expect(activePreset(mix)).toBe("karaoke");
    const edited: Mix = {
      ...mix,
      lanes: { ...mix.lanes, drums: { volume: 1, muted: true, solo: false } },
    };
    expect(activePreset(edited)).toBeNull();
  });
});

describe("laneGain", () => {
  it("defaults to full volume", () => {
    expect(laneGain({ master: 1, lanes: {} }, "drums")).toBe(1);
  });

  it("lets solo silence other lanes, and mute beats solo", () => {
    const mix: Mix = {
      master: 1,
      lanes: {
        vocals: { volume: 0.5, muted: false, solo: true },
        drums: { volume: 1, muted: true, solo: true },
      },
    };
    expect(laneGain(mix, "vocals")).toBe(0.5);
    expect(laneGain(mix, "drums")).toBe(0);
    expect(laneGain(mix, "bass")).toBe(0);
  });
});
