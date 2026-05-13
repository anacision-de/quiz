# anacision Quiz

This repository stores the code for an interactive quiz, where people have to physically select an answer by standing in the right spot. This is done via camera pose tracking.

## GitHub Pages assets

All browser runtime assets are served locally from this repository so the quiz can run from GitHub Pages without external CDNs at runtime.

## Question catalogs

Question catalogs live in `catalogs/`. The available catalogs are declared in `catalogs/catalogs.json`.

Open the quiz with a catalog URL parameter, for example:

```text
index.html?catalog=ai-act
```

The certificate page receives the same catalog parameter automatically.

If the local assets need to be refreshed, run:

```bash
uv run python scripts/download_pose_model.py
```

The script downloads:

- `models/Xenova/RTMO-t` for local pose estimation
- local Transformers.js browser runtime files
- local Lato font files

The downloaded `models/`, `vendor/`, and `assets/fonts/` files are intentionally part of the published site and should be committed for GitHub Pages.
