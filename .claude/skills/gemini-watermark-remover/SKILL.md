---
name: gemini-watermark-remover
description: Remove the visible Gemini watermark from a local Gemini-generated image before it is staged as game art. Use after downloading a generated image and before any downscale, palette mapping or manifest step.
---

# Gemini watermark remover

Gemini bakes a faint logo into the bottom-right corner of its generated images. It
survives downscaling as a tinted patch, so it has to go before the art pipeline reads
the file.

This skill is a vendored, MIT-licensed upstream tool
(<https://github.com/GargantuaX/gemini-watermark-remover>) that undoes the watermark by
reverse alpha blending. It removes only Gemini's **visible** bottom-right logo; it does
not touch SynthID or any other watermark.

## Run

Use the project's watermark-removal command named in its art style brief (read
`AGENTS.md` for the path). When a project defines none, call the CLI with the project's
package runner:

```bash
bun x gwr remove <input> --output <file>
node scripts/run.mjs remove <input> --output <file>
```

## Rules

- Write to a **new** file. Never overwrite or mutate the raw download.
- Keep the output inside the project's gitignored raw-download directory.
- Verify the result before staging: same pixel dimensions, and the bottom-right region
  no longer carries the logo.
- `applied: false` (or `--json` → `meta.applied`) means the image was already clean;
  keep going with the original.
- `qualityStatus` of `possible-content-damage` means the pass *may* have eaten real
  pixels. Do not decide on the flag alone: crop the bottom-right corner of the raw and
  the cleaned image, scale both up and compare. If the cleaned corner shows intact
  content and no logo, keep it; if content is visibly damaged, stage the original.
  On saturated chroma backdrops (pure magenta, green) the flag fires on channel
  clipping (`newlyBlackClippedRatio`) even when the result is clean.

## Upstream notice

MIT licensed. Vendored from `GargantuaX/gemini-watermark-remover`; the watermark
detection and reverse-alpha calibration are the upstream author's work. Keep this
notice and the upstream license with the vendored script.
