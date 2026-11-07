import type { StemId } from "../../shared/types";

export const STEM_META: Record<StemId, { label: string; color: string }> = {
  vocals: { label: "Vocals", color: "#ff9b71" },
  drums: { label: "Drums", color: "#f5c56b" },
  bass: { label: "Bass", color: "#8bd3c7" },
  guitar: { label: "Guitar", color: "#f27a9c" },
  piano: { label: "Piano", color: "#7fb2ff" },
  other: { label: "Other", color: "#a88bff" },
};

export function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/** Strips Electron's IPC prefix and our CODE: prefix, leaving the sentence. */
export function errorText(reason: unknown): string {
  const text = reason instanceof Error ? reason.message : String(reason);
  return text
    .replace(/^Error invoking remote method '[^']+': /, "")
    .replace(/^Error: /, "")
    .replace(/^[A-Z0-9_]+: /, "");
}

export function mediaUrl(projectId: string, kind: string): string {
  return `rigged-media://media/${projectId}/${kind}`;
}
