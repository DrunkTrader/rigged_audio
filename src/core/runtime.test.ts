import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { downloadVerified, RuntimeManager } from "./runtime";
import { tempDirectory } from "./test-helper";

const body = "uv binary";
const url = `data:text/plain,${encodeURIComponent(body)}`;
const sha256 = createHash("sha256").update(body).digest("hex");

describe("downloadVerified", () => {
  it("keeps a download that matches its checksum", async () => {
    const path = join(tempDirectory(), "uv");
    await downloadVerified(url, path, sha256);
    expect(readFileSync(path, "utf8")).toBe(body);
  });

  it("deletes a download that does not", async () => {
    const path = join(tempDirectory(), "uv");
    await expect(downloadVerified(url, path, "0".repeat(64))).rejects.toThrow(
      /CHECKSUM_FAILED/,
    );
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}.part`)).toBe(false);
  });
});

describe("RuntimeManager", () => {
  it("is not ready, and refuses to run tools, before setup", async () => {
    const runtime = new RuntimeManager(tempDirectory(), "/worker.py");
    const status = await runtime.status();
    expect(status.ready).toBe(false);
    expect(status.memoryBytes).toBeGreaterThan(0);
    expect(() => runtime.worker()).toThrow(/RUNTIME_MISSING/);
    expect(() => runtime.ffmpeg()).toThrow(/RUNTIME_MISSING/);
  });

  it("is ready only when the recorded install still exists", async () => {
    const data = tempDirectory();
    const first = new RuntimeManager(data, "/worker.py");
    const ffmpeg = join(data, "ffmpeg");
    writeFileSync(
      join(first.directory, "runtime.json"),
      JSON.stringify({ device: "cpu", deviceName: null, torch: "2", ffmpeg }),
    );
    expect((await new RuntimeManager(data, "/w").status()).ready).toBe(false);

    writeFileSync(ffmpeg, "");
    mkdirSync(dirname(first.python()), { recursive: true });
    writeFileSync(first.python(), "");
    const ready = new RuntimeManager(data, "/worker.py");
    expect((await ready.status()).ready).toBe(true);
    expect(ready.ffmpeg()).toBe(ffmpeg);
  });

  it("keeps inference offline, and only yt-dlp may reach the network", () => {
    const data = tempDirectory();
    const runtime = new RuntimeManager(data, "/worker.py");
    writeFileSync(join(data, "ffmpeg"), "");
    mkdirSync(dirname(runtime.python()), { recursive: true });
    writeFileSync(runtime.python(), "");
    writeFileSync(
      join(runtime.directory, "runtime.json"),
      JSON.stringify({
        device: "cpu",
        deviceName: null,
        torch: "2",
        ffmpeg: join(data, "ffmpeg"),
      }),
    );
    const ready = new RuntimeManager(data, "/worker.py");
    expect(ready.worker().env.HF_HUB_OFFLINE).toBe("1");
    expect(ready.worker().env.HF_HOME).toContain(data);
  });
});
