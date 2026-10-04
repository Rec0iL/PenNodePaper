# Status (October 2026)

Built: the core loop (typed nodes, canvas, pool, command layer, undo, MCP, chat with Claude/agy, animations), rulebooks and world books, ComfyUI images, the map tool (battle + region, select tool, painting), the VTT bridge (handouts, scenes, backdrops, characters, music, party), story tools (played path, split parties, linter, reconverge report, clocks, known), random tables, frames, search (Ctrl+K), notes import, GM binder PDF, player wiki and recap, backup & sync, campaign switching and branching, review mode, thumbnails, semantic zoom.

Changed on the way: maps are an attachment of a *location* (no separate map node); "propose first" became **review mode** (AI edits apply at once and wait for Keep / Reject, so step-by-step AI work still chains); alternate timelines are covered by the story tools plus **branching a campaign**.

Not built: hex-grid maps (the KINETIK VTT does not support them), collapsing frames into sub-graphs, multi-VTT at once (one VTT at a time).

---

# PenNodePaper — Design Plan (vision-alignment draft)

## Context
A dark, sleek, local-first web app for **AI-assisted world and story building** for pen & paper GMs. The story is a node graph on an infinite canvas. A sidebar pool holds prepared nodes with no fixed place in the story yet (the tavern the players may or may not visit). Claude and agy (Antigravity CLI) work inside the app through an MCP server and an integrated chat. They can create, edit, link, relink, delete and move nodes, and every change is animated. The app loads a markdown rulebook, generates art and maps through the local ComfyUI (Krea 2), and talks live to the user's KINETIK VTT (`KINETIK_PNP/tools/kinetik-vtt`).

Started in an empty working directory with no git repo.

## Decisions made (from the Q&A)
| Area | Decision |
|---|---|
| Platform | Local web app: Node/TS backend + Svelte 5 + Vite + TS frontend, **Svelte Flow** for the canvas |
| Look | Sleek modern dark, own identity (quiet near-black, soft glows, per-node-type accent). Not KINETIK noir. Theming via CSS tokens |
| Language | German UI via an i18n layer (de/en). Campaign content in any language, set per campaign |
| Storage | Campaign = project **folder of files**: one `.md` per node with YAML frontmatter, `graph.json`, `images/`. Git-friendly, hand-editable |
| AI backends | **Claude + agy, switchable per message**, spawned as headless CLI subprocesses. Both attach the app's MCP server over HTTP (`agy mcp add --header …`, Claude `--mcp-config`). Verified: both support `stream-json` and session resume |
| AI autonomy | Live-apply + undo with a toggle to "Propose first" (ghost previews). Every AI batch = one undo step |
| Safety | Soft delete (trash) + undo + automatic folder snapshots. No confirm popups |
| Proactivity | Suggestion lane: an "ideas" tray the AI fills. Nothing changes the canvas until accepted |
| Node model | Typed nodes with custom fields. Starter types below. Users can add types |
| Edges | One graph, typed edges, each with its own colour/style, toggleable per layer |
| Structure | Multiple campaigns/worlds → multiple canvases per campaign → groups/frames → collapsible sub-graphs |
| Layout | Left = pool, centre = canvas, right dock = Chat / Inspector tabs, bottom strip = timeline/branches + AI activity. Focus mode collapses panels |
| Node UX | Compact card (icon, title, summary, thumbnail, status) + inspector drawer. Semantic zoom |
| Packaging | npm scripts + optional Pinokio 1-click launcher |
| Phasing | Core loop first |

## Node types and edges
- **Story:** Scene, Encounter, Event/Twist, Clue/Secret, Decision point
- **World:** NPC, Location, Faction, Item, Lore entry
- **Play helpers:** Handout, Annotation (sticky note on node/edge), Progress clock, Random table
- **Map node:** embeds a map from the map tool, with pins that link to other nodes
- **Edge kinds:** leads-to, conditional ("if players do X"), reveals, belongs-to / lives-in, foreshadows, bridge (added by reconvergence)
- Common fields: title, summary, markdown body with a separate **read-aloud** block, tags, status (untouched/active/done/skipped), images, rulebook refs, `poolHint` ("when this might happen"), per-node chat thread id

## Campaign folder layout (proposal)
```
<campaign>/
  campaign.json        name, language, style profiles, comfy config, rulebook paths, VTT link settings
  graph.json           canvases, frames, positions, edges, pool membership, branches
  nodes/<id>.md        frontmatter (type, fields, status, tags) + body
  maps/<id>.json       structured vector map (source of truth)
  images/              generated art + gallery metadata
  rulebooks/           md files + generated heading index
  snapshots/           automatic history
  sessions/            session log, played path
```

## Architecture
- **Backend (Node/TS):** file store + watcher (hand edits and Claude-Code-direct edits show up live), graph service (all mutations go through one command layer so undo, animation events and MCP share it), MCP server (streamable HTTP, localhost, bearer token) exposing the same command layer, CLI runner for Claude/agy (stream-json → chat + tool-call cards), ComfyUI client, rulebook indexer, VTT bridge.
- **Frontend (Svelte 5 runes):** canvas, pool, inspector, chat, timeline. A WebSocket from backend pushes **change events** (`node.created`, `edge.rewired`, `node.moved{pool→canvas}` …) that drive the animations.
- **Command layer = single source of truth** for UI actions, MCP tools and undo batches. This is the key design constraint.

## MCP tool surface (draft)
- Graph: `create_node`, `update_node`, `delete_node`, `restore_node`, `link`, `unlink`, `relink`, `move_to_pool`, `place_on_canvas`, `move_node`, `group`, `get_graph`, `search_nodes`, `annotate`, `snapshot`
- Rulebook: `list_chapters`, `get_section`, `search_rules`
- Images/maps: `generate_image`, `queue_status`, `create_map`, `edit_map` (vector shapes), `render_map`
- Story: `lint_story`, `mark_played`, `fork_timeline`, `reconverge`, `missed_report`, `suggest_placement`
- VTT: `get_vtt_capabilities`, `push_handout`, `push_scene`, `push_npc`, `play_track`, `list_vtt_tracks`, `export_vtt_bundle`
- Resources: node markdown, campaign bible, rulebook digest

## Animations and feedback
Spawn glow and delete dissolve, edges draw themselves, rewire slides the edge end from the old target to the new one, nodes fly between pool and canvas, field-level diff flash (old value struck through), AI presence cursor/spotlight with optional camera follow, activity timeline with click-to-jump and per-action revert, plus tool-call cards in chat. Per-node chat threads leave a pointer card in the global chat so they don't get lost.

## Rulebook
Markdown parsed by headings into an index. MCP tools fetch only what's needed. A generated or edited core-rules digest is always in context. Multiple rulebooks per campaign are allowed.

## Images (ComfyUI)
- Port `comfy.py` (REST: `/system_stats`, `/object_info`, `POST /prompt`, poll `/history`, `GET /view`, `/interrupt`) to TS. Reference: `KINETIK_PNP/tools/rulebook-pdf/rpdf/comfy.py`. Krea 2 graph: UNETLoader → CLIPLoader(type `krea2`, `qwen3vl_4b_fp8_scaled`) → VAELoader(`qwen_image_vae`) → KSampler (8 steps, cfg 1, euler/simple). Model detection reference: `rpdf/models.py:79-84`. Custom API-format workflow import: `_patch_custom` (`comfy.py:103-146`).
- Add: a queue with progress (use the websocket instead of polling), N variants + picker + per-node gallery, a per-campaign **style profile** combined with per-type profiles (portrait/scene/map/handout), and **Flux Kontext** (already installed) for variants from an approved portrait.
- Prompt writing by the chosen AI backend, as in KINETIK `planner.py:183` (`agy -p … --output-format json`).
- Hardware: Quadro RTX 5000, 16 GB, ComfyUI started with `--reserve-vram 3`. Queue one job at a time.

## Map tool
- **Source of truth:** structured JSON (grid, rooms/polygons, walls, doors, props, labels, token start positions). The MCP/AI emits shapes. The user draws in a simple editor (snap-to-grid walls/doors/rooms). Rendered to SVG/PNG.
- **Pipeline:** colour-coded control image → ComfyUI img2img (low–mid denoise) or Flux Kontext "paint this layout"; ControlNet (canny/scribble) is an option on the SDXL/Illustrious checkpoints, since no Krea 2 ControlNet was found. **Scribble mode:** freehand sketch → same img2img step.
- Kinds: top-down battle maps, regional/world maps (labels and pins link to nodes), illustrated/isometric scene maps.
- **Export to VTT on demand** (not automatic): scene with grid size, offset and token start positions.
- Models to propose and **approve before any download**: small ESRGAN-style upscaler (handouts to print resolution), SDXL fantasy/tile-map LoRAs (Hub search found few, quality uncertain), a canny/scribble ControlNet matching the chosen base. Current state: no upscalers, no ControlNets, no map LoRAs installed.

## VTT integration (KINETIK VTT facts from exploration)
- The VTT has no backend: the GM browser tab is the server (PeerJS/WebRTC). Session state `GmSession` lives in IndexedDB. Session-file import/export exists (`gm.svelte.ts:1038-1079`, format `{kinetik:'session', version:1, session, assets}`, lenient validation). Handouts: `Handout {id,title,kind,hash?,text?,ts}`. Scenes: `MapState`. Assets are keyed by hash (SHA-256, first 16 bytes, hex). Music catalog is in `public/music/catalog.json`, and users can upload their own tracks.
- **Decision: live bridge + file export.**
  - **File export:** a session-file-compatible JSON (handouts, scenes, assets) plus a manifest describing what is being imported. Works offline.
  - **Live bridge:** an opt-in addition to the VTT. The GM tab connects out to `ws://127.0.0.1:<port>` on PenNodePaper. The app can then push handouts, scenes, NPCs and music cues, and read which tracks the GM has uploaded (`list_vtt_tracks`) so cues reference real tracks.
- **VTT changes to plan (separate repo):** the bridge client and a "PenNodePaper link" toggle in `Gm.svelte`. Extend the NPC model (`src/gm/combat.ts`) so nemesis/elite/goon NPCs get **moves and profile images**, including setting-fitting goon portraits. Add a handout/NPC import path that doesn't need a file picker.
- New content types would need defaults in `loadSavedSession` and `importSession` (`gm.svelte.ts:94-108`, `1064-1079`).

### Multi-VTT support (added after review)
Goal: the tool works with KINETIK now and with the user's mate's VTTs later (the mate adapts his VTT, not this app).
- **Universal Push Format (UPF), fixed and versioned.** PenNodePaper defines one schema for everything pushable: `handout` (text/image), `scene` (map image, grid type/size/offset, token start positions), `npc` (name, tier, stats blob, moves, portrait, notes), `music_cue` (track ref or mood), `track_list`. Each VTT adapts to UPF on its own side. There are no per-VTT mapping rules and no adapter plugins in this app.
- **Bridge protocol:** small, versioned WebSocket protocol (`pennodepaper-bridge`), documented in `docs/vtt-bridge-spec.md` for VTT authors, with a conformance checker/mock VTT so a mate can verify his implementation.
- **VTT profile = capabilities declaration**, sent by the VTT in its `hello`: id, name, version, which UPF push types it supports, supported grid types (square/hex), image limits/formats and hash scheme, NPC tier vocabulary and which NPC fields it honours (moves, portrait, …), music support, and the file-import format version.
- **Pull, cache, refresh:** on every connect the app pulls the profile and saves it to `vtts/<id>.vtt.json`. It is refreshed on the next connection. Offline (no VTT connected, or the user works without the AI), the cached profile still drives what the UI offers and what the file export produces, and the AI sees it via `get_vtt_capabilities`.
- **Per-campaign target:** a campaign picks its VTT profile(s). The AI only offers pushes the profile supports and fills NPC/handout fields per the profile's vocabulary (for example the KINETIK NPC ladder goon → schlaeger → elite → boss → nemesis).
- **File export:** UPF bundle (JSON manifest + assets). The KINETIK profile additionally declares a converter to its session-file format (`{kinetik:'session', …}`), implemented in the app as the first built-in exporter. Other VTTs can import UPF directly.
- Tests: bridge protocol round-trip against the mock VTT in CI, and the KINETIK client in `kinetik-vtt` against the same spec.

## Divergence (off-script players)
Played-path glowing trail over the planned graph; "Diverge here" forks a timeline branch; annotation nodes record what really happened (the AI reads them); **Reconverge** asks the AI for merge points, bridge nodes and a **missed report**; missed nodes can fall back into the pool, re-hooked.

## Other features chosen
Story linter, player knowledge tracker, progress clocks/faction pressure, alternate timelines/snapshots, extra views (list, in-world timeline, relationship web) + Cmd-K search/tags/filters, generators/random tables, import existing notes (docx/pdf/md → typed nodes; reuse KINETIK `importer.py` idea), GM binder PDF (WeasyPrint, reuse the `layout.py` / `theme.css` approach), session log + "what now?" assistant, node status + "you are here" marker, smart pool (type/tag/location filters, `poolHint`, AI placement suggestions, drag back to pool).

## Phased roadmap
1. **Core loop:** project scaffold, file store + watcher, typed nodes/edges, canvas, pool, inspector, command layer + undo + trash, MCP server, chat with Claude/agy, tool-call cards, animations.
2. **Rulebook + ComfyUI images:** heading index and rule tools, queue/gallery, style profiles, variants.
3. **Map tool:** vector editor, MCP shape drawing, img2img/Kontext pipeline, scribble mode, model additions (with approval).
4. **VTT bridge:** file export, then live bridge, then VTT-side NPC/moves/portraits and music cues.
5. **Story tooling:** timelines/branches, played path, linter, knowledge tracker, clocks, extra views, generators, importer, binder PDF, player lore wiki + recap, backup/sync.

## Late decisions
- **Threads:** one long-lived AI session per backend per campaign. A node thread is that session with the node pinned as context, and its history is stored in the node. A pointer card appears in the global chat.
- **Map grid:** square by default, **1 cell = 6 ft** (editable per map), plus a **hex** option for other rulebooks. Grid size/offset go to the VTT on export.
- **Audio:** no TTS (the GM reads aloud). Mood-music cues tied to nodes via the VTT's uploaded tracks stay in.
- **Added scope:** player-facing spoiler-safe lore wiki and AI-written session recap (builds on the knowledge tracker). Backup/sync: scheduled snapshots, optional git integration, folder sync.

## Remaining open questions (resolve during phase 1)
- Project branding and ID scheme (default name `PenNodePaper`, short readable slugs for node IDs).
- Exact frontmatter schema per node type.
- agy MCP registration is global (`agy mcp add`), so the app registers its token-protected endpoint once. Claude gets a per-run `--mcp-config`.

## Verification (once implementation starts)
- Phase 1: `npm run dev`; attach Claude (`claude --mcp-config`) and agy (`agy mcp add …`) to the MCP endpoint, then run a scripted tool sequence (create → link → relink → move to pool → place → delete → undo) and watch the animations and the on-disk files change. Vitest for the command layer and undo batching.
- ComfyUI: use `mcp__comfy-mcp__server_info` and a generation round-trip using the Krea 2 graph.
- VTT bridge: open the VTT GM tab (`npm run dev`, port 5173) and push a handout and a scene end-to-end.
