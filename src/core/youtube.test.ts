import { describe, expect, it } from "vitest";
import { fakeTool, tempDirectory } from "./test-helper";
import {
  parseSearchResults,
  parseYouTubeId,
  YouTubeClient,
  youTubeError,
} from "./youtube";

const ID = "dQw4w9WgXcQ";

describe("parseYouTubeId", () => {
  it.each([
    [ID],
    [`https://www.youtube.com/watch?v=${ID}&t=10`],
    [`https://music.youtube.com/watch?v=${ID}`],
    [`https://youtu.be/${ID}?si=abc`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://m.youtube.com/watch?v=${ID}`],
  ])("accepts %s", (input) => {
    expect(parseYouTubeId(input)).toBe(ID);
  });

  it.each([
    ["https://evil.example/watch?v=dQw4w9WgXcQ"],
    ["https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ"],
    ["http://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?v=short"],
    ["--exec=rm"],
    ["file:///etc/passwd"],
    [""],
  ])("rejects %s", (input) => {
    expect(() => parseYouTubeId(input)).toThrow(/YOUTUBE_URL_INVALID/);
  });
});

describe("parseSearchResults", () => {
  it("keeps valid entries and builds thumbnails from the id", () => {
    const results = parseSearchResults([
      JSON.stringify({ id: ID, title: "Song", channel: "Band", duration: 212 }),
      JSON.stringify({ id: "bad id", title: "Skipped" }),
      "not json",
    ]);
    expect(results).toEqual([
      {
        id: ID,
        title: "Song",
        channel: "Band",
        durationSeconds: 212,
        thumbnail: `https://i.ytimg.com/vi/${ID}/mqdefault.jpg`,
      },
    ]);
  });
});

describe("youTubeError", () => {
  it("explains a bot block with something the user can do", () => {
    const error = youTubeError(
      new Error("ERROR: Sign in to confirm you’re not a bot."),
    );
    expect(error.message).toMatch(/^YOUTUBE_BLOCKED: .*local file/);
  });

  it("keeps cancel codes intact", () => {
    expect(youTubeError(new Error("CANCELED: x")).message).toBe("CANCELED: x");
  });
});

const tool = (script: string) => new YouTubeClient(() => fakeTool(script));

const downloader = `
  const fs = require("fs"), path = require("path");
  const args = process.argv.slice(2);
  const output = args[args.indexOf("-o") + 1];
  const name = output.includes("video") ? "video.mp4" : "audio.webm";
  if (args[args.indexOf("--") + 1] !== "https://www.youtube.com/watch?v=${ID}") process.exit(9);
  if (!args.includes("--progress")) process.exit(9);
  if (name === "video.mp4" && process.env.NO_VIDEO) process.exit(1);
  console.log("TITLE A Song");
  console.log("PCT  50.0%");
  fs.writeFileSync(path.join(path.dirname(output), name), "media");
`;

describe("YouTubeClient", () => {
  it("search sends the query as one argument, never as an option", async () => {
    const client = tool(`
      const query = process.argv[process.argv.length - 1];
      console.log(JSON.stringify({ id: "${ID}", title: query }));
    `);
    const [result] = await client.search("--exec evil");
    expect(result.title).toBe("ytsearch12:--exec evil");
  });

  it("downloads audio and video, scaling progress across both", async () => {
    const events: number[] = [];
    const result = await tool(downloader).download(
      ID,
      tempDirectory(),
      "ffmpeg",
      (event) => events.push(event.progress),
      new AbortController().signal,
    );
    expect(result.title).toBe("A Song");
    expect(result.audio).toMatch(/audio\.webm$/);
    expect(result.video).toMatch(/video\.mp4$/);
    expect(events).toEqual([40, 90]);
  });

  it("still succeeds when only the preview video fails", async () => {
    process.env.NO_VIDEO = "1";
    try {
      const result = await tool(downloader).download(
        ID,
        tempDirectory(),
        "ffmpeg",
        () => undefined,
        new AbortController().signal,
      );
      expect(result.audio).toBeTruthy();
      expect(result.video).toBeUndefined();
    } finally {
      delete process.env.NO_VIDEO;
    }
  });

  it("surfaces a refused download", async () => {
    const client = tool(`
      console.error("ERROR: Sign in to confirm you're not a bot");
      process.exit(1);
    `);
    await expect(
      client.download(
        ID,
        tempDirectory(),
        "ffmpeg",
        () => undefined,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/YOUTUBE_BLOCKED/);
  });
});
