# Graph Report - PenNodePaper  (2026-10-13)

## Corpus Check
- Large corpus: 209 files · ~1,123,185 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 2493 nodes · 5815 edges · 113 communities (98 shown, 15 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 190 edges (avg confidence: 0.85)
- Token cost: 296,871 input · 0 output

## Community Hubs (Navigation)
- Battle Map Editor UI
- Map Painting Concepts
- Map Data & Lettering
- Node Menu & Frames
- Campaigns & Config
- Edge & Node Kinds
- Web App State
- Backups
- MCP Commands & Characters
- Imports & Command Tests
- Campaign Menu & Sound
- Comfy Paint Runs
- Node Inspector
- Canvas Edges & Frames
- AI Chat Panel
- Node Cards & Party Strip
- Region Groups & Lines
- Edge Routing
- Tour Steps
- Character Sheets
- Map Experiments & Party Tests
- Command Store & PDF
- Campaign Store
- Tour Menu
- README Screenshots: Canvas & AI
- Server Chat Service
- Story Panel & Player Wiki
- Tray App (Python)
- Persistence & Legacy
- ComfyUI Jobs & Styles
- Command Palette & Review
- Rulebook Library UI
- World Editor
- GM Binder
- Image Service
- Canvas & Routing
- Tour Overlay
- Rulebook Store
- VTT Bundle Builder
- Story Analysis
- README Screenshots: Maps & Story
- Web Package Deps
- LAN Mode
- Tour Kit
- Tutorial Asset Generation
- Settings Modal
- Archive Import
- Sound Cues
- Map Groups & Consolidate
- Mock VTT & Profiles
- Tutorial Content Seed
- Comfy Client
- AI Demo & MCP Smoke
- Region Kinds
- Fake AI Demo Seed
- Tutorial Script
- Label Styles
- Images Panel
- Binder Modal
- Map Editor Selection
- Install Docs
- Search
- Root Package
- Label Rendering
- Lettering Tests
- Tutorial Campaign Setup
- VTT Hub
- VTT Bridge Spec
- Font Licenses
- Server Package
- Map Editor Undo & Prompt
- Party Sync
- Maps Service
- Shared VTT Types
- Label Width Estimation
- Pool & Flyers
- Web TS Config
- Launcher Script
- Server TS Config
- Map Editor Hit Testing
- Player Wiki
- README Architecture
- Server Dependencies
- Installer Script
- Paint Estimates
- Shared Package
- Sheet Fields
- Map Editor Paint Actions
- NPM Scripts
- Thumbnails
- agy Chat Tests
- ComfyUI Setup Docs
- Bridge Roles & Handshake
- Party & Handout Push
- Server Dev Deps
- Tutorial Scene Art
- Rusty Anchor Map Art
- Bridge Client JS
- Blue Label Materials
- Fake Comfy (Tests)
- Map Editor Custom Kinds
- Paper Label Materials
- Tutorial Clue Items
- Rusty Anchor Pass B
- Map Character Placing
- Map Editor Box Select
- Map Editor Own Prompts
- Launcher Installer
- Grimoire Material
- Runestone Material
- Wasteland Material
- Western Material
- App Icon

## God Nodes (most connected - your core abstractions)
1. `run()` - 80 edges
2. `cmd()` - 79 edges
3. `Store` - 75 edges
4. `say()` - 57 edges
5. `runCommand()` - 48 edges
6. `Persistence` - 45 edges
7. `app` - 44 edges
8. `toPng()` - 32 edges
9. `Comfy` - 30 edges
10. `ImageService` - 30 edges

## Surprising Connections (you probably didn't know these)
- `agy (Antigravity CLI)` --conceptually_related_to--> `Optional AI co-GM (Claude / agy)`  [INFERRED]
  docs/INSTALL.md → README.md
- `labelstyles.ts (@pnp/shared)` --implements--> `Names on the map (lettering label styles)`  [INFERRED]
  packages/server/assets/fonts/README.md → README.md
- `Characters on the map (tokens tied to NPC/enemy nodes)` --implements--> `characterTokens (tokens tied to characters)`  [INFERRED]
  README.md → docs/vtt-bridge-spec.md
- `PenNodePaper README` --references--> `Installing PenNodePaper guide`  [EXTRACTED]
  README.md → docs/INSTALL.md
- `Claude Code` --conceptually_related_to--> `MCP server endpoint (/mcp)`  [INFERRED]
  docs/INSTALL.md → README.md

## Import Cycles
- 3-file cycle: `packages/server/src/labels.ts -> packages/server/src/vtt.ts -> packages/server/src/maps.ts -> packages/server/src/labels.ts`

## Hyperedges (group relationships)
- **UPF push kinds sent to a VTT** — docs_vtt_bridge_spec_push_handout, docs_vtt_bridge_spec_push_scene, docs_vtt_bridge_spec_push_character, docs_vtt_bridge_spec_push_music_cue, docs_vtt_bridge_spec_upf [EXTRACTED 1.00]
- **Supported VTTs speaking the bridge protocol** — readme_kinetik_vtt, readme_eldarahq, readme_herohq, readme_pips_and_paws, docs_vtt_bridge_spec [EXTRACTED 1.00]
- **Map plan to painted, labelled picture pipeline** — readme_battle_maps, readme_region_maps, readme_two_step_painting, readme_comfyui_images, readme_map_names [INFERRED 0.85]
- **Three-pane UI: Pool, Canvas, Inspector** — docs_img_canvas_detail_pool, docs_img_canvas_detail_story_canvas, docs_img_canvas_detail_inspector, docs_img_canvas_detail_activity_log [EXTRACTED 1.00]
- **Plan to painted battle map flow** — docs_img_map_editor_battle_map_editor, docs_img_battle_before_after_terrain_props_blend, docs_img_images_comfyui_generation, docs_img_battle_two_step_painting_animation [INFERRED 0.85]
- **AI edits canvas via MCP with undoable activity** — docs_img_chat_ai_chat_panel, docs_img_chat_mcp_tool_calls, docs_img_canvas_detail_activity_log, docs_img_canvas_detail_ai_edit_mode, docs_img_ai_demo_scripted_ai_session [INFERRED 0.85]
- **Stepwise region painting demonstrated on three region plans** — docs_img_region_before_after_stepwise_region_painting, docs_img_region_two_step_region_two_step_animation, docs_img_region2_two_step_mountain_pass_animation, docs_img_region3_two_step_river_valley_animation, docs_img_region2_before_after_mountain_pass_comparison, docs_img_region3_before_after_river_valley_comparison [INFERRED 0.95]
- **Plan to painted battle map flow** — docs_img_map_painted_battle_map_editor, docs_img_map_painted_ai_writes_the_prompt, docs_img_map_painted_fidelity_creativity_slider, docs_img_map_painted_comfyui, docs_img_map_painted_painted_versions [INFERRED 0.85]
- **Recovering when players leave the plan** — docs_img_story_getting_back_on_track, docs_img_story_bridge_back_with_ai, docs_img_tour_pool, docs_img_tour_ai_co_gm [INFERRED 0.75]
- **Map label lettering material textures (labelstyles.ts texture ids, embedded by labels.ts)** — packages_server_assets_labels_banner_banner_style_material, packages_server_assets_labels_blueprint_blueprint_style_material, packages_server_assets_labels_casefile_casefile_style_material, packages_server_assets_labels_grimoire_grimoire_style_material, packages_server_assets_labels_runestone_runestone_style_material, packages_server_assets_labels_ukiyo_ukiyo_style_material, packages_server_assets_labels_wasteland_wasteland_style_material, packages_server_assets_labels_western_western_style_material, packages_server_assets_labels_wushu_wushu_style_material [EXTRACTED 1.00]
- **Paper and cloth label materials** — packages_server_assets_labels_banner_banner_style_material, packages_server_assets_labels_ukiyo_ukiyo_style_material, packages_server_assets_labels_wushu_wushu_style_material, packages_server_assets_labels_casefile_casefile_style_material, packages_server_assets_labels_blueprint_blueprint_style_material [INFERRED 0.75]
- **Weathered hard-surface label materials (stone, metal, wood, leather)** — packages_server_assets_labels_runestone_runestone_style_material, packages_server_assets_labels_wasteland_wasteland_style_material, packages_server_assets_labels_western_western_style_material, packages_server_assets_labels_grimoire_grimoire_style_material [INFERRED 0.75]
- **Rusty Anchor battle map generation stages (quick, terrain pass, final pass)** — packages_server_assets_tutorial_rusty_anchor_quick_quick_battle_map, packages_server_assets_tutorial_rusty_anchor_terrain_a_terrain_pass_a, packages_server_assets_tutorial_rusty_anchor_terrain_b_terrain_pass_b, packages_server_assets_tutorial_rusty_anchor_final_a_final_pass_a, packages_server_assets_tutorial_rusty_anchor_final_b_final_pass_b [EXTRACTED 1.00]
- **Practice campaign NPC portraits** — packages_server_assets_tutorial_orla_harbour_master_orla, packages_server_assets_tutorial_brenn_brenn_barkeep, packages_server_assets_tutorial_tamm_fisherman_tamm [INFERRED 0.85]
- **Black penny / bell-crest smuggling clue trail** — packages_server_assets_tutorial_ledger_shipping_ledger, packages_server_assets_tutorial_penny_black_penny, packages_server_assets_tutorial_cove_smugglers_cove [INFERRED 0.75]

## Communities (113 total, 15 thin omitted)

### Community 0 - "Battle Map Editor UI"
Cohesion: 0.02
Nodes (89): allKinds, autoWalls, battle, battleTools, brush, busy, canRedo, canUndo (+81 more)

### Community 1 - "Map Painting Concepts"
Cohesion: 0.05
Nodes (22): Fidelity, PaintAi, PaintEstimate, placeFacts(), readTerrain(), REGION_TERRAIN_DENOISE, regionTerrainDenoise(), RegionTerrainOpts (+14 more)

### Community 2 - "Map Data & Lettering"
Cohesion: 0.07
Nodes (54): terrainDenoise(), walls(), isLabelStyle(), LabelCtx, bbox(), letterBase(), LetterGeo, lettersSvg() (+46 more)

### Community 3 - "Node Menu & Frames"
Cohesion: 0.06
Nodes (44): ondelete(), custom, { frame }, inside, remove(), rename(), same(), setColor() (+36 more)

### Community 4 - "Campaigns & Config"
Cohesion: 0.07
Nodes (38): CampaignInfo, CampaignList, describeCampaign(), forgetCampaign(), listCampaigns(), looksLikeCampaign(), rememberCampaign(), listCommands() (+30 more)

### Community 5 - "Edge & Node Kinds"
Cohesion: 0.05
Nodes (39): EDGE_KIND_INFO, EDGE_KINDS, EdgeKind, FRAME_PALETTE, NODE_TYPES, color, { data }, info (+31 more)

### Community 6 - "Web App State"
Cohesion: 0.08
Nodes (37): Placement, StoryEdge, onPaneDblClick(), onDbl(), applyBatch(), applyEvent(), camera(), cameraTo() (+29 more)

### Community 7 - "Backups"
Cohesion: 0.07
Nodes (26): Backups, run(), stamp(), BackupSettings, SnapshotInfo, api(), apply(), busy (+18 more)

### Community 8 - "MCP Commands & Characters"
Cohesion: 0.05
Nodes (20): BINDER_SECTIONS, MAX_COPIES, commands, edgeKindEnum, FIDELITY, FRAME_COLORS, imageKindEnum, LABEL_STYLE_IDS (+12 more)

### Community 9 - "Imports & Command Tests"
Cohesion: 0.11
Nodes (22): runCommand(), decodeXml(), extractText(), ImportInfo, run(), run(), scene(), twoActs() (+14 more)

### Community 10 - "Campaign Menu & Sound"
Cohesion: 0.06
Nodes (41): branch(), branchName, busy, confirmDel, create(), deleteIt(), filter, folder (+33 more)

### Community 11 - "Comfy Paint Runs"
Cohesion: 0.11
Nodes (26): ComfyError, RunCtx, consolidate(), groupPromptRequest(), parseGroupPrompts(), parseRegionPrompts(), propsRunner(), regionGroupRequest() (+18 more)

### Community 12 - "Node Inspector"
Cohesion: 0.05
Nodes (35): NODE_STATUSES, NodeStatus, entryLine(), addField(), BACKDROP_TYPES, clock, customFields, diffs (+27 more)

### Community 13 - "Canvas Edges & Frames"
Cohesion: 0.06
Nodes (31): flow, commit(), { data, selected }, draft, editing, f, input, resized() (+23 more)

### Community 14 - "AI Chat Panel"
Cohesion: 0.06
Nodes (34): AI_CREATIVITY, creativity, creativityDraft, drag(), eff, innerW, nudge(), queue (+26 more)

### Community 15 - "Node Cards & Party Strip"
Cohesion: 0.06
Nodes (31): big, clock, cover, fx, gmNotes, hasMap, here, hereColor (+23 more)

### Community 16 - "Region Groups & Lines"
Cohesion: 0.10
Nodes (36): regionGroupInfos(), area(), describeRegionGroups(), distToSegment(), groupRegion(), Kinds, pointInShape(), REGION_MASK (+28 more)

### Community 17 - "Edge Routing"
Cohesion: 0.10
Nodes (23): edge(), bezierPoints(), blocked(), DIRS, halfBezier(), Heap, inlineBezier(), inside() (+15 more)

### Community 18 - "Tour Steps"
Cohesion: 0.07
Nodes (22): dragstart(), selectNode(), card(), pick(), TourStep, typeInto(), ai, aiChapters (+14 more)

### Community 19 - "Character Sheets"
Cohesion: 0.06
Nodes (27): applyPreset(), check, groups, local, missing, { node }, preset, presetId (+19 more)

### Community 20 - "Map Experiments & Party Tests"
Cohesion: 0.08
Nodes (25): comfy, denoises, fd, m, png, up, { w, h }, PARTY_PROFILE (+17 more)

### Community 21 - "Command Store & PDF"
Cohesion: 0.11
Nodes (22): renderPdf(), canvasById(), checkCanvas(), Command, describe(), freeSpot(), gmPrompts(), link() (+14 more)

### Community 22 - "Campaign Store"
Cohesion: 0.11
Nodes (11): CustomJob, autoSnapshot(), openCampaign(), stopWatching(), Store, UndoEntry, runOnce(), Actor (+3 more)

### Community 23 - "Tour Menu"
Cohesion: 0.13
Nodes (30): keys, open, pct, practice, savedChapter, savedIdx, toggle(), remember() (+22 more)

### Community 24 - "README Screenshots: Canvas & AI"
Cohesion: 0.08
Nodes (31): AI Canvas Demo Animation, Scripted AI Session (npm run ai-demo), Battle Map Before/After Comparison, Battle Map Two-Step Painting Animation, GM Binder PDF, Connection Page References, WeasyPrint, Backups & Sync (+23 more)

### Community 25 - "Server Chat Service"
Cohesion: 0.13
Nodes (17): Chat, ChatDeps, ChatFile, creativityBlock(), knowledgeBlock(), listModels(), Models, shortTool() (+9 more)

### Community 26 - "Story Panel & Player Wiki"
Cohesion: 0.06
Nodes (26): askAi(), fillWithAi(), askDigest(), turnIntoNodes(), askAi(), bridge(), campaign, canSend (+18 more)

### Community 27 - "Tray App (Python)"
Cohesion: 0.09
Nodes (7): ctl(), describe(), main(), make_icon(), mode_of(), status(), Tray

### Community 28 - "Persistence & Legacy"
Cohesion: 0.12
Nodes (12): createCampaign(), replacePortals(), emptyGraph(), isLegacyPortal(), parseNode(), Persistence, serializeNode(), watchCampaign() (+4 more)

### Community 29 - "ComfyUI Jobs & Styles"
Cohesion: 0.11
Nodes (24): ComfyOptions, GenerateJob, Workflow, BatchListener, deriveEvents(), DIFF_FIELDS, diffNode(), Op (+16 more)

### Community 30 - "Command Palette & Review"
Cohesion: 0.08
Nodes (24): open(), who, Action, actionMode, actions, acts, at, campaign (+16 more)

### Community 31 - "Rulebook Library UI"
Cohesion: 0.08
Nodes (29): Book, busy, digest, Hit, hits, Imp, importNotes(), importPath() (+21 more)

### Community 32 - "World Editor"
Cohesion: 0.08
Nodes (29): aiOutline, askSummary(), bullet(), close(), dirty, edit(), failed, Heading (+21 more)

### Community 33 - "GM Binder"
Cohesion: 0.13
Nodes (27): binderHtml(), BinderOptions, binderParts(), BinderSection, copiesOf(), esc(), FLOW_EDGE_KINDS, mdToHtml() (+19 more)

### Community 34 - "Image Service"
Cohesion: 0.14
Nodes (12): imageExt(), ImageRequest, ImageService, ImageServiceOptions, Meta, Workflow, Runner, IMAGE_KINDS (+4 more)

### Community 35 - "Canvas & Routing"
Cohesion: 0.08
Nodes (23): EdgeRoute, Box, create(), edges, edgeTypes, newTitle, newType, nodes (+15 more)

### Community 36 - "Tour Overlay"
Cohesion: 0.09
Nodes (28): bigWindow, Box, boxOf(), cardH, cardW, cells, chapter, hits() (+20 more)

### Community 37 - "Rulebook Store"
Cohesion: 0.11
Nodes (5): BookSet, count(), FileBooks, lc(), tokens()

### Community 38 - "VTT Bundle Builder"
Cohesion: 0.12
Nodes (20): buildBundle(), characterFromNode(), handoutFromNode(), imageDimensions(), KINETIK_TIERS, kinetikHash(), kinetikNpc(), kinetikSession() (+12 more)

### Community 39 - "Story Analysis"
Cohesion: 0.13
Nodes (28): Adj, adjacency(), alive(), clockOf(), ClockState, FLOW_EDGES, fragmentName(), FrontierNode (+20 more)

### Community 40 - "README Screenshots: Maps & Story"
Cohesion: 0.09
Nodes (25): AI Writes the Prompt, Battle Map Editor (Plan / Model Input / Painted), ComfyUI, Map Tools: Select, Room, Paint, Erase, Door, Wall, Prop, Label, Token, Painted Battle Map (Weinkeller des Rostigen Ankers), Painted Versions Gallery, Snowy Mountain Pass: Plan vs One Pass vs Stepwise, Mountain Pass Stepwise Painting Animation (+17 more)

### Community 41 - "Web Package Deps"
Cohesion: 0.07
Nodes (25): dependencies, @pnp/shared, @xyflow/svelte, devDependencies, svelte, svelte-check, @sveltejs/vite-plugin-svelte, @tsconfig/svelte (+17 more)

### Community 42 - "LAN Mode"
Cohesion: 0.14
Nodes (18): asActor(), handleLogin(), listener, originOk(), server, COOKIE, cookieOf(), isLoopback() (+10 more)

### Community 43 - "Tour Kit"
Cohesion: 0.15
Nodes (21): flow(), redo(), calm(), camera(), click(), el(), fit(), flowTargets() (+13 more)

### Community 44 - "Tutorial Asset Generation"
Cohesion: 0.11
Nodes (17): dir, images, PROPS, run(), SEED, store, what, ASSET_DIR (+9 more)

### Community 45 - "Settings Modal"
Cohesion: 0.09
Nodes (20): alive, before, bridge, comfy, exporting, genBusy, genErr, lan (+12 more)

### Community 46 - "Archive Import"
Cohesion: 0.11
Nodes (13): CONTENT, importArchive(), Imports, Book, collectKids(), gist(), outlineOf(), parseBook() (+5 more)

### Community 47 - "Sound Cues"
Cohesion: 0.10
Nodes (16): one(), SoundCue, soundsOf(), add(), busy, byId, canPlay, connected (+8 more)

### Community 48 - "Map Groups & Consolidate"
Cohesion: 0.12
Nodes (20): CONSOLIDATE_DENOISE, consolidatePrompt(), FLOORS, area(), Crop, DISCRETE_PROPS, Extent, extentOf() (+12 more)

### Community 49 - "Mock VTT & Profiles"
Cohesion: 0.16
Nodes (13): connectMockVtt(), D20_LIKE_PROFILE, ELDARAHQ_PROFILE, HEROHQ_PROFILE, KINETIK_LIKE_PROFILE, move, STRUCTURE_ONLY_PROFILE, addImage() (+5 more)

### Community 50 - "Tutorial Content Seed"
Cohesion: 0.25
Nodes (18): ACT2_CANVAS, PARTY, SEED_EDGES, SEED_NODES, act2(), anchor(), anchorFree(), anchorLink() (+10 more)

### Community 51 - "Comfy Client"
Cohesion: 0.15
Nodes (3): Comfy, FakeComfy, FakeComfy

### Community 52 - "AI Demo & MCP Smoke"
Cohesion: 0.12
Nodes (13): cfgPath, client, pause, token, cfgPath, client, seen, token (+5 more)

### Community 53 - "Region Kinds"
Cohesion: 0.15
Nodes (14): terrainPasses(), BUILT_IN, colorWord(), colorWords(), isLineKind(), lineGroupOf(), NAMED, REGION_KINDS (+6 more)

### Community 54 - "Fake AI Demo Seed"
Cohesion: 0.17
Nodes (9): seedDemo(), assetPath(), hasAsset(), installPicture(), readAsset(), mapsProps(), mapsTerrain(), sha() (+1 more)

### Community 55 - "Tutorial Script"
Cohesion: 0.22
Nodes (15): Beat, beatsFor(), brenn(), bridge(), DemoCtx, exists(), FALLBACK, fillTable() (+7 more)

### Community 56 - "Label Styles"
Cohesion: 0.14
Nodes (15): AVG, Deco, DEFAULT_LABEL_STYLE, escapeXml(), f(), Kind, LABEL_STYLES, LABEL_TEXTURES (+7 more)

### Community 57 - "Images Panel"
Cohesion: 0.13
Nodes (16): addCanvas(), busy, defaultKind, defaultPrompt, generate(), jobs, justQueued, keepPrompt() (+8 more)

### Community 58 - "Binder Modal"
Cohesion: 0.12
Nodes (16): busy, clamp(), copies, images, make(), mode, nHandouts, nMaps (+8 more)

### Community 59 - "Map Editor Selection"
Cohesion: 0.22
Nodes (18): cellOf(), deleteSel(), duplicateSel(), duplicateShape(), edit(), fillSel(), finishPending(), nameAt() (+10 more)

### Community 60 - "Install Docs"
Cohesion: 0.15
Nodes (15): Installing PenNodePaper guide, agy (Antigravity CLI), Claude Code, scripts/install.sh installer, Optional tools (WeasyPrint, ImageMagick, poppler, git), Windows via WSL2, Web UI entry page (index.html), /src/main.ts module entry (+7 more)

### Community 61 - "Search"
Cohesion: 0.19
Nodes (11): SeedNode, NodeType, fieldText(), norm(), ParsedQuery, parseQuery(), SearchHit, searchNodes() (+3 more)

### Community 62 - "Root Package"
Cohesion: 0.12
Nodes (15): description, devDependencies, concurrently, name, private, scripts, build, check (+7 more)

### Community 63 - "Label Rendering"
Cohesion: 0.21
Nodes (13): fontFile(), HERE, installLabelContext(), LABEL_ASSET_DIR, labelFontFiles(), measure(), mimeOf(), printableCount() (+5 more)

### Community 64 - "Lettering Tests"
Cohesion: 0.14
Nodes (4): FONT_DIR, ctx, geo(), @resvg/resvg-js

### Community 65 - "Tutorial Campaign Setup"
Cohesion: 0.14
Nodes (8): createTutorialCampaign(), ensureTutorial(), RECIPE_NAMES, scriptFor(), bridgePrompt(), DemoScript, pickDemoScript(), TOUR_MESSAGES

### Community 66 - "VTT Hub"
Cohesion: 0.23
Nodes (5): VttHub, BridgeToVtt, UpfCharacter, VttProfile, VttStatus

### Community 67 - "VTT Bridge Spec"
Cohesion: 0.19
Nodes (15): PenNodePaper VTT bridge spec (protocol v1), characterTokens (tokens tied to characters), eldarahq.vtt-profile.json, herohq.vtt-profile.json, Offline file export (UPF bundle, KINETIK session file), pnp-bridge-client.js drop-in client, character push, music_cue push (+7 more)

### Community 68 - "Font Licenses"
Cohesion: 0.23
Nodes (15): OFL license: Caveat, OFL license: Cherish, OFL license: Cinzel Decorative, OFL license: IM Fell English, OFL license: Pirata One, OFL license: Share Tech Mono, OFL license: Stardos Stencil, OFL license: Uncial Antiqua (+7 more)

### Community 69 - "Server Package"
Cohesion: 0.13
Nodes (14): @pnp/shared, typescript, name, private, type, version, chokidar, hono (+6 more)

### Community 70 - "Map Editor Undo & Prompt"
Cohesion: 0.18
Nodes (15): ensureKind(), fit(), promptInput(), pushUndo(), redo(), removeVertex(), rename(), reorderShape() (+7 more)

### Community 71 - "Party Sync"
Cohesion: 0.19
Nodes (9): EXT, partyDigest(), partyNodeId(), same(), savePortrait(), syncParty(), roleFor(), pickRole() (+1 more)

### Community 72 - "Maps Service"
Cohesion: 0.29
Nodes (4): Maps, MapDoc, migratePins(), pinToEllipse()

### Community 73 - "Shared VTT Types"
Cohesion: 0.17
Nodes (11): UpfBundle, BRIDGE_PROTOCOL, BridgeFromVtt, CharacterPreset, CharacterRole, FieldSpec, FieldType, UpfHandout (+3 more)

### Community 74 - "Label Width Estimation"
Cohesion: 0.21
Nodes (8): estimateWidth(), FONT_FAMILY(), LABEL_FONTS, initLabels(), labelState, measure(), textures, widths

### Community 75 - "Pool & Flyers"
Cohesion: 0.15
Nodes (9): NODE_TYPE_INFO, group, items, pending, q, showTrash, total, trash (+1 more)

### Community 76 - "Web TS Config"
Cohesion: 0.15
Nodes (12): compilerOptions, module, moduleResolution, noEmit, skipLibCheck, strict, target, types (+4 more)

### Community 77 - "Launcher Script"
Cohesion: 0.36
Nodes (10): cmd_lan_info(), cmd_start(), cmd_stop(), is_up(), listener_pid(), needs_build(), say(), pennodepaper.sh script (+2 more)

### Community 78 - "Server TS Config"
Cohesion: 0.17
Nodes (11): compilerOptions, esModuleInterop, module, moduleResolution, noEmit, resolveJsonModule, skipLibCheck, strict (+3 more)

### Community 79 - "Map Editor Hit Testing"
Cohesion: 0.24
Nodes (12): edgeOf(), hitItem(), hitLabel(), hitShape(), inArea(), inGrid(), local(), onpointerdown() (+4 more)

### Community 80 - "Player Wiki"
Cohesion: 0.22
Nodes (9): DEFAULT_GROUP, FLOW_TYPES, PEOPLE, playerKnows(), playerText(), playerWiki, SKIP, WikiEntry (+1 more)

### Community 81 - "README Architecture"
Cohesion: 0.18
Nodes (10): Animation director (lib/app.svelte.ts), Backups, snapshots, branching campaigns, Campaign folder layout (plain files), Connection kinds (leads to, if, reveals, belongs to, foreshadows, bridge), GM binder PDF (WeasyPrint), LAN mode with access code, Infinite node canvas, PenNodePaper (+2 more)

### Community 82 - "Server Dependencies"
Cohesion: 0.20
Nodes (10): dependencies, chokidar, hono, @hono/node-server, @modelcontextprotocol/sdk, @pnp/shared, @resvg/resvg-js, ws (+2 more)

### Community 83 - "Installer Script"
Cohesion: 0.44
Nodes (9): ask(), bad(), have(), head_(), ok(), pkg_for(), install.sh script, tool() (+1 more)

### Community 85 - "Shared Package"
Cohesion: 0.25
Nodes (7): exports, main, name, private, type, types, version

### Community 86 - "Sheet Fields"
Cohesion: 0.43
Nodes (7): coerce(), fieldVisible(), optValue(), SheetCheck, sheetToText(), show(), validateSheet()

### Community 87 - "Map Editor Paint Actions"
Cohesion: 0.32
Nodes (8): aiArgs(), close(), loadPaint(), paintProps(), printOnPicture(), renderNow(), repaintGroup(), save()

### Community 88 - "NPM Scripts"
Cohesion: 0.29
Nodes (7): scripts, ai-demo, check, dev, smoke, start, test

### Community 89 - "Thumbnails"
Cohesion: 0.48
Nodes (6): findMagick(), pending, run(), snapWidth(), THUMB_WIDTHS, thumbnail()

### Community 90 - "agy Chat Tests"
Cohesion: 0.43
Nodes (6): fakeAgy(), finals(), line(), messages, step(), system()

### Community 91 - "ComfyUI Setup Docs"
Cohesion: 0.33
Nodes (5): ComfyUI setup for pictures and painted maps, Battle maps (grid floor plan, derived walls), Images via ComfyUI (Krea 2), Characters on the map (tokens tied to NPC/enemy nodes), Region maps (terrain areas, lines, structures)

### Community 92 - "Bridge Roles & Handshake"
Cohesion: 0.40
Nodes (5): Character roles & FieldSpec, hello/welcome handshake over WebSocket /bridge, mock-vtt.ts reference VTT, Role presets with ranges, VTT capability profile (hello handshake)

### Community 93 - "Party & Handout Push"
Cohesion: 0.33
Nodes (6): Party sync (provides.party, pc role), handout push, Requests (tracks, party), Spoiler-safe player wiki, Random tables, Running the session (party split, story tab, railguard)

### Community 94 - "Server Dev Deps"
Cohesion: 0.33
Nodes (6): devDependencies, tsx, @types/node, @types/ws, typescript, vitest

### Community 95 - "Tutorial Scene Art"
Cohesion: 0.40
Nodes (5): Arrival scene: fog-bound harbour town with clock tower, Scene: smugglers' cove at night, Greywater Coast region map (coast, lighthouse, villages, rivers), Portrait: Harbour Master Orla, Portrait: old fisherman Tamm

### Community 96 - "Rusty Anchor Map Art"
Cohesion: 0.50
Nodes (5): Portrait: Brenn the barkeep, Rusty Anchor battle map final pass A (furnished: tables, hearth, barrels, crates), Rusty Anchor battle map (quick single pass), Scene: Rusty Anchor dockside tavern, Rusty Anchor battle map terrain pass A (empty floors and walls)

### Community 98 - "Blue Label Materials"
Cohesion: 0.67
Nodes (3): Banner Style Material (royal blue woven wool cloth texture; high fantasy kingdoms/orders, gold Cinzel Decorative lettering), Blueprint Style Material (mottled cyan-blue blueprint paper with faint fold lines; sci-fi, heists, ship/building plans), Ukiyo-e Style Material (indigo shibori-dyed washi paper with pale flower resist patterns; feudal Japan, woodblock prints)

### Community 100 - "Map Editor Custom Kinds"
Cohesion: 0.67
Nodes (3): kindOf(), pickKind(), saveCustom()

## Ambiguous Edges - Review These
- `Portrait: old fisherman Tamm` → `Scene: smugglers' cove at night`  [AMBIGUOUS]
  packages/server/assets/tutorial/tamm.jpg · relation: conceptually_related_to

## Knowledge Gaps
- **61 isolated node(s):** `concurrently`, `@pnp/shared`, `@types/node`, `@types/ws`, `tsx` (+56 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1035 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Store` connect `Campaign Store` to `Map Painting Concepts`, `Campaigns & Config`, `Backups`, `MCP Commands & Characters`, `Imports & Command Tests`, `Comfy Paint Runs`, `Map Experiments & Party Tests`, `Server Chat Service`, `Persistence & Legacy`, `ComfyUI Jobs & Styles`, `GM Binder`, `Image Service`, `Rulebook Store`, `VTT Bundle Builder`, `Tutorial Asset Generation`, `Archive Import`, `Mock VTT & Profiles`, `Tutorial Content Seed`, `AI Demo & MCP Smoke`, `Fake AI Demo Seed`, `Tutorial Script`, `Lettering Tests`, `Tutorial Campaign Setup`, `VTT Hub`, `Party Sync`, `Maps Service`, `agy Chat Tests`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Are the 12 inferred relationships involving `run()` (e.g. with `.newNodeId()` and `.node()`) actually correct?**
  _`run()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **What connects `concurrently`, `@pnp/shared`, `@types/node` to the rest of the system?**
  _61 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Battle Map Editor UI` be split into smaller, more focused modules?**
  _Cohesion score 0.017699115044247787 - nodes in this community are weakly interconnected._
- **Why does `svelte` connect `Canvas Edges & Frames` to `Battle Map Editor UI`, `World Editor`, `Canvas & Routing`, `Tour Overlay`, `Web App State`, `Backups`, `Web Package Deps`, `Settings Modal`, `AI Chat Panel`, `Character Sheets`, `Tour Menu`, `Binder Modal`, `Command Palette & Review`, `Rulebook Library UI`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Should `Map Painting Concepts` be split into smaller, more focused modules?**
  _Cohesion score 0.04547858276044421 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Portrait: old fisherman Tamm` and `Scene: smugglers' cove at night`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._