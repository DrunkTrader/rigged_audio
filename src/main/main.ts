import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { join } from "node:path";
import { RiggedAudioService } from "../core/service";
import type { JobEvent, ProjectRecord } from "../shared/types";

let windowRef: BrowserWindow | null = null;
let service: RiggedAudioService;

function dataDirectory(): string {
  return (
    process.env.RIGGED_AUDIO_DATA_DIR ||
    join(app.getPath("userData"), "rigged-audio")
  );
}

function sendJobEvent(event: JobEvent): void {
  windowRef?.webContents.send("job:event", event);
}

function createWindow(): void {
  windowRef = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#0b0d12",
    show: false,
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
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) void windowRef.loadURL(rendererUrl);
  else void windowRef.loadFile(join(__dirname, "../../dist/index.html"));
}

function registerIpc(): void {
  ipcMain.handle("audio:pick", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose a WAV source",
      buttonLabel: "Inspect source",
      properties: ["openFile"],
      filters: [{ name: "PCM WAV audio", extensions: ["wav"] }],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("library:import", (_event, sourcePath: string) =>
    service.importAudio(sourcePath),
  );
  ipcMain.handle("library:list", () => service.listProjects());
  ipcMain.handle("library:get", (_event, projectId: string) =>
    service.getProject(projectId),
  );
  ipcMain.handle("job:start", (_event, projectId: string) =>
    service.startSeparation(projectId),
  );
  ipcMain.handle("job:cancel", (_event, jobId: string) =>
    service.cancelJob(jobId),
  );
  ipcMain.handle("stems:read", (_event, projectId: string) =>
    service.readStems(projectId),
  );
  ipcMain.handle("project:delete", (_event, projectId: string) =>
    service.deleteProject(projectId),
  );
  ipcMain.handle(
    "project:mix",
    (_event, projectId: string, mix: ProjectRecord["mix"]) =>
      service.updateMix(projectId, mix),
  );
  ipcMain.handle("project:export", async (_event, projectId: string) => {
    const result = await dialog.showOpenDialog({
      title: "Choose an export folder",
      buttonLabel: "Export stems",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { saved: false };
    return service.exportProject(projectId, result.filePaths[0]);
  });
}

app.whenReady().then(() => {
  service = new RiggedAudioService(dataDirectory());
  service.onJobEvent(sendJobEvent);
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
