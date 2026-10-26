import type { RiggedAudioApi } from "../../shared/types";

declare global {
  interface Window {
    riggedAudio: RiggedAudioApi;
  }
}

export {};
