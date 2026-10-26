import {
  contextBridge,
  ipcRenderer,
  webUtils,
  type IpcRendererEvent,
} from "electron";
import type { JobEvent, ProjectRecord, RiggedAudioApi } from "../shared/types";

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
  getProject: (projectId) => ipcRenderer.invoke("library:get", projectId),
  startSeparation: (projectId) => ipcRenderer.invoke("job:start", projectId),
  cancelJob: (jobId) => ipcRenderer.invoke("job:cancel", jobId),
  readStems: (projectId) => ipcRenderer.invoke("stems:read", projectId),
  exportProject: (projectId) => ipcRenderer.invoke("project:export", projectId),
  deleteProject: (projectId) => ipcRenderer.invoke("project:delete", projectId),
  updateMix: (projectId, mix) =>
    ipcRenderer.invoke("project:mix", projectId, mix),
  onJobEvent: (callback) => subscribe<JobEvent>("job:event", callback),
};

contextBridge.exposeInMainWorld("riggedAudio", api);
