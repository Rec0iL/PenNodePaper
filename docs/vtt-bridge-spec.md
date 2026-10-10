# PenNodePaper VTT bridge — spec for VTT authors (protocol v1)

PenNodePaper pushes prepared content (handouts, battle maps, NPCs, music cues) into a tabletop app. To support it, a VTT only has to:

1. open one WebSocket from its GM page,
2. announce what it can receive (a **profile**),
3. handle `push` / `request` messages and answer each with a `result`.

All content uses one fixed format, the **Universal Push Format (UPF)**. PenNodePaper never needs per-VTT mapping rules — the VTT adapts UPF to its own model. **Start here (vanilla JS VTT):** [`pnp-bridge-client.js`](pnp-bridge-client.js) is a one-file, dependency-free client that handles the connection, `hello`, reconnects and replies — you only write two handlers. Real-world profiles of the two *How to be a Hero* VTTs, generated from the code they ship (their `pnpbridge.js`): [`profiles/herohq.vtt-profile.json`](profiles/herohq.vtt-profile.json) (handouts, NPC list, music, party) and [`profiles/eldarahq.vtt-profile.json`](profiles/eldarahq.vtt-profile.json) (the same plus maps and a combat tracker). Reference implementation of a full VTT side: [`packages/server/scripts/mock-vtt.ts`](../packages/server/scripts/mock-vtt.ts). Types: [`packages/shared/src/vtt.ts`](../packages/shared/src/vtt.ts).

**Every part is optional.** A VTT lists only what it supports. In particular it can *describe* its character sheets without being able to *receive* characters yet (see [Characters](#characters-any-game-system)) — that alone lets the AI write characters for the GM in your game's terms.

## Connecting

```
ws://127.0.0.1:4317/bridge?token=<pairing token>
```

* The GM copies the **bridge address** and **pairing token** from PenNodePaper → ⚙ Settings → *VTT link* into the VTT's settings.
* No `Origin` restriction (your VTT may be served from another origin, e.g. GitHub Pages — browsers allow `ws://127.0.0.1` from HTTPS pages); the secret token is the authentication. A wrong token gets HTTP 401.
* One VTT at a time; a newer connection replaces the older one.
* Frames are JSON text. Messages may be large (images are inline base64; up to 64 MB per message).
* Reconnect with back-off if the connection drops. PenNodePaper caches your last profile, so the GM can still export files offline.

## Handshake

VTT → PenNodePaper, immediately after the socket opens:

```jsonc
{ "t": "hello", "protocol": 1, "profile": {
    "id": "kinetik-vtt",            // stable id
    "name": "KINETIK VTT", "version": "1.4.0", "protocol": 1,
    "push": {                        // what you can RECEIVE — list only what you support
      "handout":   { "text": true, "image": true, "toPlayer": true },
      "scene":     { "grids": ["square"], "tokens": true, "characterTokens": true },   // characterTokens: a token can BE a pushed character
      "character": {},               // you can receive pushed characters
      "music_cue": { "tracks": true, "mood": true }
    },
    "characters": { "roles": [ /* how characters are structured in your game — see below */ ] },
    "provides": { "party": true },      // optional: you can report the players' characters (see Party)
    "requests": ["tracks", "party"],
    "images": { "maxBytes": 8000000, "formats": ["png", "jpg", "webp"] },
    "file": { "kind": "kinetik-session", "version": 1 }   // optional: offline import format
} }
```

PenNodePaper → VTT: `{ "t": "welcome", "protocol": 1, "app": "pennodepaper", "campaign": "<name>" }`.
If `protocol` differs from what the app speaks, the socket is closed with code 1008.

The AI only does pushes your profile lists, and writes characters in **your** sheet structure.

## Pushes

PenNodePaper → VTT:

```jsonc
{ "t": "push", "id": "<uuid>", "kind": "handout" | "scene" | "npc" | "music_cue", "payload": { … } }
```

Reply to every push with `{ "t": "result", "id": "<same id>", "ok": true }` or `{ "t": "result", "id": "…", "ok": false, "error": "human readable reason" }` (the error text is shown to the GM and the AI). Answer within ~15 s.

`UpfImage` = `{ "name": "x.png", "mime": "image/png", "b64": "<base64 of the raw file bytes>" }`.

### `handout`
```jsonc
{ "id": "torn-page", "title": "Torn page", "kind": "image" | "text",
  "text": "Dates and a crest.",     // text handouts: the body; image handouts: optional caption
  "image": UpfImage,                // kind "image"
  "reveal": true,                   // show to the players right now; absent/false = only add to the GM's handout library
  "to": "<player id>" }             // show to just this player (implies reveal)
```
Only player-facing content is ever sent (read-aloud text / summary / a picture of the node — any node: NPC portrait, item, location) — never GM notes. Several pictures of one node arrive as separate handouts with ids `<node>:<image file>`. Re-pushing the same `id` replaces the earlier handout.

### `scene` (a battle or region map)
```jsonc
{ "id": "cellar", "name": "Wine cellar", "image": UpfImage, "width": 1344, "height": 864,
  "grid": { "type": "square" | "hex", "size": 61, "offsetX": 0, "offsetY": 0, "unitsPerCell": 6, "unit": "ft",
            "hidden": false },    // true = an illustration shown as a backdrop: do not draw the grid
  "tokens": [ { "x": 2, "y": 3, "kind": "pc" | "npc" | "enemy", "label": "P1",
                "character": "dockside-brute" } ],   // CELL coordinates, (0,0) = top-left cell; `character` is optional (see below)
  "activate": true }               // show to players now
```
`grid.size` is the cell edge in pixels **of `image`**. Token cell `(x,y)` → pixel centre `((x+0.5)·size + offsetX, (y+0.5)·size + offsetY)`. Re-pushing the same `id` should replace that scene. **Tokens that are characters:** a token with `character` stands for the character of that `id` (the same id as in the `character` push) — it is not just a marker. When your profile says `push.scene.characterTokens: true`, PenNodePaper pushes the **scene first, then the characters** that stand on it (their `scene` field names that scene), and you tie each token to the character entry you create or update for that `id`: the same HP and rolls for the token and the combat tracker entry, the portrait as the token picture, the character's token size. Several tokens may name the same `character` (a group of goons): give each its own token, let them share the entry or number them, whichever your game does. A character that arrives *before* its scene, or a re-pushed scene, must still end up tied. VTTs without `characterTokens` just see plain tokens with a label (the characters are pushed on their own, as before). A **backdrop** scene (an illustration of a place the GM wants to show before the battle map) arrives with `tokens: []` and `grid.hidden: true`; its `id` is `<node>:<image file>`.

### `character`
```jsonc
{ "id": "dockside-brute", "role": "enemy", "name": "Dockside Brute", "preset": "elite",
  "sheet": { "tier": "elite", "level": 5, "bonus": 5, "schutz": 1, "wk": 6,
             "moves": [ { "name": "Schulterwurf", "text": "Wirft jemanden um." } ] },
  "notes": "GM-facing free text (summary + notes of the node)",
  "portrait": UpfImage }            // a 256 px square crop; present if the role has portrait:true
```
`sheet` contains **only keys from the role's `fields`**, already validated (types, ranges, options, conditional fields), so you can map it straight onto your own model — for a vanilla-JS VTT whose character export uses the same keys, `Object.assign(blankCharacter(), sheet)` is enough. Re-pushing the same `id` should *update* the existing character (keep its live state such as current HP). Reply with an error string if a role is unknown.

### `music_cue`
```jsonc
{ "action": "play" | "stop", "trackId": "harbour-night", "mood": "tense" }
```

## Characters: any game system

Every game structures characters differently (KINETIK: tiers, level, bonus, protection, willpower, moves; How to be a Hero: attributes, percentage skills, weapons, status effects; a d20 game: ability scores, armour class, attacks…). So PenNodePaper does not know a character format: **the VTT describes its own** in `profile.characters.roles`, and PenNodePaper builds the sheet form, validates input and briefs the AI from that description.

A **role** is one kind of character the VTT works with (e.g. `enemy`, `npc`, `monster`, `nsc`). Each has:

```jsonc
{ "id": "enemy", "label": "Enemy", "description": "A combat opponent …",
  "for": ["enemy"],                 // which PenNodePaper node kinds it suits: "enemy", "npc" and/or "pc" (default: role id = node kind)
  "portrait": true,                 // accepts a portrait image
  "fields": [ FieldSpec, … ],
  "presets": [ { "id": "elite", "label": "Elite", "values": { … }, "ranges": { "level": [3, 5] }, "help": "…" } ] }
```

**`FieldSpec`** (all fields are keyed by `key` in `sheet`):

| property | meaning |
|---|---|
| `type` | `text`, `longtext`, `number`, `boolean`, `select`, `tags` (list of strings), `list` (repeating entries) |
| `label`, `help`, `group` | what the form shows; `group` becomes a section heading |
| `required`, `default` | `required` fields must be present to push; defaults are filled in |
| `min`, `max`, `step` | `number` bounds (violations are rejected) |
| `options` | `select`: `[{ "value": "goon", "label": "Goon" }]` |
| `suggestions` | `text`: known values offered as autocomplete (e.g. skill names from your rule package); not enforced |
| `item` | `list`: the `FieldSpec`s of every entry, e.g. a move = `name` + `text`; a plain string fills the first item field |
| `showIf` | `{ "key": "tier", "equals": "goon" }` or `{ "key": "tier", "notEquals": "goon" }` — field only exists while the condition holds (e.g. group size only for goons) |

**Presets** are starting points with the game's own defaults (a KINETIK tier, a monster archetype…). `ranges` are the usual bounds *for that preset*: values outside only produce a warning, never a rejection. The AI uses presets and ranges together with your rulebook to pick sensible numbers.

### Describing without receiving

`profile.characters` and `profile.push.character` are independent:

* `characters` present, no `push.character` → *"describes, can't receive yet"*: the sheet form and the AI work in your game's terms and the GM reads the result in PenNodePaper (copy as JSON or readable text, or export it). Pushing is refused with an explanation.
* both present → live pushes as above.

This is the easiest first step for any VTT: publish the structure now, add receiving later. See [`profiles/eldarahq.vtt-profile.json`](profiles/eldarahq.vtt-profile.json) for a complete real-world example (a lighter NPC/enemy role with a conditional combat field, and a read-only `pc` role with nested skill/weapon/status lists).

## Party (the players' characters)

A VTT that knows its players' characters can report them, so PenNodePaper can show them as the **party** (and let the GM split them across the story, and the AI write for them). Declare `"provides": { "party": true }`, put `"party"` in `requests`, and describe the structure as a role with `"for": ["pc"]` (id `pc`). The VTT owns these characters — PenNodePaper never pushes a `pc`.

* **Pull:** on connect (and when the GM presses *Sync*) PenNodePaper sends `{ "t": "request", "id": "…", "what": "party" }`; answer with `{ "t": "result", "id": "…", "ok": true, "data": [ UpfCharacter, … ] }`. No session running → `ok: false` with an error text.
* **Push on change:** send `{ "t": "party", "characters": [ UpfCharacter, … ] }` unsolicited whenever the party changes (debounce ~1 s). Always send the **whole** party: players missing from the list are marked absent, not deleted.
* Each `UpfCharacter` is `{ "id": "<stable player/character id>", "role": "pc", "name", "playerName": "Sam", "online": true, "sheet": { … }, "portrait": UpfImage }`; `sheet` uses the keys of your `pc` role (no validation errors block it — it is only read).

PenNodePaper stores them as nodes in the campaign folder, so they stay available when the VTT is offline and are updated on the next sync.

## Requests

PenNodePaper → VTT: `{ "t": "request", "id": "<uuid>", "what": "tracks" }` → reply with
`{ "t": "result", "id": "…", "ok": true, "data": [ { "id": "harbour-night", "title": "Harbour at night", "category": "ambient", "uploaded": false } ] }`.
List **everything the GM can play, including their own uploads** (`"uploaded": true`) so the AI cues real tracks.

## Offline file export

Without a live link the GM can export from ⚙ Settings → *VTT link*:

* **Universal bundle (UPF)** — one JSON file `{ upf: 1, handouts: UpfHandout[], scenes: UpfScene[], characters: UpfCharacter[] }`; import it however you like. Backdrop scenes carry `grid.hidden: true`; an NPC's `scene` field names the scene (the map of the place it belongs to) it should stand on.
* **KINETIK session file** — a ready-made *new* KINETIK VTT session (`{ kinetik: "session", … }`): scenes (grid + tokens set; place pictures as backdrop scenes with the grid hidden), handouts, enemies as combat NPCs (portrait included) and NPCs as map tokens with portrait and note. Add another converter by naming it in your profile's `file.kind`.

## Checklist for implementers

- [ ] Connect, send `hello`, reconnect with back-off
- [ ] Answer every `push` / `request` with a `result` (ok or a clear error)
- [ ] Hash/store images however you like — they arrive as raw bytes in base64
- [ ] (optional, easiest first step) publish `characters.roles` so the AI can write sheets for your game
- [ ] (optional) report the players' characters: `provides.party`, a `pc` role, answer `request party`, push `party` on changes
- [ ] Honour `scene.grid` (size in image pixels, offset, units) and place `tokens` by cell
- [ ] (optional) `characterTokens`: tie tokens that carry `character` to the pushed character of that id
- [ ] Test against the mock: `npx tsx packages/server/scripts/mock-vtt.ts` shows what a conforming VTT does; `npm test` runs the bridge conformance tests
