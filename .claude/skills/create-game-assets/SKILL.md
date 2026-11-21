---
name: create-game-assets
description: Generate new pixel-art game assets with Gemini web through Chrome DevTools MCP, then download, validate against the project palette and frame contract, register them, and commit. Use when a sprite, sheet, FX, icon or UI image is missing and has to be authored; covers prompting, supervised generation, staging, verification and the one human checkpoint.
---

# Create game assets

Author new art in the style already used by the project, with **one human checkpoint** at generation. The agent drives the browser; the human watches the image appear and approves it before any file is staged.

**Not this skill:** copying existing pack art into the project (that is a byte-for-byte staging pass), or changing art-independent game code.

## Preconditions

- Read `AGENTS.md`. It names this project's art style brief and the staging command; those are the only project-specific facts you need. Read the style brief before composing any prompt.
- The Chrome DevTools MCP server must be attached to a Chrome session the human has already signed in — the debug-port server, not a headless/isolated one. If it is not, stop and ask the human to attach it — do not attempt to log in.
- A captcha or a human-only consent step is a stop condition. Ask the human to clear it, then resume.

## Workflow

1. **Define the asset.** From the request and the style brief, write a spec: logical key, animation/frame size, layout, directions, frame count, frame rate, looping, anchor, source image and target name. Check the existing manifest first so the key is new and consistent.
   Completion: a spec that the project's manifest validator would accept, written to the raw download directory named in the style brief.

2. **Assemble the prompt.** Load the fixed reference set named in the style brief, upscale any tiny pixel-art reference with the command the style brief names (Gemini resamples uploads and loses 10–64 px detail), upload those images through the browser tool (one file per upload call, re-snapshotting between them), and write a prompt that states the frame grid, pixel size, viewing angle, palette restriction and a flat chroma-key backdrop (never "transparent", which the model usually paints white). One prompt produces one sheet.
   Completion: the reference images are attached and the prompt is in the Gemini prompt box, ready to submit.

3. **Generate — CHECKPOINT.** Submit the prompt, wait for the image, inspect the full-size result (not the cropped conversation preview) against the review checklist in the reference file — above all: identical colours on every row, nothing crossing into a neighbouring cell, a design simple enough to read at the target frame size — and stop. Reject and regenerate yourself when it fails the checklist; show the human only a sheet that passes. Tell the human exactly what was generated, including any doubt, and ask for approval. Do not download, crop or write to the repository before approval. A first-upload consent dialog is the human's to accept, not yours.
   Completion: the human has approved this specific image in the browser.

4. **Stage the approved image.** Download the full-size image into the raw download directory, strip any provider watermark with the command named in the style brief (write a new file; never mutate the raw download), then run the project's staging command. It maps the image onto the project palette, runs a quality gate on every cell, downscales, writes the asset and its `.meta`, and merges the manifest entry. If the gate rejects the image, regenerate once with the failure named in the prompt (back to step 3), then ask the human. Never bypass the gate for an asset you commit.
   Completion: the staging command exits cleanly, and the staged PNG, its `.meta` and the updated manifest pass the project's checks.

5. **Verify.** Run the project's full check command. Inspect the staged sheet scaled up with nearest-neighbour **on a background like the game's floor**, next to a reference sprite of the same role: silhouette readable, accent (eyes) visible in every frame, frames consistent, feet on the floor. If it reads worse than the reference, go back to step 2 with a simpler design rather than tuning the pipeline.
   Completion: checks are green and the staged sheet reads as clearly as the reference.

6. **Commit locally.** Stage only the new and modified files and commit with a `feat(art):` message. Never push. Delete scratch previews and screenshots from the raw download directory; keep the approved download and its cleaned copy.
   Completion: a clean working tree and a commit describing the generated asset.

## Reference

Browser interaction details, including the prompt box, upload control and download button, are in [browser-and-pipeline.md](references/browser-and-pipeline.md). Load that file before touching the browser.
