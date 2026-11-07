// Release guard. Exits non-zero with every problem listed.
//   node scripts/check-release.mjs                      versions agree (package.json, lockfile, the v* tag in CI)
//   node scripts/check-release.mjs --tag v0.2.0         same, against an explicit tag
//   node scripts/check-release.mjs --artifacts [plat]   after `npm run dist:*`: installers, checksums and packaged contents
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const problems = [];
const fail = (msg) => problems.push(msg);
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;

function checkVersions() {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version))
    fail(`package.json version "${version}" is not semver`);
  const lock = JSON.parse(
    readFileSync(join(root, "package-lock.json"), "utf8"),
  );
  if (lock.version !== version || lock.packages?.[""]?.version !== version)
    fail(
      `package-lock.json version (${lock.version}) differs from package.json (${version}); run npm install`,
    );
  const i = args.indexOf("--tag");
  const tag =
    i >= 0
      ? args[i + 1]
      : process.env.GITHUB_REF_TYPE === "tag"
        ? process.env.GITHUB_REF_NAME
        : null;
  if (tag && tag !== `v${version}`)
    fail(
      `tag ${tag} does not match package.json version ${version} (expected v${version})`,
    );
  console.log(`version ${version}${tag ? `, tag ${tag}` : ""}`);
}

// Expected installers per platform; every name carries the version, so releases never overwrite each other.
const EXPECTED = {
  windows: [
    `Rigged-Audio-${version}-Windows-x64-Setup.exe`,
    `Rigged-Audio-${version}-Windows-x64-Portable.exe`,
  ],
  linux: [
    `Rigged-Audio-${version}-Linux-x86_64.AppImage`,
    `rigged-audio_${version}_amd64.deb`,
  ],
  macos: ["x64", "arm64"].flatMap((a) => [
    `Rigged-Audio-${version}-macOS-${a}.dmg`,
    `Rigged-Audio-${version}-macOS-${a}.zip`,
  ]),
};
// The AI runtime is downloaded on first run, so an installer this big means something got bundled.
const MAX_BYTES = 250 * 1024 ** 2;

/** Reads an asar archive's file index (a Chromium pickle header) and single files from it. */
function asar(path) {
  const fd = openSync(path, "r");
  const head = Buffer.alloc(16);
  readSync(fd, head, 0, 16, 0);
  const pickle = head.readUInt32LE(4);
  const size = head.readUInt32LE(12);
  const json = Buffer.alloc(size);
  readSync(fd, json, 0, size, 16);
  const index = JSON.parse(json.toString("utf8"));
  const node = (p) =>
    p
      .split("/")
      .filter(Boolean)
      .reduce((n, part) => n?.files?.[part], index);
  const read = (p) => {
    const n = node(p);
    if (!n || n.unpacked) return null;
    const buf = Buffer.alloc(n.size);
    readSync(fd, buf, 0, n.size, 8 + pickle + Number(n.offset));
    return buf;
  };
  const list = [];
  const walk = (n, prefix) => {
    for (const [k, v] of Object.entries(n.files ?? {}))
      v.files ? walk(v, `${prefix}/${k}`) : list.push(`${prefix}/${k}`);
  };
  walk(index, "");
  return { has: (p) => !!node(p), read, list, close: () => closeSync(fd) };
}

function checkResources(resources, label) {
  if (!existsSync(join(resources, "python", "worker.py")))
    fail(
      `${label}: resources/python/worker.py is missing (setup and separation need it)`,
    );
  const archive = join(resources, "app.asar");
  if (!existsSync(archive))
    return fail(`${label}: resources/app.asar is missing`);
  const a = asar(archive);
  for (const p of [
    "/package.json",
    "/dist/index.html",
    "/dist-electron/main/main.js",
    "/dist-electron/preload/preload.js",
    "/assets/icon.png",
  ])
    if (!a.has(p)) fail(`${label}: app.asar lacks ${p}`);
  const inner = JSON.parse(a.read("/package.json")?.toString("utf8") ?? "{}");
  if (inner.version !== version)
    fail(
      `${label}: packaged app reports version ${inner.version}, expected ${version}`,
    );
  const tests = a.list.filter((p) => /\.test\.js$|test-helper\.js$/.test(p));
  if (tests.length)
    fail(`${label}: test files were packaged: ${tests.join(", ")}`);
  a.close();
  console.log(
    `${label}: resources ok (worker.py, app.asar ${inner.version}, ${a.list.length} files)`,
  );
}

function checkArtifacts(platform) {
  const dir = join(root, "release");
  if (!existsSync(dir))
    return fail("release/ does not exist; run npm run dist:<platform> first");
  const files = readdirSync(dir);
  const sums = join(dir, `SHA256SUMS-${platform}.txt`);
  const listed = {};
  if (existsSync(sums))
    for (const line of readFileSync(sums, "utf8").trim().split("\n")) {
      const [digest, name] = line.split(/\s+/);
      listed[name] = digest;
    }
  else fail(`SHA256SUMS-${platform}.txt is missing`);
  for (const name of EXPECTED[platform]) {
    if (!files.includes(name)) {
      fail(`missing artifact ${name}`);
      continue;
    }
    const bytes = statSync(join(dir, name)).size;
    if (bytes > MAX_BYTES)
      fail(
        `${name} is ${(bytes / 1024 ** 2).toFixed(0)} MB; the installer should not bundle the AI runtime`,
      );
    const digest = createHash("sha256")
      .update(readFileSync(join(dir, name)))
      .digest("hex");
    if (listed[name] !== digest)
      fail(
        `${name} is not in SHA256SUMS-${platform}.txt with its current hash`,
      );
    console.log(`${name}  ${(bytes / 1024 ** 2).toFixed(1)} MB  sha256 ok`);
  }
  // The unpacked app electron-builder made the installers from.
  const unpacked = {
    windows: files
      .filter((f) => /^win(-.*)?-unpacked$/.test(f))
      .map((f) => `${f}/resources`),
    linux: files
      .filter((f) => /^linux(-.*)?-unpacked$/.test(f))
      .map((f) => `${f}/resources`),
    macos: files
      .filter((f) => /^mac/.test(f) && statSync(join(dir, f)).isDirectory())
      .map((f) => `${f}/Rigged Audio.app/Contents/Resources`),
  }[platform];
  if (!unpacked.length)
    fail(`no unpacked ${platform} app in release/ to inspect`);
  for (const r of unpacked)
    existsSync(join(dir, r))
      ? checkResources(join(dir, r), r.split("/")[0])
      : fail(`${r} is missing`);
}

checkVersions();
const at = args.indexOf("--artifacts");
if (at >= 0) {
  const next = args[at + 1];
  const platform =
    next && !next.startsWith("--")
      ? next
      : ({ win32: "windows", darwin: "macos" }[process.platform] ?? "linux");
  if (!EXPECTED[platform]) fail(`unknown platform ${platform}`);
  else checkArtifacts(platform);
}
if (problems.length) {
  console.error(`\nRelease check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("release check passed");
