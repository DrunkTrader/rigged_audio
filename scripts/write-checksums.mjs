import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const releaseDirectory = join(process.cwd(), "release");
const platform =
  process.platform === "win32"
    ? "windows"
    : process.platform === "darwin"
      ? "macos"
      : "linux";
const files = readdirSync(releaseDirectory)
  .filter(
    (file) => !file.endsWith(".yml") && !/^SHA256SUMS(?:-.*)?\.txt$/.test(file),
  )
  .filter((file) => /\.(dmg|zip|exe|AppImage|deb)$/i.test(file))
  .sort();

const lines = files.map((file) => {
  const digest = createHash("sha256")
    .update(readFileSync(join(releaseDirectory, file)))
    .digest("hex");
  return `${digest}  ${file}`;
});
writeFileSync(
  join(releaseDirectory, `SHA256SUMS-${platform}.txt`),
  `${lines.join("\n")}\n`,
);
console.log(`Wrote checksums for ${files.length} release artifact(s)`);
