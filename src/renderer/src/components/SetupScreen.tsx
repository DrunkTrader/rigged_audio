import { useEffect, useState } from "react";
import type { RuntimeStatus, SetupEvent } from "../../../shared/types";

const STEPS: { id: SetupEvent["step"]; label: string }[] = [
  { id: "tools", label: "Installer" },
  { id: "python", label: "Private Python" },
  { id: "packages", label: "PyTorch and Demucs" },
  { id: "model", label: "AI model" },
  { id: "verify", label: "Hardware check" },
];

const MIN_FREE_GB = 8;

function gigabytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function SetupScreen({
  status,
  onReady,
}: {
  status: RuntimeStatus;
  onReady: () => void;
}): React.ReactElement {
  const [event, setEvent] = useState<SetupEvent | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const installing = event !== null && failure === null;

  useEffect(
    () =>
      window.riggedAudio.onSetupEvent((next) => {
        if (next.step === "failed") {
          setFailure(
            next.message.startsWith("CANCELED")
              ? "Setup was canceled. You can start it again at any time."
              : next.message,
          );
        } else setEvent(next);
        if (next.step === "done") onReady();
      }),
    [onReady],
  );

  const start = (): void => {
    setFailure(null);
    setEvent({ step: "tools", message: "Starting" });
    window.riggedAudio.installRuntime().catch(() => undefined); // reported through onSetupEvent
  };

  const lowDisk = status.diskFreeBytes < MIN_FREE_GB * 1024 ** 3;
  const activeIndex = STEPS.findIndex((step) => step.id === event?.step);

  return (
    <main className="setup">
      <p className="eyebrow">First-time setup</p>
      <h1>Install the separation engine</h1>
      <p className="muted">
        This is the only step that needs the internet. After it, separation runs
        fully offline on this computer, with no account or API key.
      </p>

      <dl className="hardware">
        <div>
          <dt>Processor</dt>
          <dd>{status.cpu}</dd>
        </div>
        <div>
          <dt>Memory</dt>
          <dd>{gigabytes(status.memoryBytes)}</dd>
        </div>
        <div>
          <dt>Graphics</dt>
          <dd>
            {status.gpuHint ?? "No supported GPU found. CPU works, but slower."}
          </dd>
        </div>
        <div>
          <dt>Free disk</dt>
          <dd>{gigabytes(status.diskFreeBytes)}</dd>
        </div>
      </dl>

      {!status.supported ? (
        <p className="alert" role="alert">
          This operating system and processor combination is not supported.
        </p>
      ) : lowDisk ? (
        <p className="alert" role="alert">
          Setup needs {MIN_FREE_GB} GB of free disk. Free up some space, then
          reopen the app.
        </p>
      ) : installing ? (
        <>
          <ol className="steps">
            {STEPS.map((step, index) => (
              <li
                key={step.id}
                className={
                  index < activeIndex
                    ? "done"
                    : index === activeIndex
                      ? "active"
                      : ""
                }
              >
                {step.label}
              </li>
            ))}
          </ol>
          <p className="log" role="status">
            {event?.message}
          </p>
          <button
            className="button ghost"
            type="button"
            onClick={() => void window.riggedAudio.cancelInstall()}
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          {failure && (
            <p className="alert" role="alert">
              {failure}
            </p>
          )}
          <button className="button primary" type="button" onClick={start}>
            {failure ? "Try again" : "Install"}
          </button>
          <p className="drop-hint">
            Downloads about 1 GB, or about 3 GB with an NVIDIA GPU.
          </p>
        </>
      )}
    </main>
  );
}
