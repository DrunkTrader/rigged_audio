import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StemMixer } from "./audio/mixer";
import {
  STEMS,
  type JobEvent,
  type JobState,
  type MixLane,
  type ProjectRecord,
  type StemId,
} from "../../shared/types";

const STEM_META: Record<
  StemId,
  { label: string; color: string; note: string }
> = {
  vocals: { label: "Vocals", color: "#ff9b71", note: "center focus" },
  drums: { label: "Drums", color: "#f5c56b", note: "transients" },
  bass: { label: "Bass", color: "#8bd3c7", note: "low register" },
  other: { label: "Other", color: "#a88bff", note: "accompaniment" },
};

const DEFAULT_MIX: ProjectRecord["mix"] = {
  master: 0.86,
  lanes: Object.fromEntries(
    STEMS.map((id) => [id, { volume: 1, muted: false, solo: false }]),
  ),
};

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function laneFor(project: ProjectRecord, id: StemId): MixLane {
  return project.mix.lanes[id] ?? DEFAULT_MIX.lanes[id]!;
}

function latestState(
  project: ProjectRecord,
  events: Record<string, JobEvent>,
): { state: JobState | "idle"; progress: number; message: string } {
  const latest = [...project.jobIds]
    .reverse()
    .map((id) => events[id])
    .find(Boolean);
  if (!latest)
    return {
      state: project.stems.vocals ? "complete" : "idle",
      progress: project.stems.vocals ? 100 : 0,
      message: "",
    };
  if (latest.kind === "progress")
    return {
      state: latest.data.state,
      progress: latest.data.progress,
      message: latest.data.message,
    };
  if (latest.kind === "complete")
    return {
      state: "complete",
      progress: 100,
      message: "Preview stems are ready",
    };
  return { state: "failed", progress: 0, message: latest.data.error.message };
}

function Waveform({
  buffer,
  color,
  position,
  onSeek,
}: {
  buffer?: AudioBuffer;
  color: string;
  position: number;
  onSeek: (value: number) => void;
}): React.ReactElement {
  const bars = useMemo(() => {
    if (!buffer) return Array.from({ length: 72 }, () => 0.18);
    const data = buffer.getChannelData(0);
    return Array.from({ length: 72 }, (_, index) => {
      const start = Math.floor((index / 72) * data.length);
      const end = Math.max(
        start + 1,
        Math.floor(((index + 1) / 72) * data.length),
      );
      let peak = 0;
      for (
        let cursor = start;
        cursor < end;
        cursor += Math.max(1, Math.floor((end - start) / 30))
      )
        peak = Math.max(peak, Math.abs(data[cursor]));
      return Math.max(0.12, Math.min(1, peak * 1.6));
    });
  }, [buffer]);
  const fraction = buffer?.duration
    ? Math.min(1, position / buffer.duration)
    : 0;
  return (
    <button
      type="button"
      className="waveform"
      aria-label="Seek in stem waveform"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onSeek(
          ((event.clientX - rect.left) / rect.width) * (buffer?.duration ?? 0),
        );
      }}
    >
      {bars.map((height, index) => (
        <span
          key={index}
          style={{
            height: `${height * 100}%`,
            background: color,
            opacity: index / 72 < fraction ? 0.95 : 0.28,
          }}
        />
      ))}
      <i style={{ left: `${fraction * 100}%` }} />
    </button>
  );
}

function ImportPanel({
  onImport,
  disabled,
}: {
  onImport: (path: string) => void;
  disabled: boolean;
}): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const choose = (): void => inputRef.current?.click();
  return (
    <section
      className={`import-panel ${dragging ? "is-dragging" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) onImport(window.riggedAudio.pathForFile(file));
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".wav,audio/wav"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImport(window.riggedAudio.pathForFile(file));
          event.currentTarget.value = "";
        }}
      />
      <div className="import-orbit" aria-hidden="true">
        <span>+</span>
      </div>
      <div>
        <p className="eyebrow">Local source / PCM WAV</p>
        <h2>Bring a track into focus.</h2>
        <p className="muted">
          Drop a WAV here or inspect one from disk. Your original stays
          untouched.
        </p>
      </div>
      <button
        className="button primary"
        type="button"
        onClick={choose}
        disabled={disabled}
      >
        Choose audio <span aria-hidden="true">↗</span>
      </button>
      <p className="drop-hint">
        Private by default · no upload · 512 MB MVP limit
      </p>
    </section>
  );
}

function StatusPill({
  state,
}: {
  state: JobState | "idle";
}): React.ReactElement {
  const label =
    state === "complete"
      ? "Ready to play"
      : state === "idle"
        ? "Not split"
        : state === "failed"
          ? "Needs attention"
          : state;
  return (
    <span className={`status-pill ${state}`}>
      <span className="status-dot" />
      {label}
    </span>
  );
}

function StemLane({
  id,
  project,
  buffer,
  position,
  onSeek,
  onChange,
  onSolo,
  onMute,
}: {
  id: StemId;
  project: ProjectRecord;
  buffer?: AudioBuffer;
  position: number;
  onSeek: (value: number) => void;
  onChange: (lane: MixLane) => void;
  onSolo: () => void;
  onMute: () => void;
}): React.ReactElement {
  const meta = STEM_META[id];
  const lane = laneFor(project, id);
  return (
    <article className={`stem-lane ${lane.muted ? "muted" : ""}`}>
      <div className="stem-heading">
        <span className="stem-swatch" style={{ background: meta.color }} />
        <div>
          <strong>{meta.label}</strong>
          <small>{meta.note}</small>
        </div>
      </div>
      <Waveform
        buffer={buffer}
        color={meta.color}
        position={position}
        onSeek={onSeek}
      />
      <output className="volume-readout" aria-label={`${meta.label} volume`}>
        {Math.round(lane.volume * 100)}%
      </output>
      <input
        className="volume-slider"
        aria-label={`${meta.label} volume`}
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={lane.volume}
        onChange={(event) =>
          onChange({ ...lane, volume: Number(event.target.value) })
        }
      />
      <button
        className={`lane-action ${lane.muted ? "active" : ""}`}
        type="button"
        aria-pressed={lane.muted}
        onClick={onMute}
      >
        M
      </button>
      <button
        className={`lane-action ${lane.solo ? "active solo" : ""}`}
        type="button"
        aria-pressed={lane.solo}
        onClick={onSolo}
      >
        S
      </button>
    </article>
  );
}

export function App(): React.ReactElement {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, JobEvent>>({});
  const [buffers, setBuffers] = useState<Partial<Record<StemId, AudioBuffer>>>(
    {},
  );
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mixer = useRef(new StemMixer());

  const active = projects.find((project) => project.id === activeId) ?? null;
  const status = active
    ? latestState(active, events)
    : { state: "idle" as const, progress: 0, message: "" };

  const refresh = useCallback(async () => {
    const next = await window.riggedAudio.listProjects();
    setProjects(next);
    setActiveId((current) =>
      current && next.some((project) => project.id === current)
        ? current
        : (next[0]?.id ?? null),
    );
  }, []);

  useEffect(() => {
    void refresh().catch((reason) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
    return window.riggedAudio.onJobEvent((event) => {
      setEvents((current) => ({
        ...current,
        [event.kind === "progress" ? event.data.jobId : event.data.jobId]:
          event,
      }));
      if (event.kind === "complete" || event.kind === "failed") void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(
      () => setPosition(mixer.current.position()),
      80,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!active || !active.stems.vocals || status.state !== "complete") {
      mixer.current.dispose();
      setBuffers({});
      setPlaying(false);
      setPosition(0);
      return;
    }
    let disposed = false;
    setLoadingAudio(true);
    void window.riggedAudio
      .readStems(active.id)
      .then(async (payload) => {
        if (disposed) return;
        const decoded = await mixer.current.load(payload);
        mixer.current.applyMix(active.mix);
        if (!disposed) {
          setLoadingAudio(false);
          setBuffers(decoded);
        }
      })
      .catch((reason) => {
        if (!disposed) {
          setLoadingAudio(false);
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      disposed = true;
    };
  }, [active?.id, active?.stems.vocals, status.state]);

  const updateProject = (next: ProjectRecord): void =>
    setProjects((current) =>
      current.map((project) => (project.id === next.id ? next : project)),
    );
  const importPath = async (path: string): Promise<void> => {
    if (!path) return;
    setError(null);
    try {
      const project = await window.riggedAudio.importAudio(path);
      updateProject(project);
      setProjects((current) =>
        current.some((item) => item.id === project.id)
          ? current
          : [project, ...current],
      );
      setActiveId(project.id);
      const job = await window.riggedAudio.startSeparation(project.id);
      setEvents((current) => ({
        ...current,
        [job.jobId]: {
          kind: "progress",
          data: {
            jobId: job.jobId,
            state: "queued",
            phase: "queue",
            progress: 0,
            message: "Queued for preview separation",
          },
        },
      }));
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const splitAgain = async (): Promise<void> => {
    if (!active) return;
    setError(null);
    try {
      const job = await window.riggedAudio.startSeparation(active.id);
      setEvents((current) => ({
        ...current,
        [job.jobId]: {
          kind: "progress",
          data: {
            jobId: job.jobId,
            state: "queued",
            phase: "queue",
            progress: 0,
            message: "Queued for preview separation",
          },
        },
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const setLane = (id: StemId, lane: MixLane): void => {
    if (!active) return;
    const next = {
      ...active,
      mix: { ...active.mix, lanes: { ...active.mix.lanes, [id]: lane } },
    };
    updateProject(next);
    mixer.current.applyMix(next.mix);
    void window.riggedAudio
      .updateMix(active.id, next.mix)
      .catch(() =>
        setError("Mix could not be saved; the live mix is still active."),
      );
  };

  const togglePlay = (): void => {
    if (!mixer.current.isLoaded()) return;
    if (playing) {
      mixer.current.pause(position);
      setPlaying(false);
    } else {
      mixer.current.play(position);
      setPlaying(true);
    }
  };

  const seek = (value: number): void => {
    mixer.current.seek(value);
    setPosition(value);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">R</span>
          <div>
            <strong>Rigged</strong>
            <small>audio workspace</small>
          </div>
        </div>
        <div className="sidebar-section">
          <p className="eyebrow">Library</p>
          <button className="nav-item active" type="button">
            <span>◈</span> Sessions <b>{projects.length}</b>
          </button>
        </div>
        <div className="project-list" aria-label="Project library">
          {projects.map((project) => (
            <button
              key={project.id}
              className={`project-item ${activeId === project.id ? "selected" : ""}`}
              type="button"
              onClick={() => setActiveId(project.id)}
            >
              <span
                className="project-art"
                style={{
                  background: `linear-gradient(135deg, ${STEM_META.vocals.color}, ${STEM_META.other.color})`,
                }}
              />
              <span>
                <strong>{project.title}</strong>
                <small>
                  {formatTime(project.source.durationSeconds)} ·{" "}
                  {project.source.codec}
                </small>
              </span>
            </button>
          ))}
          {!projects.length && (
            <p className="empty-sidebar">Your sessions will land here.</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <span className="offline-dot" />
          Local mode<span className="version">v0.1 preview</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Stem separation / session desk</p>
            <h1>{active ? active.title : "A quieter way to split sound."}</h1>
          </div>
          <div className="top-actions">
            <span className="hardware-badge">
              <span className="status-dot" />
              CPU preview engine
            </span>
            <button
              className="icon-button"
              type="button"
              aria-label="Open settings"
            >
              ⚙
            </button>
          </div>
        </header>
        {error && (
          <div className="alert" role="alert">
            <strong>Couldn’t complete that action.</strong>
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}
        {!active ? (
          <div className="welcome">
            <ImportPanel onImport={importPath} disabled={false} />
            <div className="welcome-notes">
              <div>
                <span>01</span>
                <strong>Inspect</strong>
                <p>See the source timeline before any work starts.</p>
              </div>
              <div>
                <span>02</span>
                <strong>Separate</strong>
                <p>A queued job keeps the UI free while it works.</p>
              </div>
              <div>
                <span>03</span>
                <strong>Shape</strong>
                <p>Audition each lane, then export an atomic set.</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="workspace">
            <section className="session-header">
              <div>
                <p className="eyebrow">Source signal</p>
                <div className="source-meta">
                  <span className="file-badge">WAV</span>
                  <span>{formatTime(active.source.durationSeconds)}</span>
                  <span>{active.source.sampleRate.toLocaleString()} Hz</span>
                  <span>{active.source.channels} ch</span>
                  <span>{formatBytes(active.source.bytes)}</span>
                </div>
              </div>
              <div className="session-actions">
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => void importPath(active.originalPath)}
                >
                  Re-import
                </button>
                <button
                  className="button ghost danger-text"
                  type="button"
                  onClick={() => {
                    void window.riggedAudio
                      .deleteProject(active.id)
                      .then(refresh);
                  }}
                >
                  Remove
                </button>
              </div>
            </section>
            <div className="control-deck">
              <div>
                <span className="eyebrow">Engine route</span>
                <h2>Rigged preview bands</h2>
                <p className="muted">
                  A deterministic four-lane preview for validating your
                  workflow. Real model adapters plug into this same seam.
                </p>
              </div>
              <div className="deck-right">
                <StatusPill state={status.state} />
                {status.state === "complete" ? (
                  <button
                    className="button primary"
                    type="button"
                    onClick={() =>
                      void window.riggedAudio.exportProject(active.id)
                    }
                  >
                    Export stems <span aria-hidden="true">↓</span>
                  </button>
                ) : status.state === "idle" ||
                  status.state === "failed" ||
                  status.state === "interrupted" ? (
                  <button
                    className="button primary"
                    type="button"
                    onClick={() => void splitAgain()}
                  >
                    Run separation <span aria-hidden="true">→</span>
                  </button>
                ) : (
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() => {
                      const jobId = [...active.jobIds].pop();
                      if (jobId) void window.riggedAudio.cancelJob(jobId);
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
            {status.state !== "idle" && status.state !== "complete" && (
              <div
                className="progress-track"
                aria-label={`Separation ${status.progress}%`}
              >
                <div style={{ width: `${status.progress}%` }} />
                <span>{status.message || "Working…"}</span>
                <b>{status.progress}%</b>
              </div>
            )}
            {status.state === "complete" && (
              <section className="player-card">
                <div className="transport-row">
                  <button
                    className="play-button"
                    type="button"
                    onClick={togglePlay}
                    disabled={loadingAudio}
                    aria-label={playing ? "Pause stems" : "Play stems"}
                  >
                    {playing ? "Ⅱ" : "▶"}
                  </button>
                  <button
                    className="skip-button"
                    type="button"
                    onClick={() => seek(position - 5)}
                    aria-label="Back five seconds"
                  >
                    −5
                  </button>
                  <button
                    className="skip-button"
                    type="button"
                    onClick={() => seek(position + 5)}
                    aria-label="Forward five seconds"
                  >
                    +5
                  </button>
                  <div className="time-readout">
                    <strong>{formatTime(position)}</strong>
                    <span>
                      /{" "}
                      {formatTime(
                        mixer.current.duration() ||
                          active.source.durationSeconds,
                      )}
                    </span>
                  </div>
                  <button
                    className="preset"
                    type="button"
                    onClick={() => {
                      const next = {
                        ...active.mix,
                        lanes: Object.fromEntries(
                          STEMS.map((id) => [
                            id,
                            {
                              ...laneFor(active, id),
                              muted: false,
                              solo: false,
                            },
                          ]),
                        ),
                      };
                      updateProject({ ...active, mix: next });
                      mixer.current.applyMix(next);
                      void window.riggedAudio.updateMix(active.id, next);
                    }}
                  >
                    All stems
                  </button>
                  <span className="loaded-label">
                    {loadingAudio ? "Loading audio…" : "Synced mix clock"}
                  </span>
                </div>
                <div className="transport-line">
                  <div
                    className="transport-progress"
                    style={{
                      width: `${(position / Math.max(1, mixer.current.duration() || active.source.durationSeconds)) * 100}%`,
                    }}
                  />
                  <input
                    type="range"
                    min="0"
                    max={
                      mixer.current.duration() || active.source.durationSeconds
                    }
                    step="0.01"
                    value={Math.min(
                      position,
                      mixer.current.duration() || active.source.durationSeconds,
                    )}
                    onChange={(event) => seek(Number(event.target.value))}
                    aria-label="Seek master timeline"
                  />
                </div>
              </section>
            )}
            <section className="lane-stack">
              <div className="lane-stack-header">
                <div>
                  <p className="eyebrow">Stem lanes</p>
                  <h2>
                    {status.state === "complete"
                      ? "Shape the balance."
                      : "Your lanes will appear here."}
                  </h2>
                </div>
                <span className="lane-count">{STEMS.length} targets</span>
              </div>
              {STEMS.map((id) => (
                <StemLane
                  key={id}
                  id={id}
                  project={active}
                  buffer={buffers[id]}
                  position={position}
                  onSeek={seek}
                  onChange={(lane) => setLane(id, lane)}
                  onMute={() =>
                    setLane(id, {
                      ...laneFor(active, id),
                      muted: !laneFor(active, id).muted,
                    })
                  }
                  onSolo={() =>
                    setLane(id, {
                      ...laneFor(active, id),
                      solo: !laneFor(active, id).solo,
                    })
                  }
                />
              ))}
            </section>
          </div>
        )}
        {!active && (
          <footer className="footer-note">
            Designed for local files first. Model downloads, GPU backends, and
            broader codecs stay behind verified capability checks.
          </footer>
        )}
      </main>
    </div>
  );
}
