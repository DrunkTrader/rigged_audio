import { describe, expect, it } from "vitest";
import { byteRange, mixGraph } from "./media";

describe("byteRange", () => {
  it.each([
    ["bytes=0-99", { start: 0, end: 99 }],
    ["bytes=100-", { start: 100, end: 999 }],
    ["bytes=-100", { start: 900, end: 999 }],
    ["bytes=900-5000", { start: 900, end: 999 }],
  ])("parses %s", (header, expected) => {
    expect(byteRange(header, 1000)).toEqual(expected);
  });

  it.each([[null], ["bytes=2000-"], ["bytes=5-1"], ["items=0-1"], ["bytes=-"]])(
    "ignores %s",
    (header) => {
      expect(byteRange(header, 1000)).toBeNull();
    },
  );
});

describe("mixGraph", () => {
  it("sums without normalising, so levels match the live mixer", () => {
    const graph = mixGraph([0.5, 1], 0.8, 24);
    expect(graph).toContain("[0:a]volume=0.5[s0]");
    expect(graph).toContain("amix=inputs=2:normalize=0");
    expect(graph).toContain("volume=0.8");
  });

  it("dithers only when reducing to 16-bit", () => {
    expect(mixGraph([1], 1, 16)).toContain("dither_method=triangular");
    expect(mixGraph([1], 1, 24)).not.toContain("dither");
  });
});
