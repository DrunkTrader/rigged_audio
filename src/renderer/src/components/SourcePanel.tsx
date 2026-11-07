import { useEffect, useState } from "react";
import type { YouTubeProgress, YouTubeResult } from "../../../shared/types";
import { errorText, formatTime } from "../format";

const CONSENT_KEY = "rigged.youtube.consent";
const MAX_SECONDS = 20 * 60;

const tooLong = (result: YouTubeResult): boolean =>
  (result.durationSeconds ?? 0) > MAX_SECONDS;

function readConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === "yes";
  } catch {
    return false;
  }
}

function FileSource({
  onImport,
}: {
  onImport: (path: string) => void;
}): React.ReactElement {
  const [dragging, setDragging] = useState(false);
  return (
    <section
      className={`dropzone ${dragging ? "is-dragging" : ""}`}
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
      <h2>Drop a song here</h2>
      <p className="muted">
        MP3, WAV, FLAC, M4A, OGG and more, up to 20 minutes.
      </p>
      <button
        className="button primary"
        type="button"
        onClick={() =>
          void window.riggedAudio.pickAudio().then((path) => {
            if (path) onImport(path);
          })
        }
      >
        Choose a file
      </button>
      <p className="drop-hint">Your file stays on this computer.</p>
    </section>
  );
}

function YouTubeSource({
  onImported,
}: {
  onImported: (projectId: string) => void;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<YouTubeResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [download, setDownload] = useState<YouTubeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consented, setConsented] = useState(readConsent);
  const [updating, setUpdating] = useState(false);

  useEffect(() => window.riggedAudio.onYouTubeProgress(setDownload), []);

  const consent = (value: boolean): void => {
    setConsented(value);
    try {
      localStorage.setItem(CONSENT_KEY, value ? "yes" : "no");
    } catch {
      /* consent is simply asked for again next time */
    }
  };

  const fetchVideo = async (urlOrId: string): Promise<void> => {
    setError(null);
    setDownload({ progress: 0, message: "Connecting to YouTube" });
    try {
      const project = await window.riggedAudio.importYouTube(urlOrId);
      onImported(project.id);
    } catch (reason) {
      if (!String(reason).includes("CANCELED")) setError(errorText(reason));
    } finally {
      setDownload(null);
    }
  };

  const submit = async (): Promise<void> => {
    const text = query.trim();
    if (!text) return;
    if (/^https?:\/\//i.test(text)) {
      if (consented) await fetchVideo(text);
      else setError("Confirm the notice below to download this video.");
      return;
    }
    setError(null);
    setSearching(true);
    try {
      setResults(await window.riggedAudio.searchYouTube(text));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSearching(false);
    }
  };

  const update = async (): Promise<void> => {
    setUpdating(true);
    try {
      await window.riggedAudio.updateYouTubeSupport();
      setError(null);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <section className="youtube">
      <form
        className="search-row"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search YouTube or paste a link"
          aria-label="Search YouTube or paste a link"
        />
        <button
          className="button primary"
          type="submit"
          disabled={searching || !!download}
        >
          {searching ? "Searching" : "Go"}
        </button>
      </form>

      <label className="consent">
        <input
          type="checkbox"
          checked={consented}
          onChange={(event) => consent(event.target.checked)}
        />
        <span>
          I own this content or have permission to download it. YouTube's Terms
          of Service restrict downloading, and you are responsible for how you
          use this feature.
        </span>
      </label>

      {error && (
        <div className="alert" role="alert">
          <span>{error}</span>
          <button
            className="button ghost"
            type="button"
            disabled={updating}
            onClick={() => void update()}
          >
            {updating ? "Updating" : "Update YouTube support"}
          </button>
        </div>
      )}

      {download && (
        <div className="progress" role="status">
          <div style={{ width: `${download.progress}%` }} />
          <span>{download.message}</span>
          <button
            className="button ghost"
            type="button"
            onClick={() => void window.riggedAudio.cancelYouTube()}
          >
            Cancel
          </button>
        </div>
      )}

      {results?.length === 0 && <p className="muted">No videos found.</p>}
      <ul className="results">
        {results?.map((result) => (
          <li key={result.id}>
            <img src={result.thumbnail} alt="" loading="lazy" />
            <div>
              <strong>{result.title}</strong>
              <small>
                {result.channel}
                {result.durationSeconds !== null &&
                  ` · ${formatTime(result.durationSeconds)}`}
              </small>
            </div>
            <button
              className="button ghost"
              type="button"
              disabled={!consented || !!download || tooLong(result)}
              title={tooLong(result) ? "Longer than 20 minutes" : undefined}
              onClick={() => void fetchVideo(result.id)}
            >
              {tooLong(result) ? "Too long" : "Use"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SourcePanel({
  onImport,
  onImported,
}: {
  onImport: (path: string) => void;
  onImported: (projectId: string) => void;
}): React.ReactElement {
  const [tab, setTab] = useState<"file" | "youtube">("file");
  return (
    <div className="source-panel">
      <h1>Split a song into stems</h1>
      <div className="tabs" role="tablist">
        {(["file", "youtube"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {id === "file" ? "Local file" : "YouTube"}
          </button>
        ))}
      </div>
      <div hidden={tab !== "file"}>
        <FileSource onImport={onImport} />
      </div>
      {/* Stays mounted, so a running download keeps its progress and Cancel. */}
      <div hidden={tab !== "youtube"}>
        <YouTubeSource onImported={onImported} />
      </div>
    </div>
  );
}
