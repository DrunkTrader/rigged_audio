import {
  contextBridge,
  ipcRenderer,
  webUtils,
  type IpcRendererEvent,
} from "electron";
import type {
  JobEvent,
  RiggedAudioApi,
  SetupEvent,
  YouTubeProgress,
} from "../shared/types";

function subscribe<T>(
  channel: string,
  callback: (value: T) => void,
): () => void {
  const listener = (_event: IpcRendererEvent, value: T): void =>
    callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: RiggedAudioApi = {
  pickAudio: () => ipcRenderer.invoke("audio:pick"),
  pathForFile: (file) => webUtils.getPathForFile(file),
  importAudio: (path) => ipcRenderer.invoke("library:import", path),
  listProjects: () => ipcRenderer.invoke("library:list"),
  listJobs: () => ipcRenderer.invoke("library:jobs"),
  startSeparation: (projectId) => ipcRenderer.invoke("job:start", projectId),
  cancelJob: (jobId) => ipcRenderer.invoke("job:cancel", jobId),
  exportProject: (projectId, options) =>
    ipcRenderer.invoke("project:export", projectId, options),
  deleteProject: (projectId) => ipcRenderer.invoke("project:delete", projectId),
  updateMix: (projectId, mix) =>
    ipcRenderer.invoke("project:mix", projectId, mix),
  runtimeStatus: () => ipcRenderer.invoke("runtime:status"),
  installRuntime: () => ipcRenderer.invoke("runtime:install"),
  cancelInstall: () => ipcRenderer.invoke("runtime:cancel"),
  searchYouTube: (query) => ipcRenderer.invoke("youtube:search", query),
  importYouTube: (urlOrId) => ipcRenderer.invoke("youtube:import", urlOrId),
  cancelYouTube: () => ipcRenderer.invoke("youtube:cancel"),
  updateYouTubeSupport: () => ipcRenderer.invoke("youtube:update"),
  onJobEvent: (callback) => subscribe<JobEvent>("job:event", callback),
  onSetupEvent: (callback) => subscribe<SetupEvent>("setup:event", callback),
  onYouTubeProgress: (callback) =>
    subscribe<YouTubeProgress>("youtube:progress", callback),
};

contextBridge.exposeInMainWorld("riggedAudio", api);
