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
  const name = "audio.webm";
  if (args[args.indexOf("--") + 1] !== "https://www.youtube.com/watch?v=${ID}") process.exit(9);
  if (!args.includes("--progress")) process.exit(9);
  if (args[args.indexOf("-f") + 1] !== "bestaudio/best") process.exit(9);
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

  it("downloads only the best audio stream, with progress", async () => {
    const events: number[] = [];
    const result = await tool(downloader).download(
      ID,
      tempDirectory(),
      "ffmpeg",
      (event) => events.push(event.progress),
      new AbortController().signal,
    );
    expect(result).toEqual({
      audio: expect.stringMatching(/audio\.webm$/),
      title: "A Song",
    });
    expect(events).toEqual([50]);
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
