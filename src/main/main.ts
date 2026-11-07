import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  protocol,
  session,
  shell,
} from "electron";
import { createReadStream, mkdirSync, rmSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { DemucsEngine } from "../core/engine";
import { byteRange } from "../core/media";
import { RuntimeManager } from "../core/runtime";
import { RiggedAudioService } from "../core/service";
import { parseYouTubeId, YouTubeClient } from "../core/youtube";
import type {
  ExportOptions,
  JobEvent,
  ProjectRecord,
  SetupEvent,
} from "../shared/types";

let windowRef: BrowserWindow | null = null;
let service: RiggedAudioService;
let runtime: RuntimeManager;
let youtube: YouTubeClient;
let installing: AbortController | null = null;
let fetching: AbortController | null = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "rigged-media",
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function dataDirectory(): string {
  return (
    process.env.RIGGED_AUDIO_DATA_DIR ||
    join(app.getPath("userData"), "rigged-audio")
  );
}

function workerPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "python", "worker.py")
    : join(app.getAppPath(), "python", "worker.py");
}

function send(channel: string, value: unknown): void {
  windowRef?.webContents.send(channel, value);
}

const MIME: Record<string, string> = { ".wav": "audio/wav" };

/** YouTube refuses embeds without a Referer (error 153), and file:// pages send none. */
function identifyEmbeds(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ["https://www.youtube-nocookie.com/embed/*"] },
    (details, callback) =>
      callback({
        requestHeaders: {
          ...details.requestHeaders,
          Referer: "https://com.riggedaudio.desktop/",
        },
      }),
  );
}

/** Streams project media with Range support, so stems never cross IPC. */
function serveMedia(request: Request): Response {
  const url = new URL(request.url);
  const [projectId, kind] = url.pathname.split("/").filter(Boolean);
  let path: string;
  try {
    path = service.mediaPath(projectId ?? "", kind ?? "");
  } catch {
    return new Response(null, { status: 404 });
  }
  const size = statSync(path).size;
  const headers: Record<string, string> = {
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Content-Type": MIME[extname(path)] ?? "application/octet-stream",
  };
  const range = byteRange(request.headers.get("range"), size);
  const { start, end } = range ?? { start: 0, end: size - 1 };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  headers["Content-Length"] = String(end - start + 1);
  const body = Readable.toWeb(createReadStream(path, { start, end }));
  return new Response(body as never, { status: range ? 206 : 200, headers });
}

function createWindow(): void {
  windowRef = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#09090d",
    // Windows and Linux taskbars; macOS takes the bundle icon instead.
    icon: join(app.getAppPath(), "assets", "icon.png"),
    show: false,
    // The File/Edit menu bar clashed with the UI; Alt still shows it on Windows and Linux.
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  windowRef.once("ready-to-show", () => windowRef?.show());
  windowRef.on("closed", () => {
    windowRef = null;
  });
  windowRef.webContents.on("will-navigate", (event) => event.preventDefault());
  windowRef.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) void windowRef.loadURL(rendererUrl);
  else void windowRef.loadFile(join(__dirname, "../../dist/index.html"));
}

async function installRuntime(): Promise<void> {
  if (installing) return;
  installing = new AbortController();
  try {
    await runtime.install(
      (event: SetupEvent) => send("setup:event", event),
      installing.signal,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send("setup:event", { step: "failed", message });
    throw error;
  } finally {
    installing = null;
  }
}

async function importYouTube(urlOrId: string): Promise<ProjectRecord> {
  const id = parseYouTubeId(String(urlOrId ?? ""));
  if (fetching) throw new Error("YOUTUBE_BUSY: a download is already running");
  fetching = new AbortController();
  const directory = join(dataDirectory(), "tmp", randomUUID());
  mkdirSync(directory, { recursive: true });
  try {
    const { audio, title } = await youtube.download(
      id,
      directory,
      runtime.ffmpeg(),
      (event) => send("youtube:progress", event),
      fetching.signal,
    );
    return await service.importAudio(audio, {
      title,
      sourceUrl: `https://www.youtube.com/watch?v=${id}`,
      signal: fetching.signal,
    });
  } finally {
    fetching = null;
    rmSync(directory, { recursive: true, force: true });
  }
}

function registerIpc(): void {
  ipcMain.handle("audio:pick", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose a song",
      buttonLabel: "Import",
      properties: ["openFile"],
      filters: [
        {
          name: "Audio",
          extensions: [
            "wav",
            "mp3",
            "flac",
            "m4a",
            "aac",
            "ogg",
            "opus",
            "aiff",
          ],
        },
        { name: "All files", extensions: ["*"] },
      ],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("library:import", (_event, sourcePath: string) =>
    service.importAudio(sourcePath),
  );
  ipcMain.handle("library:list", () => service.listProjects());
  ipcMain.handle("library:jobs", () => service.listJobs());
  ipcMain.handle("job:start", (_event, projectId: string) =>
    service.startSeparation(projectId),
  );
  ipcMain.handle("job:cancel", (_event, jobId: string) =>
    service.cancelJob(jobId),
  );
  ipcMain.handle("project:delete", (_event, projectId: string) =>
    service.deleteProject(projectId),
  );
  ipcMain.handle(
    "project:mix",
    (_event, projectId: string, mix: ProjectRecord["mix"]) =>
      service.updateMix(projectId, mix),
  );
  ipcMain.handle(
    "project:export",
    async (_event, projectId: string, options: ExportOptions) => {
      const preset = process.env.RIGGED_AUDIO_EXPORT_DIR;
      if (preset) return service.exportProject(projectId, preset, options);
      const result = await dialog.showOpenDialog({
        title: "Choose an export folder",
        buttonLabel: "Export here",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) return { saved: false };
      return service.exportProject(projectId, result.filePaths[0], options);
    },
  );
  ipcMain.handle("runtime:status", () => runtime.status());
  ipcMain.handle("runtime:install", () => installRuntime());
  ipcMain.handle("runtime:cancel", () => installing?.abort());
  ipcMain.handle("youtube:search", (_event, query: string) =>
    youtube.search(String(query ?? "")),
  );
  ipcMain.handle("youtube:import", (_event, urlOrId: string) =>
    importYouTube(urlOrId),
  );
  ipcMain.handle("youtube:cancel", () => fetching?.abort());
  ipcMain.handle("youtube:update", () => runtime.updateYtDlp());
  ipcMain.handle("theme:set", (_event, theme: string) => {
    nativeTheme.themeSource = theme === "light" ? "light" : "dark";
    windowRef?.setBackgroundColor(theme === "light" ? "#f4f1ec" : "#09090d");
  });
}

// Startup clears temp files and the store is one file, so a second copy would corrupt a running one.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on("second-instance", () => {
  windowRef?.show();
  windowRef?.focus();
});

app.whenReady().then(() => {
  if (!primary) return;
  rmSync(join(dataDirectory(), "tmp"), { recursive: true, force: true });
  runtime = new RuntimeManager(dataDirectory(), workerPath());
  youtube = new YouTubeClient(() => runtime.ytDlp());
  service = new RiggedAudioService(
    dataDirectory(),
    new DemucsEngine(() => runtime.worker()),
    () => runtime.ffmpeg(),
  );
  service.onJobEvent((event: JobEvent) => send("job:event", event));
  protocol.handle("rigged-media", (request) => serveMedia(request));
  identifyEmbeds();
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let stopped = false;
app.on("before-quit", (event) => {
  if (stopped) return;
  event.preventDefault();
  stopped = true;
  installing?.abort();
  fetching?.abort();
  void (service?.shutdown() ?? Promise.resolve()).finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
