import {
  STEMS,
  type BitDepth,
  type ProjectRecord,
  type StemId,
} from "../../../shared/types";
import { Icon } from "./Icon";

export interface ExportSettings {
  bitDepth: BitDepth;
  sampleRate: "source" | 44100 | 48000;
}

export type ExportNotice = { ok: boolean; text: string } | null;

/** Format choices plus the two whole-song exports; single stems export from their lanes. */
export function ExportPanel({
  project,
  settings,
  busy,
  notice,
  onSettings,
  onExport,
}: {
  project: ProjectRecord;
  settings: ExportSettings;
  busy: boolean;
  notice: ExportNotice;
  onSettings: (settings: ExportSettings) => void;
  onExport: (stems: StemId[], mix: boolean) => void;
}): React.ReactElement {
  return (
    <section className="export" aria-label="Export">
      <div className="export-actions">
        <button
          className="button primary"
          type="button"
          disabled={busy}
          onClick={() => onExport([...STEMS], false)}
        >
          <Icon name="download" />
          {busy ? "Exporting" : "Export all stems"}
        </button>
        <button
          className="button"
          type="button"
          disabled={busy}
          onClick={() => onExport([], true)}
          title="One WAV of the mix you hear, with mutes, solos and volumes applied"
        >
          Export mix
        </button>
      </div>
      <div className="export-format">
        <label>
          <span>Format</span>
          <select
            value={settings.bitDepth}
            onChange={(event) =>
              onSettings({
                ...settings,
                bitDepth: Number(event.target.value) as BitDepth,
              })
            }
          >
            <option value={16}>WAV 16-bit</option>
            <option value={24}>WAV 24-bit</option>
            <option value={32}>WAV 32-bit float</option>
          </select>
        </label>
        <label>
          <span>Sample rate</span>
          <select
            value={settings.sampleRate}
            onChange={(event) =>
              onSettings({
                ...settings,
                sampleRate:
                  event.target.value === "source"
                    ? "source"
                    : (Number(event.target.value) as 44100 | 48000),
              })
            }
          >
            <option value="source">
              Original, {(project.source.sampleRate / 1000).toLocaleString()}{" "}
              kHz
            </option>
            <option value={44100}>44.1 kHz</option>
            <option value={48000}>48 kHz</option>
          </select>
        </label>
      </div>
      {notice && (
        <p className={notice.ok ? "success" : "alert"} role="status">
          {notice.text}
        </p>
      )}
    </section>
  );
}
