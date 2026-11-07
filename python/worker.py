"""Separation worker. One process per job, so cancel is a kill and inference never touches the UI.

Prints one JSON object per line on stdout; audio travels by file path only.
Uses demucs.pretrained/apply directly because demucs.api imports sphn, which has
no wheels for Intel macOS or Linux arm64. Audio I/O goes through ffmpeg instead.
"""

import argparse
import json
import os
import subprocess
import sys
import threading

MODEL = "htdemucs_6s"


def emit(**message):
    print(json.dumps(message), flush=True)


def pick_device():
    import torch

    if torch.cuda.is_available():  # also true for ROCm builds
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def ffmpeg_path():
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def probe():
    import torch

    device = pick_device()
    name = torch.cuda.get_device_name(0) if device == "cuda" else None
    emit(
        kind="probe",
        device=device,
        deviceName=name,
        torch=torch.__version__,
        ffmpeg=ffmpeg_path(),
    )


def prefetch():
    from demucs.pretrained import get_model

    model = get_model(MODEL)
    emit(kind="prefetched", sources=list(model.sources))


def decode(path, rate):
    import numpy as np

    command = [ffmpeg_path(), "-v", "error", "-i", path, "-f", "f32le"]
    command += ["-ac", "2", "-ar", str(rate), "-"]
    result = subprocess.run(command, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode(errors="replace")[-400:])
    return np.frombuffer(result.stdout, dtype=np.float32).reshape(-1, 2).T.copy()


def encode(samples, path, model_rate, rate, channels, frames):
    """Write one stem back at the source rate, channels and exact frame count."""
    command = [ffmpeg_path(), "-v", "error", "-y", "-f", "f32le", "-ac", "2"]
    command += ["-ar", str(model_rate), "-i", "-", "-ac", str(channels)]
    # Resample inside the chain: a separate -ar runs after -af, so the trim would count input rate.
    command += ["-af", f"aresample={rate},apad,atrim=end_sample={frames}"]
    command += ["-c:a", "pcm_f32le", path]
    result = subprocess.run(
        command, input=samples.T.tobytes(), capture_output=True
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode(errors="replace")[-400:])


def run_model(model, mix, device, on_progress):
    from demucs.apply import apply_model

    def callback(update):
        if update["state"] == "end":
            on_progress(update["segment_offset"] / max(1, mix.shape[-1]))

    return apply_model(
        model,
        mix[None],
        device=device,
        split=True,
        overlap=0.25,
        shifts=0,
        progress=False,
        num_workers=0,
        callback=callback,
    )[0]


def exit_with_parent():
    """The app holds stdin open, so EOF means it died, even if it was force-killed."""

    def wait():
        sys.stdin.read()
        os._exit(1)

    threading.Thread(target=wait, daemon=True).start()


def separate(args):
    exit_with_parent()
    import torch
    from demucs.pretrained import get_model

    emit(kind="progress", progress=2, message="Loading the AI model")
    model = get_model(MODEL)
    model.eval()

    emit(kind="progress", progress=5, message="Reading the audio")
    mix = torch.from_numpy(decode(args.input, model.samplerate))
    # Demucs is trained on normalised input; the same scale is undone below.
    reference = mix.mean(0)
    mean, std = reference.mean(), reference.std().clamp_min(1e-8)
    mix = (mix - mean) / std

    device = args.device if args.device != "auto" else pick_device()
    last = [-1]

    def on_progress(done):
        percent = 8 + int(min(1.0, done) * 80)
        if percent != last[0]:
            last[0] = percent
            emit(kind="progress", progress=percent, message="Separating stems")

    emit(kind="progress", progress=8, message=f"Separating on {device.upper()}")
    with torch.no_grad():
        try:
            sources = run_model(model, mix, device, on_progress)
        except RuntimeError as error:
            if device == "cpu":
                raise
            # GPU out of memory or an unsupported op: slower, but the job still finishes.
            emit(kind="warning", message=f"{device} failed, using CPU: {error}"[:300])
            device = "cpu"
            sources = run_model(model, mix, device, on_progress)

    sources = sources * std + mean
    if not torch.isfinite(sources).all():
        raise RuntimeError("the model produced invalid samples")

    stems = []
    for index, name in enumerate(model.sources):
        emit(
            kind="progress",
            progress=90 + index,
            message=f"Writing {name}",
        )
        path = os.path.join(args.output, f"{name}.wav")
        temporary = f"{path}.tmp.wav"
        encode(
            sources[index].cpu().numpy(),
            temporary,
            model.samplerate,
            args.rate,
            args.channels,
            args.frames,
        )
        os.replace(temporary, path)
        stems.append(name)
    emit(kind="done", stems=stems, device=device)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["probe", "prefetch", "separate"])
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--rate", type=int)
    parser.add_argument("--channels", type=int)
    parser.add_argument("--frames", type=int)
    args = parser.parse_args()
    try:
        {"probe": probe, "prefetch": prefetch}.get(
            args.command, lambda: separate(args)
        )()
    except Exception as error:  # reported to the job record, never swallowed
        emit(kind="error", message=str(error)[:500])
        sys.exit(1)


if __name__ == "__main__":
    main()
