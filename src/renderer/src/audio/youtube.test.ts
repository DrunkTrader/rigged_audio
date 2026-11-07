import { describe, expect, it } from "vitest";
import { syncVideo } from "./mixer";
import { embedUrl, YOUTUBE_ORIGIN, YouTubeVideo, youTubeId } from "./youtube";

function player() {
  let time = 0;
  const sent: { func?: string; args?: unknown[] }[] = [];
  const frame = {
    postMessage: (message: string) => sent.push(JSON.parse(message)),
  };
  const video = new YouTubeVideo(
    () => frame,
    () => time,
  );
  const report = (info: object, source: unknown = frame) =>
    video.receive({
      origin: YOUTUBE_ORIGIN,
      source: source as MessageEventSource,
      data: JSON.stringify({ event: "infoDelivery", info }),
    });
  return {
    video,
    report,
    advance: (ms: number) => (time += ms),
    funcs: () => sent.map((item) => item.func),
  };
}

describe("YouTubeVideo", () => {
  it("extrapolates the reported time only while playing", () => {
    const { video, report, advance } = player();
    report({ currentTime: 10, playerState: 1 });
    advance(500);
    expect(video.currentTime).toBeCloseTo(10.5);
    report({ playerState: 2 });
    advance(500);
    expect(video.paused).toBe(true);
  });

  it("ignores messages from other frames and origins", () => {
    const { video, report } = player();
    report({ currentTime: 42 }, {});
    video.receive({ origin: "https://evil.test", source: null, data: "{}" });
    expect(video.currentTime).toBe(0);
  });

  it("does not re-seek while YouTube is still buffering the last seek", () => {
    const { video, funcs, advance } = player();
    video.currentTime = 30;
    advance(200);
    video.currentTime = 31;
    expect(funcs().filter((func) => func === "seekTo")).toHaveLength(1);
    advance(2000);
    video.currentTime = 33;
    expect(funcs().filter((func) => func === "seekTo")).toHaveLength(2);
  });

  it("syncs from the audio clock without flooding the player", () => {
    const { video, funcs, advance } = player();
    for (let frame = 0; frame < 10; frame += 1) {
      syncVideo(video, 5, true, 0.3);
      advance(16);
    }
    expect(funcs()).toEqual(["seekTo", "playVideo"]);
  });
});

describe("YouTube urls", () => {
  it("reads the id we stored and builds a muted, control-free embed", () => {
    expect(youTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(youTubeId("https://www.youtube.com/watch?v=bad")).toBeNull();
    expect(youTubeId(undefined)).toBeNull();
    const url = new URL(embedUrl("dQw4w9WgXcQ", true));
    expect(url.origin).toBe(YOUTUBE_ORIGIN);
    expect(url.searchParams.get("mute")).toBe("1");
    expect(url.searchParams.get("controls")).toBe("0");
  });
});
