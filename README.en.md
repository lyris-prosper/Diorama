# Diorama 方寸

> Rearrange your room without lifting a finger. Try it before you buy it.
> 不用搬，就能换个摆法；不用买，就能先摆上看看。

[中文说明](README.md)

Upload one photo of a room and rearrange it in 3D. The photo becomes a 3D room you can walk around; the furniture already in it can be erased and replaced by a movable model; real products from the furniture library can be placed in it, true to size, with their price and shop link; a lamp, a tray or a mug can stand on a desk or a bed. Recognition, cut-outs and background repair run on this Mac; only 3D generation uses provider credits.

The page is in Chinese and English: the ZH | EN switch next to the brand name can be clicked or dragged, and the choice is remembered in this browser.

## Start

Double-click **启动方寸.command**, or in the project folder run:

```bash
npm start
```

Needs Node.js 22.13 or later. Start-up checks the local models, migrates the database, serves the app at <http://localhost:5173>, prepares the sample bedroom and opens the page in Chrome. Use `NO_OPEN=1 npm start` to skip opening the browser.

On another computer run `npm ci` first. The first start downloads the LaMa background-repair model (about 208 MB); after that, recognition and repair need no network.

## Demo walkthrough

The demo photos are in `resources/demo/`: `bedroom.jpg` (a bedroom with a bed, a desk and a wardrobe), `bed.png` (the bed on a white background) and `pendant.png` (a pendant lamp product photo). None of the steps below calls a paid service.

1. On the home page, switch the language, drag the furniture in the wooden model, and toggle Day / Dusk.
2. Click **Upload photo** and choose `resources/demo/bedroom.jpg`. The app recognises the photo (its bytes or its visual fingerprint), creates the space “Bedroom” and opens its **Marble 1.1** room at once: the floor is calibrated and the empty-room layer is in place. No World Labs call, 0 credits.
3. Turn on **Move room furniture** in the toolbar at the top, click the bed and choose to upload a photo. (With the switch off, clicking the room does nothing.) Kind, size and erase box are already filled in; choose `resources/demo/bed.png` and the page says the photo was already made into 3D. Confirm: the original bed disappears and the generated bed model stands in its place, ready to drag and turn. 0 credits.
4. Click **Add furniture** in the shelf and choose `resources/demo/pendant.png`. Name, kind (pendant light) and size fill in by themselves and the dialog says no credits are needed. The lamp lands on the shelf at once; click it, then click the ceiling (or the floor below it): it hangs from the ceiling and slides along it when dragged.
5. Open the **Library**, put a lamp, a tray or a mug on the desk or the bed, ask *Find me* for “a lamp under $50”, check prices and shop links, and save.
6. Afterwards, delete the demo space under **All spaces** on the home page. The sample bedroom's files live under `presets/` and the demo models under `public/demo/`; they belong to no space, so the next demo works the same.

Any other photo takes the normal path: the first step offers **Generate the 3D room (draft · about 230 credits)**, with a confirmation first. The page also suggests generating the same photo with Marble 1.1 on the Marble website for a sharper room and importing it here (no credits from this app). The optional furniture step can still recognise, remove or model pieces; with less than about 3 GB of free memory, automatic recognition is skipped with a note.

## Browsers

Chrome and Edge are recommended; Safari works too. Safari 17 on macOS used to crash while opening a 3D room: its JavaScript engine fails when two of Spark's WebAssembly workers start running at the same moment. The room now loads its files one after the other, and Spark's level-of-detail worker (unused here) is off; on this Mac (Safari 17.5) the room opened three times in a row without a crash (see `docs/VALIDATION.md`).

To open one space directly, e.g. to rehearse or record a demo: `http://localhost:5173/?space=<space id>`.

## Features

- **Spaces**: the home page lists every space; continue the last one, open, rename or delete. Room files another space still uses are kept when a space is deleted.
- **Photo → 3D room**:
  - DETR + SlimSAM on this Mac find the furniture in the photo; LaMa fills in the wall and floor behind it.
  - The 3D room is generated with World Labs, or imported from the Marble website by pasting its embed code or link (free).
  - The floor is calibrated automatically and the room is shown in real metres.
- **The same photo is never paid for twice**:
  - Room: a photo with the same fingerprint (re-saved or compressed too) reuses the existing 3D room.
  - Furniture: a file already made into a high-detail Tripo model gets that model back, without a new job.
- **Making room furniture movable**:
  1. Turn on **Move room furniture** and click a piece in the room. The blue box fits itself to the piece from the room scan and fills in its size and kind (`lib/fit-box.ts`); adjust it, or refit it with **Fit the box to the piece**.
  2. Upload a photo of the piece. The original is erased from the room while Tripo makes a new model, which is put back where it stood.
  3. An empty-room layer can be imported: erased areas show its walls and floor.
- **Placing**:
  - A piece lands on the surface under the pointer: floor, desk, bed, windowsill, including the scanned desk in the room.
  - Pointing at the side of a piece puts the new one on its top; pointing at a wall or a wardrobe door does nothing.
  - Moving or turning a desk carries what stands on it; putting the desk away drops those pieces onto the surface below.
  - Wall pieces are raised onto the wall with **Height**, and **Drop** puts them back on the surface below.
  - Pendant lights hang from the ceiling: pieces of the kind “pendant light” or with “pendant / 吊灯” in their name hang under the ceiling where you point and slide along it when dragged. The ceiling height comes from the room scan, lower soffits included. Any piece can be switched to **Hang** in its panel.
  - When the typed size disagrees strongly with the photo's proportions (only the shade's height given for a lamp with a rod), the model is scaled evenly and keeps its shape; the panel marks it “photo proportions”.
- **Furniture library**:
  - 20 real products with 3D models, sizes, USD reference prices, shop links and stock notes.
  - Drag them into the room; the shelf shows the total for the library pieces in the room.
  - *Find me* understands requests such as “a desk no wider than 1 m”, “a lamp under $50” or “small things under 500 yuan”.
- **Add furniture**: upload photos of pieces that are not in the room; Tripo makes each one in high detail (H3.1, detailed geometry, 8K PBR textures) and it is placed true to size. The room shows a 4K copy (200k–400k triangles); the 8K original is kept and can be downloaded from the piece's panel. Older pieces can be **regenerated in HD** from the shelf or the panel; the old model stays until the new one is ready.

## 3D generation and credits

Image processing (recognition, cut-outs, repair) is free. Only these use provider credits:

| Service | Used for | Each time, about |
|---|---|---|
| World Labs (Marble draft model) | a 3D room from a photo | 230 credits |
| Tripo H3.1 high detail (detailed geometry + 8K PBR textures) | a 3D model of one piece | 70 credits |

To generate, copy `.env.example` to `.dev.vars`, fill in `WORLDLABS_API_KEY` and `TRIPO_API_KEY` with a text editor and restart the app. Keep the keys out of every other file.

Spending safeguards:
- Every submission shows its estimated credits and needs a confirmation.
- A local budget cap (`WORLDLABS_CREDIT_LIMIT` and `TRIPO_CREDIT_LIMIT` in `.dev.vars`); a failed job releases what it reserved.
- A job whose submission can't be confirmed is marked “needs checking” and never resubmitted automatically.
- A timeout keeps checking the original job; it never generates again.

## Data on this Mac

| Where | What |
|---|---|
| `.wrangler/state/` | The spaces database, photos, rooms and furniture files. **Don't delete it**: every space would be lost. |
| `.local/models/` | The LaMa background-repair model (downloaded and checked at start-up). |
| `public/vision/models/` | Recognition models shipped with the project (DETR, SlimSAM). |
| `public/catalog/` | Product pictures and compressed 3D models of the furniture library. |
| `public/demo/` | The demo bed (1.3 MB) and pendant lamp (2.5 MB) models with their thumbnails. |
| `resources/demo/` | The demo photos: bedroom, bed, pendant lamp. |
| `.dev.vars` | API keys; never committed. |

## Development and tests

```bash
npm run typecheck
npm test
npm run scan
npm run lint
```

- `npm test`: every offline test, with all network calls mocked, so nothing paid can be called. Seven groups: providers, furniture, spaces (sample bedroom, model reuse, regeneration), library search (Chinese and English), placement, fitting (erase box, ceiling, model size) and the two-language check.
- `npm run scan`: run before committing; checks that no key from `.dev.vars` appears in any committed file.
- `node tests/local-workflow.mjs`: needs the app running and about 3 GB of free memory; runs the real recognition and repair models in a new test space (delete it afterwards on the home page).
- `node tests/recognition-smoke.mjs`: runs the shipped recognition models on two reference pictures, no server needed.
- `npm run catalog`: maintains the furniture library (`scripts/build-catalog.mjs`); `--images <folder>` rebuilds the card pictures from official product photos.

## Main files

- `components/editor/Workbench.tsx`: the page and every flow; `Landing.tsx` is the home page, `Maquette.tsx` its wooden model, `LangToggle.tsx` the language switch.
- `lib/i18n.ts`: the two languages; every interface text is written as `t("中文", "English")`.
- `lib/demo-room.ts`, `lib/server/demo.ts`: the sample bedroom (photo, Marble 1.1 room, empty-room layer, bed and pendant models) and model reuse.
- `components/editor/Scene.tsx`: the 3D view (three.js + Spark).
- `lib/placement.ts`: where pieces land and what stands on what; also the ceiling and wall-direction estimates (new pieces are put down square with the walls).
- `lib/fit-box.ts`: finds the clicked piece in the room scan and fits the erase box to it. `lib/fit-model.ts`: how a generated model is sized to the typed dimensions.
- `lib/credits.ts`: estimated credits per generation.
- `app/api/workbench/route.ts`: the local server API (spaces, uploads, generation jobs, library).
- `lib/server/`: jobs, budget, provider calls, storage.
- `build/local-*-plugin.mjs`: helper services reachable only from this Mac (local models, model compression, proxy relay).
- `lib/catalog.json`: library data; sources of prices and links in `docs/SOURCES.md`.

More in `docs/ARCHITECTURE.md` (structure), `docs/SOURCES.md` (sources and licences) and `docs/VALIDATION.md` (what was actually tested). These documents are in Chinese.
