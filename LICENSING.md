# Licensing

PenNodePaper is free software. Different parts carry different licences so that the shared building
blocks can be reused by other tools (such as [SagaCraft](https://github.com/Rec0iL/SagaCraft)) without
restriction, while the application itself stays copyleft.

| Part | Path | Licence |
|---|---|---|
| The application (web UI) and the server (MCP, ComfyUI, bridge server, binder, campaigns, tutorial engine runtime) | `packages/web/`, `packages/server/`, `scripts/` | [AGPL-3.0-or-later](LICENSE) |
| Shared library: data model, sheet field model, bridge protocol types, map data, tutorial definitions, search, routing | `packages/shared/` | [MIT](packages/shared/LICENSE) |
| Specifications: the VTT bridge protocol and the Universal Push Format | `docs/vtt-bridge-spec.md`, `docs/pnp-bridge-client.js`, `docs/profiles/` | MIT (same text as `packages/shared/LICENSE`) |
| Fonts | `packages/server/assets/fonts/` | SIL Open Font License (see the README there) |
| Pictures in `docs/img/` and the practice campaign *Greywater* (its text, maps and images) | `docs/img/`, the seeded demo campaign | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) — attribution: PenNodePaper, Alexander Freidzon (Rec0iL), link to this repository |

Contributions are accepted under the licence of the files they touch. There is no CLA; contributors
keep their copyright.

If you build a VTT that speaks the bridge protocol, you may implement it under any licence: the spec and
the example client are MIT.
