import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegStatic from "ffmpeg-static";

export const ffmpegPath = ffmpegStatic as unknown as string;

export function tempDirectory(prefix = "rigged-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Header for a WAV of `frames` silent frames, optionally with a LIST chunk first. */
export function wavBytes({
  frames = 100,
  rate = 44100,
  channels = 2,
  bits = 16,
  format = 1,
  list = false,
}: {
  frames?: number;
  rate?: number;
  channels?: number;
  bits?: number;
  format?: number;
  list?: boolean;
} = {}): Buffer {
  const extensible = format === 0xfffe;
  const fmt = Buffer.alloc(extensible ? 40 : 16);
  fmt.writeUInt16LE(format, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(rate, 4);
  fmt.writeUInt32LE((rate * channels * bits) / 8, 8);
  fmt.writeUInt16LE((channels * bits) / 8, 12);
  fmt.writeUInt16LE(bits, 14);
  if (extensible) fmt.writeUInt16LE(1, 24);
  const chunk = (id: string, body: Buffer): Buffer => {
    const header = Buffer.alloc(8);
    header.write(id, 0, "latin1");
    header.writeUInt32LE(body.length, 4);
    return Buffer.concat([header, body]);
  };
  const body = Buffer.concat([
    Buffer.from("WAVE", "latin1"),
    chunk("fmt ", fmt),
    list ? chunk("LIST", Buffer.alloc(5)) : Buffer.alloc(0),
    list ? Buffer.alloc(1) : Buffer.alloc(0),
    chunk("data", Buffer.alloc((frames * channels * bits) / 8)),
  ]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

/** A stand-in executable: a Node script that the code under test spawns for real. */
export function fakeTool(script: string): {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
} {
  const path = join(tempDirectory("rigged-tool-"), "tool.js");
  writeFileSync(path, script);
  return { command: process.execPath, args: [path], env: process.env };
}
