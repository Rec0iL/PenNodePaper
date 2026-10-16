# 📖 Installing PenNodePaper

This guide takes you from nothing to a running PenNodePaper on **Linux**, **macOS** and **Windows**, and then walks through every **optional** piece that unlocks an extra feature: the AI assistants, ComfyUI image generation, the GM binder PDF, importing notes, and the VTT link.

> **Good to know:** the core app only needs **Node.js**. Everything else is optional, and each optional tool unlocks exactly one feature. You can start with the core and add tools later; nothing needs to be reinstalled.
>
> **Tested on:** Linux (Fedora-based) and **Windows 10/11, running natively** (no WSL needed — see [Windows](#-windows)). macOS uses the same commands as Linux, through Homebrew.

**Contents**
[What you need](#-what-you-need) · [Quick start](#-quick-start) · [Linux](#-linux) · [macOS](#-macos) · [Windows](#-windows) · [AI assistants](#-ai-assistants-claude-and-agy) · [ComfyUI](#-comfyui-pictures-and-painted-maps) · [Other optional tools](#-other-optional-tools) · [Connect a VTT](#-connect-a-vtt) · [Configuration](#-configuration) · [Updating](#-updating) · [Troubleshooting](#-troubleshooting)

---

## 🧰 What you need

| Feature | What it needs | Required? |
|---|---|:---:|
| The app itself (canvas, pool, inspector, maps, library, binder-less use, backups, VTT file export) | **Node.js 20+** and **npm** | ✅ |
| 🤖 AI chat and MCP tools | the **`claude`** CLI (Claude Code) and/or the **`agy`** CLI (Antigravity), logged in | optional |
| 🎨 Generated pictures and painted maps | a local **ComfyUI** with an image model | optional |
| 📘 GM binder (printable PDF) | **WeasyPrint** (`weasyprint` on your PATH) | optional |
| 🖼️ Fast image thumbnails | **ImageMagick** (`magick` or `convert`) | optional (speed only) |
| 📥 Import notes from `.docx` / `.pdf` | **`unzip`** or `tar` (docx; Windows and macOS have `tar`) and **`pdftotext`** from poppler (pdf) | optional |
| 🛟 Backups (snapshots, archives) | **`tar`** | usually already there |
| 🛟 Optional git history of a campaign | **`git`** | optional |
| 🔌 Live link to a tabletop app | a VTT with a PenNodePaper bridge ([supported VTTs](../README.md#supported-vtts)) | optional |

PenNodePaper runs entirely on your machine. The server only listens on `127.0.0.1`, and nothing is sent anywhere except to the AI service you choose when you chat.

---

## ⚡ Quick start

**1. Get the code** — download the ZIP from GitHub (green **Code** button → *Download ZIP*) and unpack it, **or** clone it:

```bash
git clone https://github.com/Rec0iL/PenNodePaper.git
```

**2. Go into the folder** — the one that contains `package.json`. All commands below must be run there; `npm install` anywhere else does nothing useful:

```bash
cd PenNodePaper          # or PenNodePaper-main if you downloaded the ZIP
```

**3. Install** — with the install script (checks Node 20+, runs `npm install`, builds the UI and offers the optional helper tools: WeasyPrint, ImageMagick, poppler, unzip, git; it never installs the AI assistants or ComfyUI):

```bash
./scripts/install.sh            # --check only reports · --yes answers yes · --only-tools skips Node/npm and only installs the helper tools
                                # works with apt, dnf, pacman, zypper, apk and Homebrew
```

or by hand, if you only want the core:

```bash
npm install
```

> **On Windows** there is no install script: do the `npm install` by hand and follow the [Windows](#-windows) section, which also has a Start menu entry with a tray icon (it builds and updates PenNodePaper for you).

**4. Start**

```bash
npm run dev
```

Then open **<http://localhost:5273>**. The first start creates a practice campaign in `campaigns/demo/` and opens the **welcome tour**, which needs nothing from this guide (its AI and pictures are stand-ins); everything below is for your own campaigns. You can reopen the tour from the **?** in the top bar.

> Use `localhost` rather than `127.0.0.1` for the development UI: Vite may listen on IPv6 only, and then `127.0.0.1` is refused.

For a single-port production-style run (the server serves the built UI):

```bash
npm run build
npm start          # open http://localhost:4317
```

Check that everything is healthy: `npm test` runs the test suite and `npm run check` type-checks the code.

---

## 🐧 Linux

### 1. Node.js 20 or newer

Pick one way. Check with `node -v` (it must print `v20` or higher).

* **Node version manager (works everywhere, no root):** install [nvm](https://github.com/nvm-sh/nvm), then
  ```bash
  nvm install --lts
  ```
* **Fedora:** `sudo dnf install nodejs npm git`
* **Debian / Ubuntu:** the distro `nodejs` is often too old. Use nvm (above) or [NodeSource](https://github.com/nodesource/distributions), then `sudo apt install git`.
* **Arch:** `sudo pacman -S nodejs npm git`

### 2. Get and start PenNodePaper

Follow the [Quick start](#-quick-start).

### 3. Optional tools in one go

| Distro | Command |
|---|---|
| **Debian / Ubuntu** | `sudo apt install imagemagick poppler-utils unzip git weasyprint` |
| **Fedora** | `sudo dnf install ImageMagick poppler-utils unzip git weasyprint` |
| **Arch** | `sudo pacman -S imagemagick poppler unzip git python-weasyprint` |

If your distro has no `weasyprint` package, install it with pip instead: `pip install --user weasyprint` (WeasyPrint also needs the Pango library; see the [WeasyPrint install page](https://doc.courtbouillon.org/weasyprint/stable/first_steps.html)). Make sure `~/.local/bin` is on your PATH.

Then continue with [AI assistants](#-ai-assistants-claude-and-agy) and [ComfyUI](#-comfyui-pictures-and-painted-maps).

---

## 🍎 macOS

### 1. Homebrew

If you don't have it yet, install [Homebrew](https://brew.sh).

### 2. Core

```bash
brew install node git
git clone https://github.com/Rec0iL/PenNodePaper.git
cd PenNodePaper
npm install
npm run dev          # open http://localhost:5273
```

### 3. Optional tools

```bash
brew install imagemagick poppler weasyprint
```

`tar` and `unzip` come with macOS. Then continue with [AI assistants](#-ai-assistants-claude-and-agy) and [ComfyUI](#-comfyui-pictures-and-painted-maps).

> Apple Silicon and Intel both work. ComfyUI runs on Apple Silicon too, but how fast depends on your Mac and the model you choose.

---

## 🪟 Windows

PenNodePaper runs **natively on Windows**: no WSL, no virtual machine. That also makes the connection to ComfyUI trivial: both run on the same Windows computer and talk over `localhost` (ComfyUI's default address `http://127.0.0.1:8188` just works).

### 1. Install Node.js and git, get the code

In PowerShell or the Command Prompt:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Close the terminal and open a **new** one (so the new programs are on the PATH), then:

```powershell
git clone https://github.com/Rec0iL/PenNodePaper.git
cd PenNodePaper
npm install
```

Without git you can download the ZIP from the GitHub page (**Code → Download ZIP**) and unpack it; the launcher's automatic updates (below) need the git clone, though.

**`npm` is blocked in PowerShell?** ("npm.ps1 cannot be loaded because running scripts is disabled on this system" / "Die Datei npm.ps1 kann nicht geladen werden …"). Windows does not run `.ps1` scripts by default, and `npm` starts through `npm.ps1`. Pick one:

* allow it once for your user (no administrator needed): `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, confirm with `Y` (`J` on a German Windows);
* or call the `.cmd` version: `npm.cmd install`, `npm.cmd run dev`;
* or use the classic **Command Prompt** (`cmd`) instead of PowerShell.

### 2. Start it

Either of these:

* **Start menu entry with a tray icon (recommended):** run `scripts\windows\Install-Launcher.cmd` once (double-click; it asks whether you also want a desktop shortcut). Afterwards type *PenNodePaper* in the Start menu: it builds the UI on the first start, runs the server in the background, opens the browser and puts a tray icon next to the clock — grey = stopped, green = running for this computer only, blue = open to your network. Left-click opens PenNodePaper; right-click starts / stops it, switches LAN mode and copies the address and access code for another device. *PenNodePaper (LAN mode)* and *Stop PenNodePaper* are separate Start menu entries. It only needs Node.js and works with the default PowerShell script policy. Without installing anything, `scripts\windows\PenNodePaper.cmd` does the same.
  **Updates:** whenever the launcher starts the server it checks for a new version and installs it by itself (`git pull --ff-only`, then `npm install` if needed and a rebuild); a balloon at the tray icon says so. It leaves your copy alone when you changed files in it, when you are offline, or when the server is already running. Set the environment variable `PNP_NO_UPDATE=1` to switch it off.
  Logs are in `%LOCALAPPDATA%\pennodepaper\`; `powershell -ExecutionPolicy Bypass -File scripts\windows\PenNodePaper.ps1 selftest` prints what the launcher finds (Node, npm, icon, server).
* **or from a terminal:** `npm run dev` and open **<http://localhost:5273>**.

### 3. Optional tools

**One script installs them:** double-click `scripts\windows\Install-Tools.cmd` (the launcher installer offers it at the end, too). It shows what is missing and asks once; then it installs **ImageMagick** (thumbnails), **poppler** (`pdftotext`, importing `.pdf` notes), **WeasyPrint** (the GM binder PDF) and, if they are missing, **git** and **Node.js** — through `winget`, except WeasyPrint, which is its standalone program from the [WeasyPrint releases](https://github.com/Kozea/WeasyPrint/releases) (kept in `%LOCALAPPDATA%\pennodepaper\tools` and added to your PATH). `Install-Tools.cmd -Check` only reports, `-Yes` doesn't ask. **Word (`.docx`) notes need no extra program**: Windows' own `tar` reads them. Afterwards stop PenNodePaper (tray icon → Stop) and start it again so that it sees the new programs.

By hand, each of these has to be **on your PATH** and found as a plain command: `claude`, `agy`, `codex`, `weasyprint`, `magick`, `pdftotext`, `tar`, `git`. Windows 10/11 already include `tar`.

* **AI programs** (see [AI assistants](#-ai-assistants-claude-and-agy)): Claude Code, Codex and agy installed with **npm** are found too, even though npm gives them a `.cmd` launcher. If the app still says one is *not installed*, check that `codex --version` (or `claude --version`) works in a **new** terminal window, then **restart PenNodePaper from that terminal** (or start it again from the Start menu): a program started before the PATH changed doesn't see the new PATH.
* **ComfyUI** on the same computer: nothing to configure, see [ComfyUI](#-comfyui-pictures-and-painted-maps).
* **ImageMagick** (thumbnails): `winget install ImageMagick.ImageMagick`.
* **`pdftotext`** (poppler, importing `.pdf` notes): `winget install oschwartz10612.Poppler`.
* **WeasyPrint** (GM binder PDF): unpack `weasyprint-windows-onedir.zip` from the [WeasyPrint releases](https://github.com/Kozea/WeasyPrint/releases) somewhere and put the folder with `weasyprint.exe` on your PATH.
* **A VTT** in your browser connects to `ws://127.0.0.1:4317/bridge` as usual.

The settings file lives in `C:\Users\<you>\.config\pennodepaper\`.

---

## 🤖 AI assistants: Claude and agy

PenNodePaper does not include an AI. It drives **command-line assistants you install and log in to yourself**, and gives them its own MCP server so they can read and edit your campaign. You need at least one for the chat; you can switch between them per conversation.

### Claude (Claude Code)

1. Install the CLI (pick one):
   * macOS / Linux: `curl -fsSL https://claude.ai/install.sh | bash`
   * Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`
   * or with npm: `npm install -g @anthropic-ai/claude-code`
2. Run `claude` once in a terminal and **log in** (a Claude subscription or an API account).
3. Check: `claude --version`.

That's all. PenNodePaper starts `claude -p` in the background for each chat message, hands it the campaign tools and allows only those tools.

### agy (Antigravity CLI)

1. Install the **Antigravity CLI** following its own documentation and log in.
2. Check: `agy --version`.
3. In PenNodePaper open the right panel → **AI**, pick **agy**, and click **Connect agy** once. This registers PenNodePaper's MCP server in agy's own configuration (`agy mcp add …`).

### Codex (OpenAI Codex CLI)

1. Install the **Codex CLI** following its own documentation (for example `npm install -g @openai/codex`).
2. Run `codex login` once in a terminal.
3. Check: `codex --version`.
4. In PenNodePaper open the right panel → **AI** and pick **Codex**. There is nothing to register: for every message the app starts `codex exec` and hands it the campaign tools for that run. Codex's own configuration is not touched, and its shell access stays read-only. The model is the one in your `~/.codex/config.toml`.

### Using your own client (Claude Code in a terminal, opencode, Cursor, etc.)

Any MCP client can attach to `http://127.0.0.1:4317/mcp` with the bearer token from `~/.config/pennodepaper/config.json`:

```bash
claude mcp add --transport http pennodepaper "http://127.0.0.1:4317/mcp" --header "Authorization: Bearer <token>"
```

The client is shown under the name it reports to the server (`opencode`, `cursor`, …) in the activity log and on the canvas. To choose the label yourself, add `?actor=<label>` to the URL.

No AI installed? Everything else still works: you build the story by hand, the welcome tour shows what an AI session looks like (with a scripted stand-in), and `npm run ai-demo -w @pnp/server` plays one against the demo campaign.

---

## 🎨 ComfyUI: pictures and painted maps

Portraits, scene pictures, handouts, banners and **painted battle maps** are made by **your own ComfyUI**. Nothing is generated in the cloud. Without ComfyUI the app works fine, you simply don't get the **Generate** buttons.

### 1. Install ComfyUI

Pick one:

* **ComfyUI Desktop** (Windows and macOS): the installer from [comfy.org](https://www.comfy.org/download), the easiest option.
* **comfy-cli** (Linux, macOS, Windows): 
  ```bash
  pip install comfy-cli
  comfy install
  comfy launch
  ```
* **Manual install:** follow the [ComfyUI README](https://github.com/comfyanonymous/ComfyUI) (needs Python and a recent PyTorch for your GPU).

A graphics card with plenty of VRAM makes this practical (the author uses a 16 GB card and starts ComfyUI with `--reserve-vram 3`). It works on NVIDIA, AMD and Apple Silicon wherever ComfyUI itself works.

ComfyUI should answer at **<http://127.0.0.1:8188>** (the default). PenNodePaper talks to it over its normal HTTP/WebSocket API.

### 2. Get an image model

PenNodePaper builds a simple, standard ComfyUI graph: **diffusion model (UNET) + one text encoder (CLIP) + VAE → KSampler → image**. The settings are pre-filled for **Krea 2 (Turbo)**, which is what it was developed and tested with:

| Setting | Default |
|---|---|
| UNET / diffusion model | `krea2TurboOfficialComfy_krea2TurboInt8.safetensors` |
| CLIP / text encoder | `qwen3vl_4b_fp8_scaled.safetensors` (type `krea2`) |
| VAE | `qwen_image_vae.safetensors` |
| Steps / CFG / sampler / scheduler | 8 / 1 / `euler` / `simple` |

Put the files in ComfyUI's model folders:

| File | Folder inside your ComfyUI |
|---|---|
| diffusion model | `models/diffusion_models/` |
| text encoder | `models/text_encoders/` |
| VAE | `models/vae/` |

The easiest way to get the right files is ComfyUI's own **template browser** (*Workflow → Browse Templates*): pick a template for your model and let ComfyUI download what it asks for. Then restart ComfyUI so it sees the new files.

You can use **another model** that loads the same way (separate diffusion model, text encoder and VAE): choose its files, the CLIP type, steps, CFG, sampler and scheduler in the settings below. The Krea 2 Turbo setup is the one that is tested.

### 3. Point PenNodePaper at it

Open **⚙ Settings → ComfyUI**:

1. Check the **URL** (default `http://127.0.0.1:8188`) and press **↻ test**: the dot turns green when ComfyUI answers.
2. Pick the UNET, CLIP, CLIP type and VAE from the lists (they are read from your running ComfyUI, so they show what you actually installed). The pre-filled values match the Krea 2 Turbo setup above.
3. Set the campaign's **image style** (a text appended to every picture prompt). *Generate from world books* can write one for you if you have an AI installed.

Then open any node → **Inspector → Images → Generate**, or ask the AI.

**Painted maps** (the **Paint** tab of the map editor) reuse the same model through image-to-image. They need nothing extra, only a model good at top-down maps. The *map style* text in the settings steers how maps **look** (materials, brush, palette); the camera angle (top-down by default, or your own words, e.g. a side view) is chosen per map in its Paint tab.

---

## 🧩 Other optional tools

Each of these unlocks one feature. After installing, restart `npm run dev`. Check a tool with the command in the last column.

| Feature | Tool | Install | Check |
|---|---|---|---|
| 📘 **GM binder PDF** (campaign menu → *GM binder (PDF)…*) | WeasyPrint | Debian/Ubuntu `sudo apt install weasyprint` · Fedora `sudo dnf install weasyprint` · Arch `sudo pacman -S python-weasyprint` · macOS `brew install weasyprint` · or `pip install weasyprint` | `weasyprint --version` |
| 🖼️ **Image thumbnails** (small, fast previews; originals stay untouched) | ImageMagick | Debian/Ubuntu `sudo apt install imagemagick` · Fedora `sudo dnf install ImageMagick` · Arch `sudo pacman -S imagemagick` · macOS `brew install imagemagick` · Windows `winget install ImageMagick.ImageMagick` | `magick -version` (or `convert -version`) |
| 📥 **Import notes** from `.pdf` | poppler (`pdftotext`) | Debian/Ubuntu `sudo apt install poppler-utils` · Fedora `sudo dnf install poppler-utils` · Arch `sudo pacman -S poppler` · macOS `brew install poppler` | `pdftotext -v` |
| 📥 **Import notes** from `.docx` | `unzip` | Debian/Ubuntu `sudo apt install unzip` · Fedora `sudo dnf install unzip` · Arch `sudo pacman -S unzip` · macOS preinstalled | `unzip -v` |
| 🛟 **Backups & sync** (snapshots, archives) | `tar` | already on Linux, macOS and Windows 10/11 | `tar --version` |
| 🛟 **Local git history** (optional switch in *Backups & sync…*) | git | `sudo apt install git` · `sudo dnf install git` · `brew install git` · `winget install Git.Git` | `git --version` |

Without ImageMagick the app shows the full-size pictures (fine for small campaigns, slower for big ones). `.md`, `.txt` and pasted notes import without any extra tool.

---

## 🔌 Connect a VTT

Live pushing of handouts, maps, NPCs and music works with the [supported VTTs](../README.md#supported-vtts). The steps are the same for all of them:

1. In PenNodePaper open **⚙ Settings → VTT link**. It shows the **bridge address** (`ws://127.0.0.1:4317/bridge`) and a secret **pairing token**.
2. In your VTT switch on its **PenNodePaper link** and paste the address and token. The top bar chip in PenNodePaper changes from *no VTT* to the VTT's name.
3. On connect the VTT announces what it can do; PenNodePaper remembers it, so the file export and the AI's character sheets keep working offline.

For KINETIK VTT that is the **PenNodePaper link** toggle on the GM page ([repository](https://github.com/Rec0iL/KINETIK-PNP)). No live link? **⚙ Settings → VTT link → export a file** writes a session file you can load into the VTT yourself.

Want to connect your own VTT? See [`vtt-bridge-spec.md`](vtt-bridge-spec.md).

---

## ⚙ Configuration

| What | Where / how |
|---|---|
| Campaigns | the `campaigns/` folder in the project (each campaign is a folder of plain files). Open any folder from the campaign menu, or set `PNP_CAMPAIGNS_DIR` |
| Which campaign opens | the one you used last; force one with `PNP_CAMPAIGN=<folder name>` |
| Settings file (port, pairing token, recent campaigns) | `~/.config/pennodepaper/config.json` (or under `$XDG_CONFIG_HOME`). Keep the token private |
| Server port | `PNP_PORT` (default `4317`) |
| UI port in development | `5273` (fixed in `packages/web/vite.config.ts`) |

Example, a different port in production mode:

```bash
npm run build
PNP_PORT=4400 npm start
```

> In `npm run dev` the UI proxies to port `4317`. If you need another port, use the production mode above.

Your campaign folders are plain markdown and JSON, so copying or backing up the folder (or using **Backups & sync**) is all it takes to move to another machine.

---

## 🔄 Updating

```bash
cd PenNodePaper
git pull
npm install
npm run dev        # or: npm run build && npm start
```

Your campaigns live in `campaigns/` (not tracked by git), so updating never touches them.

On Windows the [Start menu launcher](#-windows) does all of this by itself when it starts the server.

---

## 🩺 Troubleshooting

| Symptom | Fix |
|---|---|
| `http://127.0.0.1:5273` is refused | Use **`http://localhost:5273`**: the dev server may only listen on IPv6. |
| `EADDRINUSE` / port already in use | Another program uses port `4317` (or `5273`). Stop it, or run in production mode with `PNP_PORT=<free port>`. |
| `npm install` fails with a Node error | Check `node -v`: it must be 20 or newer. |
| Chat says **agy not found** / Claude does nothing | The CLI is not on the PATH of the terminal that started PenNodePaper. Check `claude --version` / `agy --version`, and make sure you are logged in. Restart `npm run dev` after installing. |
| agy chat can't use the tools | Click **Connect agy** in the chat (once), then try again. |
| Windows: `npm` says *running scripts is disabled on this system* | PowerShell blocks `npm.ps1`. Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use `npm.cmd install` / the Command Prompt (see [Native Windows](#-windows)). |
| Windows: Codex / Claude / agy is *not found* although it starts in a terminal | PenNodePaper has to be started from a terminal where the command works (a new window after installing). Check `where codex`: it should list a `codex.cmd` or `codex.exe`. |
| Generating a picture fails, or the ComfyUI dot in the settings is red | Start ComfyUI, open **⚙ Settings → ComfyUI** and press **↻ test**; the dot turns green when it answers. ComfyUI and PenNodePaper must run on the same computer (or enter the other computer's address there). |
| ComfyUI refuses the workflow | A model file in the settings isn't installed or has the wrong CLIP type. Pick the files from the lists in the settings. |
| *GM binder (PDF)* fails | `weasyprint --version` must work in the same terminal. Install WeasyPrint (see the [table](#-other-optional-tools)). |
| Importing a `.docx` / `.pdf` does nothing | Install `unzip` (docx; on Windows `tar` is enough, it comes with Windows) or poppler's `pdftotext` (pdf) — on Windows `Install-Tools.cmd` does that. Pasted text and `.md` / `.txt` always work. |
| Pictures load slowly in a big campaign | Install ImageMagick; thumbnails are created automatically. |
| VTT doesn't connect | Check the address and token in **⚙ Settings → VTT link**, that the VTT's link toggle is on, and that both run on the same computer (the server only accepts `127.0.0.1`). |

Still stuck? Open an issue: <https://github.com/Rec0iL/PenNodePaper/issues>
