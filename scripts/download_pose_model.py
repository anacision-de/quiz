#!/usr/bin/env python3
"""Download local offline assets for the webcam pose quiz.

Run from the project root:

    uv run python scripts/download_pose_model.py

The model files are intentionally kept out of Git via .gitignore.
"""

from __future__ import annotations

import argparse
import sys
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

FILES = [
    (
        "https://huggingface.co/Xenova/RTMO-t/resolve/main/config.json",
        ROOT / "models/Xenova/RTMO-t/config.json",
    ),
    (
        "https://huggingface.co/Xenova/RTMO-t/resolve/main/preprocessor_config.json",
        ROOT / "models/Xenova/RTMO-t/preprocessor_config.json",
    ),
    (
        "https://huggingface.co/Xenova/RTMO-t/resolve/main/onnx/model_quantized.onnx",
        ROOT / "models/Xenova/RTMO-t/onnx/model_quantized.onnx",
    ),
    (
        "https://huggingface.co/Xenova/RTMO-t/resolve/main/onnx/model.onnx",
        ROOT / "models/Xenova/RTMO-t/onnx/model.onnx",
    ),
    (
        "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js",
        ROOT / "vendor/transformers/transformers.min.js",
    ),
    (
        "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/ort-wasm-simd-threaded.jsep.mjs",
        ROOT / "vendor/transformers/ort-wasm-simd-threaded.jsep.mjs",
    ),
    (
        "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/ort-wasm-simd-threaded.jsep.wasm",
        ROOT / "vendor/transformers/ort-wasm-simd-threaded.jsep.wasm",
    ),
    (
        "https://fonts.gstatic.com/s/lato/v25/S6uyw4BMUTPHvxk.ttf",
        ROOT / "assets/fonts/Lato-Regular.ttf",
    ),
    (
        "https://fonts.gstatic.com/s/lato/v25/S6u9w4BMUTPHh6UVew8.ttf",
        ROOT / "assets/fonts/Lato-Bold.ttf",
    ),
    (
        "https://fonts.gstatic.com/s/lato/v25/S6u9w4BMUTPHh50Xew8.ttf",
        ROOT / "assets/fonts/Lato-Black.ttf",
    ),
]


def download(url: str, destination: Path, force: bool) -> None:
    if destination.exists() and not force:
        print(f"ok   {destination.relative_to(ROOT)}")
        return

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    print(f"get  {destination.relative_to(ROOT)}")
    with urllib.request.urlopen(url) as response:
        with temporary.open("wb") as handle:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
    temporary.replace(destination)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="download files again even if they exist")
    args = parser.parse_args()

    for url, destination in FILES:
        download(url, destination, args.force)

    print("Offline assets are ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
