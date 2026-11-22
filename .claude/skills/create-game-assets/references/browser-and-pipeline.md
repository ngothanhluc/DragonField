# Browser and staging mechanics

Read this only when running the `create-game-assets` workflow. The order below is the
order that actually works; each phase ends with a check before the next one starts.

## 0. Preflight — a signed-in session

A machine can expose two Chrome DevTools MCP servers: a headless `--isolated` one
(always logged out) and one attached to a named debug port (`--browserUrl`). Pick the
attached one. `list_pages` on the headless server still shows Gemini, so check the
snapshot: a "Sign in" heading or link means the wrong browser or a logged-out profile.

If no page is signed in, **stop**: ask the human to launch Chrome with a persistent
profile and a debug port, sign in once, and leave it open. Never attempt to log in.

```
open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-agent"
```

The session is shared: every later run reuses that profile, so the sign-in is one-time.

## 1. Image mode

The `/images` route may redirect to `/app` (it does for a signed-in account). The
image entry point is the prompt's **attachments/tools button** → tick the
`menuitemcheckbox` named "Create images" (localized, e.g. `Tạo hình ảnh`). The
composer then shows a "Create images" heading plus aspect-ratio and format controls.
The model can appear under a codename; never depend on the "Nano Banana" brand name.

## 2. The prompt

The box is a Quill `contenteditable` (`role=textbox`). Its `aria-label` is localized,
so match the role, not the English label.

- `fill` does nothing on it.
- `type_text` can silently drop the **leading** characters of a long prompt. Do not use
  it for the real prompt.
- Set the text deterministically, then verify the length:

```js
() => {
  const el = document.querySelector('[role="textbox"][contenteditable="true"]');
  el.focus();
  document.execCommand('selectAll');
  document.execCommand('insertText', false, TEXT);
  return el.innerText.length;
}
```

Expect `innerText.length` to land within a few characters of `TEXT.length` (paragraph
marks differ); a short count means the text was truncated — run it again.

Submit with `Enter` in the box (`Shift+Enter` is a newline). The a11y snapshot does not
reliably expose a send button.

Prompt shape that survives downscaling (numbers come from the style brief):

- one sheet, exact canvas and grid math (e.g. 4 columns × 4 rows of 16×16 cells),
- column order stated explicitly (`down, up, left, right`), row = frame index,
- a flat **chroma-key backdrop** (magenta `#ff00ff`), never "transparent" or white,
- palette restricted to the attached palette image, hard pixels, no AA/blur/shadows,
- no text, labels, grid lines or watermark,
- same character/proportions/anchor across frames.

## 3. Reference uploads

Upscale the references first: the pack's palette sheet can be 10×9 px and a monster
strip 64×64, and Gemini's vision encoder resamples uploads before it reads them. Run the
reference-prep command named in the style brief (nearest-neighbour, long side ≥ 768 px)
and upload the upscaled copies, not the originals.

The file input is **not** `multiple`: passing several `filePaths` to one
`upload_file` call fails with `Multiple file uploads only work with <input
type=file multiple>`. Upload one file per call.

UIDs die on every view change or menu close. Never reuse one across snapshots; this
loop re-reads them each time:

```js
// per file: open the tools menu, take a snapshot, find the upload item, upload
await click({ pageId, uid: toolsButtonUid });          // toggles the menu
const snap = await take_snapshot({ pageId });
const uid = snap.match(/uid=(\S+) menuitem "[^"]*pload/i)[1]; // localized label
await upload_file({ pageId, uid, filePaths: [file] });
```

Verify the attachment count before prompting:

```js
() => [...document.querySelectorAll('img')].filter((i) => i.src.startsWith('blob:')).length
```

The first upload can raise a one-time Google consent dialog ("Create content from
images and files" / `Huỷ`–`Đồng ý`). Accepting a policy is the human's decision: stop,
ask, then re-snapshot.

## 4. Wait, then inspect the real pixels

Generation is async: wait until the "Stop generating" button disappears and a
≥1024×1024 `<img>` exists inside `message-content`. Do not assume the first snapshot is
finished.

The conversation preview **crops** the sheet, so inspect the source: read `img.src`
(blob URL), open it in a new page, size the viewport to the image, screenshot the whole
image. Check in order:

1. grid and column order, frame count per direction,
2. subject — a character copied from the reference is a regenerate,
3. **consistency** — the same outfit colours on every row; a recoloured row is a regenerate
   (staging's `drift` gate would reject it anyway),
4. **margins** — no weapon, cape or tail reaching the left/right/top edge of its cell
   (staging's `edge` gate),
5. **animation** — idle/loop frames differ by small motion, not a new pose,
6. **readability** — squint: would it read at the target size? Big flat shapes, a body
   lighter than its outline, a visible accent. Fine texture and an all-dark body do not
   survive a 16 px downscale,
7. backdrop — is it the flat chroma colour, or did Gemini paint white,
8. palette — only the given hues, no gradients,
9. outline and pixel density — hard pixels, no anti-aliasing.

Regenerate in the same conversation with the failure named ("row 4 changed the cloak
to brown; keep every row identical") — Gemini then edits instead of starting over.

## 5. Download

The action lives in a hover toolbar; clicking it blindly on a stale uid does nothing.
Hover the image, then click the localized "Download full size" button in page context:

```js
async () => {
  const img = [...document.querySelectorAll('message-content img')]
    .find((i) => i.naturalWidth >= 512);
  img.scrollIntoView({ block: 'center' });
  img.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 600));
  const btn = [...document.querySelectorAll('button')]
    .find((b) => /download|tải .*xuống/i.test(b.getAttribute('aria-label') || ''));
  btn.click();
  return 'clicked';
}
```

The file lands in the browser's download directory. Move it into the raw download
directory named in the style brief; raw downloads never enter a commit.

## 6. Watermark, spec, staging

1. Strip the provider watermark if the style brief names a remover; write a **new**
   file and keep the raw download untouched.
2. Write the spec next to it. `background` chroma-keys the backdrop; a key without a
   trailing direction plus four `directions` expands to one key per direction over a
   single sheet.
3. Run the project's staging command: palette mapping at full size, colour limit,
   quality gate (aborts on cells crossing edges or recoloured frames), deterministic
   downscale, binary alpha, stable `.meta` uuid, merged manifest. A gate failure is a
   regenerate, not a flag to bypass.
4. Re-running with the same spec must reproduce the same bytes (uuids preserved).
5. New actors go into the project's generated-art allowlist (staging writes it).
6. Finish with the project's full check command, then commit locally. Never push.

## Failures seen in practice

| Symptom | Cause | Fix |
|---|---|---|
| Gemini asks to sign in | headless/isolated MCP server | attach the debug-port server; full preflight in §0 |
| `/images` bounces to `/app` | route changed | enable the "Create images" menu item (§1) |
| `Element uid "…" not found` | uid reused after a menu/view change | re-snapshot, re-find every time |
| Upload says "Multiple file uploads…" | input is single-file | one `upload_file` call per reference |
| Prompt starts mid-sentence | `type_text` dropped the head | `execCommand('insertText')` + length check (§2) |
| Image never appears | generation still running | wait for the stop button to disappear (§4) |
| Only one row of sprites looks right | conversation preview cropped the sheet | open the blob URL and screenshot the whole image (§4) |
| Sprites sit on a white box | Gemini ignored transparency | magenta key colour in the prompt + `background` in the spec |
| Watermark patch in the corner | logo survives the downscale | run the remover first (§6) |
| Sheet is 4 columns but staging rejects the key | directions/key model | one asset, `directions: [down,up,left,right]`, no direction in the key |
| Staging fails with `drift` | Gemini recoloured a row | regenerate, naming the row and colour in the prompt |
| Staging fails with `edge` | a weapon/cape crosses into the next cell | regenerate with the margin sentence; or mirror a clean side |
| Staged sprite is a dark blob | body drawn in the darkest palette colours | prompt mid/light body values, darkest colour for the outline only |
| Left and right facings do not match | drawn independently | `mirror` in the spec |

Report-only CSP console messages are noise. A captcha, sign-in wall or consent dialog
is a stop condition: hand control back to the human.
