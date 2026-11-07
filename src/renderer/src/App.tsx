import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StemMixer, syncVideo } from "./audio/mixer";
import { ExportPanel } from "./components/ExportPanel";
import { SetupScreen } from "./components/SetupScreen";
import { SourcePanel } from "./components/SourcePanel";
import { Waveform } from "./components/Waveform";
import { errorText, formatTime, mediaUrl, STEM_META } from "./format";
import {
  activePreset,
  applyPreset,
  PRESETS,
  type Mix,
  type PresetId,
} from "../../shared/mix";
import {
  STEMS,
  type JobRecord,
  type MixLane,
  type ProjectRecord,
  type RuntimeStatus,
  type StemId,
} from "../../shared/types";

const ACTIVE = ["queued", "preparing", "separating", "validating"];
const SAVE_DELAY_MS = 300;

function laneFor(project: ProjectRecord, id: StemId): MixLane {
  return project.mix.lanes[id] ?? { volume: 1, muted: false, solo: false };
}

function isSeparated(project: ProjectRecord): boolean {
  return STEMS.every((id) => project.stems[id]?.valid);
}

function soloMix(mix: Mix, id: StemId): Mix {
  return {
    ...mix,
    lanes: Object.fromEntries(
      STEMS.map((stem) => [
        stem,
        {
          volume: mix.lanes[stem]?.volume ?? 1,
          muted: stem !== id,
          solo: false,
        },
      ]),
    ),
  };
}

function StemLane({
  id,
  index,
  lane,
  buffer,
  position,
  duration,
  auditioning,
  onSeek,
  onChange,
  onAudition,
}: {
  id: StemId;
  index: number;
  lane: MixLane;
  buffer?: AudioBuffer;
  position: number;
  duration: number;
  auditioning: boolean;
  onSeek: (seconds: number) => void;
  onChange: (lane: MixLane) => void;
  onAudition: () => void;
}): React.ReactElement {
  const meta = STEM_META[id];
  return (
    <article className={`lane ${lane.muted ? "muted" : ""}`}>
      <div className="lane-head">
        <span style={{ background: meta.color }} aria-hidden="true" />
        <strong>{meta.label}</strong>
        <kbd title={`Press ${index + 1} to mute`}>{index + 1}</kbd>
      </div>
      <Waveform
        label={meta.label}
        buffer={buffer}
        color={meta.color}
        position={position}
        duration={duration}
        onSeek={onSeek}
      />
      <div className="lane-controls">
        <button
          type="button"
          className={auditioning ? "active" : ""}
          aria-label={`${auditioning ? "Pause" : "Play"} ${meta.label} only`}
          aria-pressed={auditioning}
          onClick={onAudition}
        >
          {auditioning ? "❚❚" : "▶"}
        </button>
        <button
          type="button"
          className={lane.muted ? "active" : ""}
          aria-label={`Mute ${meta.label}`}
          aria-pressed={lane.muted}
          onClick={() => onChange({ ...lane, muted: !lane.muted })}
        >
          M
        </button>
        <button
          type="button"
          className={lane.solo ? "active solo" : ""}
          aria-label={`Solo ${meta.label}`}
          aria-pressed={lane.solo}
          onClick={() => onChange({ ...lane, solo: !lane.solo })}
        >
          S
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={lane.volume}
          aria-label={`${meta.label} volume`}
          onChange={(event) =>
            onChange({ ...lane, volume: Number(event.target.value) })
          }
        />
      </div>
    </article>
  );
}

function Separate({
  project,
  job,
  onStart,
}: {
  project: ProjectRecord;
  job?: JobRecord;
  onStart: () => void;
}): React.ReactElement {
  const running = job && ACTIVE.includes(job.state);
  const failed =
    job && ["failed", "interrupted"].includes(job.state) ? job : null;
  return (
    <section className="separate">
      {project.videoPath ? (
        <video src={mediaUrl(project.id, "video")} controls />
      ) : (
        <audio src={mediaUrl(project.id, "source")} controls />
      )}
      {failed && (
        <p className="alert" role="alert">
          {failed.error?.message ?? "Separation did not finish."}
        </p>
      )}
      {running ? (
        <div className="progress" role="status">
          <div style={{ width: `${job.progress}%` }} />
          <span>{job.message ?? "Starting"}</span>
          <b>{job.progress}%</b>
          <button
            className="button ghost"
            type="button"
            onClick={() => void window.riggedAudio.cancelJob(job.id)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button className="button primary" type="button" onClick={onStart}>
          {failed ? "Try again" : "Separate stems"}
        </button>
      )}
    </section>
  );
}

export function App(): React.ReactElement {
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [buffers, setBuffers] = useState<Partial<Record<StemId, AudioBuffer>>>(
    {},
  );
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [audition, setAudition] = useState<StemId | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mixer = useRef(new StemMixer());
  const video = useRef<HTMLVideoElement>(null);
  const liveMix = useRef<Mix | null>(null);
  const saveTimer = useRef<number>();
  const pendingSave = useRef<(() => Promise<unknown>) | null>(null);

  const active = projects.find((project) => project.id === activeId) ?? null;
  const separated = active ? isSeparated(active) : false;
  const duration = active?.source.durationSeconds ?? 0;
  const job = useMemo(() => {
    const id = active?.jobIds[active.jobIds.length - 1];
    return jobs.find((item) => item.id === id);
  }, [active, jobs]);

  const refresh = useCallback(async () => {
    const [nextProjects, nextJobs] = await Promise.all([
      window.riggedAudio.listProjects(),
      window.riggedAudio.listJobs(),
    ]);
    setProjects(nextProjects);
    setJobs(nextJobs);
  }, []);

  const checkRuntime = useCallback(async () => {
    setRuntime(await window.riggedAudio.runtimeStatus());
  }, []);

  useEffect(() => {
    void checkRuntime();
    void refresh().catch((reason) => setError(errorText(reason)));
    return window.riggedAudio.onJobEvent((event) => {
      if (event.kind === "progress") {
        const { jobId, ...patch } = event.data;
        setJobs((current) =>
          current.map((item) =>
            item.id === jobId ? { ...item, ...patch } : item,
          ),
        );
      } else void refresh();
    });
  }, [checkRuntime, refresh]);

  // Audio is the master clock; the video and playhead only read from it.
  useEffect(() => {
    let frame = 0;
    let shown = 0;
    const tick = (): void => {
      if (mixer.current.stopIfEnded()) {
        setPlaying(false);
        setAudition(null);
      }
      const now = mixer.current.position();
      // The UI only needs about 20 updates a second; video sync below runs every frame.
      if (Math.abs(now - shown) >= 0.05 || !mixer.current.isPlaying()) {
        shown = now;
        setPosition(now);
      }
      if (video.current)
        syncVideo(video.current, now, mixer.current.isPlaying());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    setBuffers({});
    setPlaying(false);
    setAudition(null);
    setPosition(0);
    if (!active || !separated) {
      mixer.current.dispose();
      return;
    }
    let stale = false;
    setLoading(true);
    const urls = Object.fromEntries(
      STEMS.map((id) => [id, mediaUrl(active.id, id)]),
    );
    mixer.current
      .load(urls)
      .then((decoded) => {
        if (stale) return;
        // Not active.mix: the user may have changed lanes while stems decoded.
        if (liveMix.current) mixer.current.applyMix(liveMix.current);
        setBuffers(decoded);
      })
      .catch((reason) => {
        if (!stale) setError(errorText(reason));
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
    // Reload only when the project or its stems change, not on every mix edit.
  }, [active?.id, separated]);

  useEffect(() => {
    if (!active) return;
    liveMix.current = audition ? soloMix(active.mix, audition) : active.mix;
    mixer.current.applyMix(liveMix.current);
  }, [active?.mix, audition]);

  const flushSave = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    const save = pendingSave.current;
    pendingSave.current = null;
    await save?.();
  }, []);

  const setMix = (mix: Mix): void => {
    if (!active) return;
    const { id } = active;
    setProjects((current) =>
      current.map((item) => (item.id === id ? { ...item, mix } : item)),
    );
    pendingSave.current = () => window.riggedAudio.updateMix(id, mix);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      flushSave().catch(() =>
        setError("Your mix could not be saved, but it is still playing."),
      );
    }, SAVE_DELAY_MS);
  };

  const setLane = (id: StemId, lane: MixLane): void => {
    if (active)
      setMix({ ...active.mix, lanes: { ...active.mix.lanes, [id]: lane } });
  };

  const importPath = async (path: string): Promise<void> => {
    setError(null);
    setImporting(true);
    try {
      const project = await window.riggedAudio.importAudio(path);
      await refresh();
      setActiveId(project.id);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setImporting(false);
    }
  };

  const separate = async (): Promise<void> => {
    if (!active) return;
    setError(null);
    try {
      await window.riggedAudio.startSeparation(active.id);
      await refresh();
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  const togglePlay = useCallback((): void => {
    setAudition(null);
    if (mixer.current.isPlaying()) {
      mixer.current.pause();
      setPlaying(false);
    } else if (mixer.current.isLoaded()) {
      mixer.current.play();
      setPlaying(true);
    }
  }, []);

  const toggleAudition = (id: StemId): void => {
    if (audition === id) {
      mixer.current.pause();
      setPlaying(false);
      setAudition(null);
      return;
    }
    setAudition(id);
    if (!mixer.current.isPlaying()) {
      mixer.current.play();
      setPlaying(true);
    }
  };

  const seek = useCallback((seconds: number): void => {
    mixer.current.seek(seconds);
    setPosition(mixer.current.position());
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (!active || !separated) return;
      if (event.key === " " && target.tagName !== "BUTTON") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowLeft") seek(mixer.current.position() - 5);
      else if (event.key === "ArrowRight") seek(mixer.current.position() + 5);
      else if (/^[1-6]$/.test(event.key)) {
        const id = STEMS[Number(event.key) - 1];
        const lane = laneFor(active, id);
        setLane(id, { ...lane, muted: !lane.muted });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!runtime) return <div className="app-shell loading" />;
  if (!runtime.ready)
    return <SetupScreen status={runtime} onReady={() => void checkRuntime()} />;

  const preset = active ? activePreset(active.mix) : null;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          <strong>Rigged Audio</strong>
        </div>
        <button
          className="button primary new-song"
          type="button"
          onClick={() => setActiveId(null)}
        >
          New song
        </button>
        <nav className="library" aria-label="Library">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className={activeId === project.id ? "selected" : ""}
              aria-current={activeId === project.id ? "true" : undefined}
              onClick={() => setActiveId(project.id)}
            >
              <strong>{project.title}</strong>
              <small>
                {formatTime(project.source.durationSeconds)}
                {isSeparated(project) ? " · stems ready" : ""}
              </small>
            </button>
          ))}
          {!projects.length && <p className="muted">No songs yet.</p>}
        </nav>
        <p className="device" title={runtime.deviceName ?? undefined}>
          {`Running on ${(runtime.device ?? "cpu").toUpperCase()}`}
        </p>
      </aside>

      <main className="main">
        {error && (
          <div className="alert" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="button ghost"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Stays mounted, so a YouTube download survives opening another song. */}
        <div hidden={!!active}>
          <SourcePanel
            onImport={(path) => void importPath(path)}
            onImported={(id) =>
              void refresh().then(() => setActiveId((current) => current ?? id))
            }
          />
        </div>
        {active && (
          <>
            <header className="song-header">
              <div>
                <h1>{active.title}</h1>
                <p className="muted">
                  {formatTime(duration)} ·{" "}
                  {active.source.sampleRate.toLocaleString()} Hz ·{" "}
                  {active.source.channels === 1 ? "mono" : "stereo"}
                </p>
              </div>
              <button
                className="button ghost danger"
                type="button"
                onClick={() => {
                  window.riggedAudio
                    .deleteProject(active.id)
                    .then(() => {
                      setActiveId(null);
                      return refresh();
                    })
                    .catch((reason) => setError(errorText(reason)));
                }}
              >
                Remove
              </button>
            </header>

            {!separated ? (
              <Separate
                project={active}
                job={job}
                onStart={() => void separate()}
              />
            ) : (
              <>
                {active.videoPath && (
                  <video
                    ref={video}
                    className="stage"
                    src={mediaUrl(active.id, "video")}
                    muted
                    aria-label="Video, synced to the mix"
                  />
                )}
                <section className="transport" aria-label="Transport">
                  <button
                    className="play"
                    type="button"
                    disabled={loading}
                    aria-label={playing ? "Pause" : "Play"}
                    onClick={togglePlay}
                  >
                    {playing ? "❚❚" : "▶"}
                  </button>
                  <div className="time">
                    <strong>{formatTime(position)}</strong>
                    <span> / {formatTime(duration)}</span>
                  </div>
                  <div className="presets" role="group" aria-label="Presets">
                    {(Object.keys(PRESETS) as PresetId[]).map((id) => (
                      <button
                        key={id}
                        type="button"
                        className={preset === id ? "active" : ""}
                        aria-pressed={preset === id}
                        onClick={() => setMix(applyPreset(active.mix, id))}
                      >
                        {PRESETS[id].label}
                      </button>
                    ))}
                  </div>
                  <label className="master">
                    Master
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={active.mix.master}
                      onChange={(event) =>
                        setMix({
                          ...active.mix,
                          master: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </section>
                {loading && (
                  <p className="muted" role="status">
                    Loading stems
                  </p>
                )}
                <section className="lanes" aria-label="Stems">
                  {STEMS.map((id, index) => (
                    <StemLane
                      key={id}
                      id={id}
                      index={index}
                      lane={laneFor(active, id)}
                      buffer={buffers[id]}
                      position={position}
                      duration={duration}
                      auditioning={audition === id}
                      onSeek={seek}
                      onChange={(lane) => setLane(id, lane)}
                      onAudition={() => toggleAudition(id)}
                    />
                  ))}
                </section>
                <p className="shortcuts">
                  Space plays and pauses. Left and right skip 5 seconds. 1 to 6
                  mute a stem.
                </p>
                <ExportPanel
                  key={active.id}
                  project={active}
                  beforeExport={flushSave}
                />
              </>
            )}
          </>
        )}
        {importing && (
          <p className="muted" role="status">
            Importing
          </p>
        )}
      </main>
    </div>
  );
}
