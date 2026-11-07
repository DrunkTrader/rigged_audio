import { useEffect, useState } from "react";
import type { StemId } from "../../shared/types";

export type Theme = "dark" | "light";

// Light values are deeper so waveforms keep contrast on a pale surface.
export const STEM_META: Record<
  StemId,
  { label: string; color: Record<Theme, string> }
> = {
  vocals: { label: "Vocals", color: { dark: "#ff8a5c", light: "#e0532a" } },
  drums: { label: "Drums", color: { dark: "#ffcc4d", light: "#c78a00" } },
  bass: { label: "Bass", color: { dark: "#46c8f0", light: "#0b86b8" } },
  guitar: { label: "Guitar", color: { dark: "#f46fb2", light: "#cf2f86" } },
  piano: { label: "Piano", color: { dark: "#a58bff", light: "#6d48f0" } },
  other: { label: "Other", color: { dark: "#4fe0c0", light: "#0d9a80" } },
};

const THEME_KEY = "rigged.theme";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    /* storage can be unavailable; fall back to the system setting */
  }
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** The chosen theme, applied to <html> and the native title bar. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    void window.riggedAudio.setTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* the theme simply resets next launch */
    }
  }, [theme]);
  return [theme, () => setTheme((now) => (now === "dark" ? "light" : "dark"))];
}

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
