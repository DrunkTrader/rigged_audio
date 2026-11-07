import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StemMixer, syncVideo } from "./audio/mixer";
import {
  embedUrl,
  thumbnailUrl,
  YouTubeVideo,
  youTubeId,
} from "./audio/youtube";
import {
  ExportPanel,
  type ExportNotice,
  type ExportSettings,
} from "./components/ExportPanel";
import { Icon, Logo } from "./components/Icon";
import { SetupScreen } from "./components/SetupScreen";
import { SourcePanel } from "./components/SourcePanel";
import { Waveform } from "./components/Waveform";
import {
  errorText,
  formatTime,
  mediaUrl,
  STEM_META,
  useTheme,
  type Theme,
} from "./format";
import {
  activePreset,
  applyPreset,
  laneGain,
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
// YouTube reports its time a few times a second, so it cannot be held as tightly as audio.
const YOUTUBE_TOLERANCE_SECONDS = 0.3;
const REST_COLOR: Record<Theme, string> = {
  dark: "rgba(255, 255, 255, 0.16)",
  light: "rgba(28, 22, 14, 0.16)",
};

type CssVars = React.CSSProperties & Record<`--${string}`, string>;

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

function percentOf(value: number, total: number): string {
  return `${total ? Math.min(100, (value / total) * 100) : 0}%`;
}

function latestJob(
  project: ProjectRecord,
  jobs: JobRecord[],
): JobRecord | undefined {
  const id = project.jobIds[project.jobIds.length - 1];
  return jobs.find((item) => item.id === id);
}

function SongThumb({
  project,
  large = false,
}: {
  project: ProjectRecord;
  large?: boolean;
}): React.ReactElement {
  const id = youTubeId(project.sourceUrl);
  return (
    <span className={`thumb ${large ? "large" : ""}`} aria-hidden="true">
      {id ? (
        <img src={thumbnailUrl(id)} alt="" loading="lazy" />
      ) : (
        <Icon name="note" size={large ? 30 : 18} />
      )}
    </span>
  );
}

/** The YouTube player. Once stems exist it is muted and follows the mix clock. */
function Stage({
  videoId,
  slaved,
  player,
  onToggle,
}: {
  videoId: string;
  slaved: boolean;
  player: React.MutableRefObject<YouTubeVideo | null>;
  onToggle: () => void;
}): React.ReactElement {
  const frame = useRef<HTMLIFrameElement>(null);
  const [controller] = useState(
    () => new YouTubeVideo(() => frame.current?.contentWindow),
  );
  useEffect(() => {
    if (!slaved) return;
    const onMessage = (event: MessageEvent): void => controller.receive(event);
    window.addEventListener("message", onMessage);
    player.current = controller;
    return () => {
      window.removeEventListener("message", onMessage);
      player.current = null;
    };
  }, [slaved, controller, player]);
  return (
    <div className="stage glass">
      <iframe
        ref={frame}
        src={embedUrl(videoId, slaved)}
        title="YouTube video player"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => slaved && controller.listen()}
      />
      {/* The slaved player must not be paused on its own; a click drives the mix instead. */}
      {slaved && (
        <button
          className="stage-shield"
          type="button"
          aria-label="Play or pause"
          onClick={onToggle}
        />
      )}
    </div>
  );
}

function StemLane({
  id,
  lane,
  mix,
  theme,
  buffer,
  position,
  duration,
  auditioning,
  exporting,
  onSeek,
  onChange,
  onAudition,
  onExport,
}: {
  id: StemId;
  lane: MixLane;
  mix: Mix;
  theme: Theme;
  buffer?: AudioBuffer;
  position: number;
  duration: number;
  auditioning: boolean;
  exporting: boolean;
  onSeek: (seconds: number) => void;
  onChange: (lane: MixLane) => void;
  onAudition: () => void;
  onExport: () => void;
}): React.ReactElement {
  const meta = STEM_META[id];
  const color = meta.color[theme];
  const silent = laneGain(mix, id) === 0;
  return (
    <article
      className={`lane glass ${silent ? "silent" : ""}`}
      style={{ "--stem": color } as CssVars}
    >
      <div className="lane-id">
        <span className="stem-icon">
          <Icon name={id} />
        </span>
        <strong>{meta.label}</strong>
      </div>
      <div className="lane-toggles">
        <button
          type="button"
          className={`toggle ${lane.muted ? "on mute" : ""}`}
          aria-label={`Mute ${meta.label}`}
          aria-pressed={lane.muted}
          onClick={() => onChange({ ...lane, muted: !lane.muted })}
        >
          M
        </button>
        <button
          type="button"
          className={`toggle ${lane.solo ? "on solo" : ""}`}
          aria-label={`Solo ${meta.label}`}
          aria-pressed={lane.solo}
          onClick={() => onChange({ ...lane, solo: !lane.solo })}
        >
          S
        </button>
        <button
          type="button"
          className={`toggle ${auditioning ? "on" : ""}`}
          aria-label={`${auditioning ? "Pause" : "Play"} ${meta.label} only`}
          aria-pressed={auditioning}
          onClick={onAudition}
        >
          <Icon name={auditioning ? "pause" : "play"} size={12} />
        </button>
      </div>
      <Waveform
        label={meta.label}
        buffer={buffer}
        color={color}
        restColor={REST_COLOR[theme]}
        position={position}
        duration={duration}
        onSeek={onSeek}
      />
      <input
        className="slider"
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={lane.volume}
        style={{ "--fill": percentOf(lane.volume, 1) } as CssVars}
        aria-label={`${meta.label} volume`}
        onChange={(event) =>
          onChange({ ...lane, volume: Number(event.target.value) })
        }
      />
      <button
        className="icon-button"
        type="button"
        disabled={exporting}
        aria-label={`Export ${meta.label} as WAV`}
        title={`Export ${meta.label}`}
        onClick={onExport}
      >
        <Icon name="download" />
      </button>
    </article>
  );
}

function SeparatePanel({
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
    <div className="separate">
      {!project.sourceUrl && (
        <audio src={mediaUrl(project.id, "source")} controls />
      )}
      {failed && (
        <p className="alert" role="alert">
          {failed.error?.message ?? "Separation did not finish."}
        </p>
      )}
      {running ? (
        <div className="job" role="status">
          <div className="job-text">
            <span>{job.message ?? "Starting"}</span>
            <b className="mono">{job.progress}%</b>
          </div>
          <div className="meter">
            <div style={{ width: `${job.progress}%` }} />
          </div>
          <button
            className="button ghost"
            type="button"
            onClick={() => void window.riggedAudio.cancelJob(job.id)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          className="button primary large"
          type="button"
          onClick={onStart}
        >
          {failed ? "Try again" : "Separate into 6 stems"}
        </button>
      )}
    </div>
  );
}

export function App(): React.ReactElement {
  const [theme, toggleTheme] = useTheme();
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
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    bitDepth: 24,
    sampleRate: "source",
  });
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<ExportNotice>(null);
  const mixer = useRef(new StemMixer());
  const player = useRef<YouTubeVideo | null>(null);
  const liveMix = useRef<Mix | null>(null);
  const saveTimer = useRef<number>();
  const pendingSave = useRef<(() => Promise<unknown>) | null>(null);

  const active = projects.find((project) => project.id === activeId) ?? null;
  const separated = active ? isSeparated(active) : false;
  const duration = active?.source.durationSeconds ?? 0;
  const videoId = youTubeId(active?.sourceUrl);
  const job = useMemo(
    () => (active ? latestJob(active, jobs) : undefined),
    [active, jobs],
  );

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
      if (player.current)
        syncVideo(
          player.current,
          now,
          mixer.current.isPlaying(),
          YOUTUBE_TOLERANCE_SECONDS,
        );
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
    setNotice(null);
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

  const runExport = async (stems: StemId[], mix: boolean): Promise<void> => {
    if (!active) return;
    setExporting(true);
    setNotice(null);
    try {
      await flushSave();
      const saved = await window.riggedAudio.exportProject(active.id, {
        stems,
        mix,
        ...exportSettings,
      });
      if (saved.saved)
        setNotice({
          ok: true,
          text: `Saved to ${saved.path ?? "your folder"}`,
        });
    } catch (reason) {
      setNotice({ ok: false, text: errorText(reason) });
    } finally {
      setExporting(false);
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
  const engine = (runtime.device ?? "cpu").toUpperCase();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Logo />
          <strong>Rigged Audio</strong>
        </div>
        <div className="library-head">
          <span>Library</span>
          <button
            className="icon-button"
            type="button"
            aria-label="Add a song"
            title="Add a song"
            onClick={() => setActiveId(null)}
          >
            <Icon name="plus" />
          </button>
        </div>
        <nav className="library" aria-label="Library">
          {projects.map((project) => {
            const projectJob = latestJob(project, jobs);
            const running = projectJob && ACTIVE.includes(projectJob.state);
            return (
              <button
                key={project.id}
                type="button"
                className={`song ${activeId === project.id ? "selected" : ""}`}
                aria-current={activeId === project.id ? "true" : undefined}
                onClick={() => setActiveId(project.id)}
              >
                <SongThumb project={project} />
                <span className="song-text">
                  <strong>{project.title}</strong>
                  <small className="mono">
                    {formatTime(project.source.durationSeconds)}
                    {running
                      ? ` · separating ${projectJob.progress}%`
                      : isSeparated(project)
                        ? " · 6 stems"
                        : ""}
                  </small>
                </span>
              </button>
            );
          })}
          {!projects.length && (
            <p className="empty">Songs you add appear here.</p>
          )}
        </nav>
        <footer className="sidebar-foot">
          <span className="engine" title={runtime.deviceName ?? undefined}>
            <i aria-hidden="true" />
            Engine ready · {engine}
          </span>
          <button
            className="icon-button"
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title={`${theme === "dark" ? "Light" : "Dark"} theme`}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </button>
        </footer>
      </aside>

      <main className="main">
        {error && (
          <div className="alert floating" role="alert">
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
          {importing && (
            <p className="muted center" role="status">
              Importing
            </p>
          )}
        </div>

        {active && (
          <div className="workspace">
            <header className="topbar">
              <h1 title={active.title}>{active.title}</h1>
              <button
                className="icon-button danger"
                type="button"
                aria-label="Remove this song"
                title="Remove this song"
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
                <Icon name="trash" />
              </button>
            </header>

            <section className={`hero ${videoId ? "with-video" : ""}`}>
              {videoId && (
                <Stage
                  key={`${active.id}-${separated}`}
                  videoId={videoId}
                  slaved={separated}
                  player={player}
                  onToggle={togglePlay}
                />
              )}
              <div className="info glass">
                <div className="info-head">
                  <SongThumb project={active} large />
                  <div>
                    <h2 title={active.title}>{active.title}</h2>
                    <p className="meta mono">
                      {formatTime(duration)} ·{" "}
                      {(active.source.sampleRate / 1000).toLocaleString()} kHz{" "}
                      {active.source.channels === 1 ? "mono" : "stereo"} · added{" "}
                      {new Date(active.createdAt).toLocaleDateString(
                        undefined,
                        {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        },
                      )}
                    </p>
                  </div>
                </div>
                <ul className="legend" aria-label="Stems">
                  {STEMS.map((id) => (
                    <li
                      key={id}
                      style={
                        { "--stem": STEM_META[id].color[theme] } as CssVars
                      }
                    >
                      {STEM_META[id].label}
                    </li>
                  ))}
                </ul>
                {separated ? (
                  <ExportPanel
                    project={active}
                    settings={exportSettings}
                    busy={exporting}
                    notice={notice}
                    onSettings={setExportSettings}
                    onExport={(stems, mix) => void runExport(stems, mix)}
                  />
                ) : (
                  <SeparatePanel
                    project={active}
                    job={job}
                    onStart={() => void separate()}
                  />
                )}
                {videoId && (
                  <a
                    className="link"
                    href={`https://www.youtube.com/watch?v=${videoId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open on YouTube <Icon name="external" size={14} />
                  </a>
                )}
              </div>
            </section>

            {separated && (
              <>
                <section className="transport glass" aria-label="Transport">
                  <div className="scrub">
                    <span className="mono">{formatTime(position)}</span>
                    <input
                      className="slider timeline"
                      type="range"
                      min="0"
                      max={duration}
                      step="0.01"
                      value={position}
                      style={
                        { "--fill": percentOf(position, duration) } as CssVars
                      }
                      aria-label="Song position"
                      onChange={(event) => seek(Number(event.target.value))}
                    />
                    <span className="mono">{formatTime(duration)}</span>
                  </div>
                  <div className="transport-row">
                    <button
                      className="play"
                      type="button"
                      disabled={loading}
                      aria-label={playing ? "Pause" : "Play"}
                      onClick={togglePlay}
                    >
                      <Icon name={playing ? "pause" : "play"} size={22} />
                    </button>
                    <div
                      className="segmented"
                      role="group"
                      aria-label="Presets"
                    >
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
                      <Icon name="volume" />
                      <input
                        className="slider"
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={active.mix.master}
                        style={
                          {
                            "--fill": percentOf(active.mix.master, 1),
                          } as CssVars
                        }
                        aria-label="Master volume"
                        onChange={(event) =>
                          setMix({
                            ...active.mix,
                            master: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                </section>

                <section
                  className="lanes"
                  aria-label="Stems"
                  aria-busy={loading}
                >
                  {STEMS.map((id) => (
                    <StemLane
                      key={id}
                      id={id}
                      lane={laneFor(active, id)}
                      mix={active.mix}
                      theme={theme}
                      buffer={buffers[id]}
                      position={position}
                      duration={duration}
                      auditioning={audition === id}
                      exporting={exporting}
                      onSeek={seek}
                      onChange={(lane) => setLane(id, lane)}
                      onAudition={() => toggleAudition(id)}
                      onExport={() => void runExport([id], false)}
                    />
                  ))}
                </section>
                <p className="shortcuts">
                  {loading ? "Loading stems · " : ""}
                  <kbd>Space</kbd> play · <kbd>←</kbd> <kbd>→</kbd> 5 seconds ·{" "}
                  <kbd>1</kbd>–<kbd>6</kbd> mute a stem
                </p>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
