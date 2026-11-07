import { useState } from "react";
import {
  STEMS,
  type BitDepth,
  type ExportOptions,
  type ProjectRecord,
  type StemId,
} from "../../../shared/types";
import { errorText, STEM_META } from "../format";

export function ExportPanel({
  project,
  beforeExport,
}: {
  project: ProjectRecord;
  beforeExport: () => Promise<void>;
}): React.ReactElement {
  const [stems, setStems] = useState<StemId[]>([...STEMS]);
  const [mix, setMix] = useState(false);
  const [bitDepth, setBitDepth] = useState<BitDepth>(24);
  const [sampleRate, setSampleRate] =
    useState<ExportOptions["sampleRate"]>("source");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const run = async (): Promise<void> => {
    setBusy(true);
    setResult(null);
    try {
      await beforeExport();
      const saved = await window.riggedAudio.exportProject(project.id, {
        stems,
        mix,
        bitDepth,
        sampleRate,
      });
      if (saved.saved)
        setResult({
          ok: true,
          text: `Saved to ${saved.path ?? "your folder"}`,
        });
    } catch (reason) {
      setResult({ ok: false, text: errorText(reason) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="export" aria-label="Export">
      <h2>Export</h2>
      <div className="export-choices">
        {STEMS.map((id) => (
          <label key={id}>
            <input
              type="checkbox"
              checked={stems.includes(id)}
              onChange={(event) =>
                setStems((current) =>
                  event.target.checked
                    ? [...current, id]
                    : current.filter((stem) => stem !== id),
                )
              }
            />
            {STEM_META[id].label}
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={mix}
            onChange={(event) => setMix(event.target.checked)}
          />
          Current mix
        </label>
      </div>
      <div className="export-row">
        <label>
          Quality
          <select
            value={bitDepth}
            onChange={(event) =>
              setBitDepth(Number(event.target.value) as BitDepth)
            }
          >
            <option value={16}>16-bit</option>
            <option value={24}>24-bit</option>
            <option value={32}>32-bit float</option>
          </select>
        </label>
        <label>
          Sample rate
          <select
            value={sampleRate}
            onChange={(event) =>
              setSampleRate(
                event.target.value === "source"
                  ? "source"
                  : (Number(event.target.value) as 44100 | 48000),
              )
            }
          >
            <option value="source">
              Original ({project.source.sampleRate.toLocaleString()} Hz)
            </option>
            <option value={44100}>44,100 Hz</option>
            <option value={48000}>48,000 Hz</option>
          </select>
        </label>
        <button
          className="button primary"
          type="button"
          disabled={busy || (!stems.length && !mix)}
          onClick={() => void run()}
        >
          {busy ? "Exporting" : "Export WAV"}
        </button>
      </div>
      {result && (
        <p className={result.ok ? "success" : "alert"} role="status">
          {result.text}
        </p>
      )}
    </section>
  );
}
