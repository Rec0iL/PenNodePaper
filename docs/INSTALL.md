# 📖 Installing PenNodePaper

This guide takes you from nothing to a running PenNodePaper on **Linux**, **macOS** and **Windows**, and then walks through every **optional** piece that unlocks an extra feature: the AI assistants, ComfyUI image generation, the GM binder PDF, importing notes, and the VTT link.

> **Good to know:** the core app only needs **Node.js**. Everything else is optional, and each optional tool unlocks exactly one feature. You can start with the core and add tools later; nothing needs to be reinstalled.
>
> **Tested on:** Linux (Fedora-based). macOS uses the same commands through Homebrew. **Windows is best used through WSL2** (see [Windows](#-windows)); running natively is possible for the core app but is untested for the optional tools.

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
| 📥 Import notes from `.docx` / `.pdf` | **`unzip`** (docx) and **`pdftotext`** from poppler (pdf) | optional |
| 🛟 Backups (snapshots, archives) | **`tar`** | usually already there |
| 🛟 Optional git history of a campaign | **`git`** | optional |
| 🔌 Live link to a tabletop app | a VTT with a PenNodePaper bridge ([supported VTTs](../README.md#supported-vtts)) | optional |

PenNodePaper runs entirely on your machine. The server only listens on `127.0.0.1`, and nothing is sent anywhere except to the AI service you choose when you chat.

---

## ⚡ Quick start

If you already have Node.js 20+ and git:

```bash
git clone https://github.com/Rec0iL/PenNodePaper.git
cd PenNodePaper
npm install
npm run dev
```

Then open **<http://localhost:5273>**. The first start creates a small demo campaign in `campaigns/demo/`.

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

### Recommended: WSL2 (a real Linux inside Windows)

Everything in this project, including the optional tools, is built and tested for Linux, so WSL2 is the smoothest path on Windows.

1. Open **PowerShell as administrator** and run:
   ```powershell
   wsl --install -d Ubuntu
   ```
   Restart if asked, then open the **Ubuntu** app and create your user.
2. Inside Ubuntu, follow the [Linux](#-linux) steps (use nvm for Node.js).
3. Open **<http://localhost:5273>** in your normal Windows browser. WSL2 forwards `localhost`, so it just works.
4. Keep your campaigns inside the Linux file system (for example `~/PenNodePaper`), not under `/mnt/c/…`: it is much faster and file watching is reliable.

**ComfyUI on Windows with PenNodePaper in WSL2:** ComfyUI listens on `127.0.0.1` of Windows, which WSL2 cannot reach by default. Either turn on mirrored networking (create or edit `%UserProfile%\.wslconfig`):

```ini
[wsl2]
networkingMode=mirrored
```

then run `wsl --shutdown` and start again, or start ComfyUI with `--listen 0.0.0.0` and enter the Windows host's address in **⚙ Settings → ComfyUI**.

**A VTT in your Windows browser** can connect to `ws://127.0.0.1:4317/bridge` as usual (the same `localhost` forwarding).

### Native Windows (untested for the optional tools)

The core app is plain Node.js and should run natively:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
git clone https://github.com/Rec0iL/PenNodePaper.git
cd PenNodePaper
npm install
npm run dev
```

Things to know when running natively:

* Optional tools must be **on your PATH** and found as plain commands: `claude`, `agy`, `weasyprint`, `magick`, `pdftotext`, `unzip`, `tar`, `git`. Windows 10/11 already include `tar`.
* Install Claude Code with its **native installer** (it provides a real `claude.exe`). A `claude.cmd` shim from an npm global install can't be launched by the app.
* ImageMagick: `winget install ImageMagick.ImageMagick` (tick *Add to PATH*).
* `pdftotext` (poppler) and `unzip` have no official Windows installer; get them from a package manager such as [Scoop](https://scoop.sh) (`scoop install poppler unzip`) or [Chocolatey](https://chocolatey.org).
* WeasyPrint on Windows is easiest as the standalone executable from the [WeasyPrint releases](https://github.com/Kozea/WeasyPrint/releases); put it on your PATH as `weasyprint`.
* The settings file lives in `C:\Users\<you>\.config\pennodepaper\`.

If anything misbehaves natively, switch to WSL2: it's the same app with the supported environment.

---

## 🤖 AI assistants: Claude and agy

PenNodePaper does not include an AI. It drives **command-line assistants you install and log in to yourself**, and gives them its own MCP server so they can read and edit your campaign. You need at least one for the chat; you can switch between them per conversation.

### Claude (Claude Code)

1. Install the CLI (pick one):
   * macOS / Linux / WSL: `curl -fsSL https://claude.ai/install.sh | bash`
   * Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`
   * or with npm: `npm install -g @anthropic-ai/claude-code`
2. Run `claude` once in a terminal and **log in** (a Claude subscription or an API account).
3. Check: `claude --version`.

That's all. PenNodePaper starts `claude -p` in the background for each chat message, hands it the campaign tools and allows only those tools.

### agy (Antigravity CLI)

1. Install the **Antigravity CLI** following its own documentation and log in.
2. Check: `agy --version`.
3. In PenNodePaper open the right panel → **AI**, pick **agy**, and click **Connect agy** once. This registers PenNodePaper's MCP server in agy's own configuration (`agy mcp add …`).

### Using your own client (Claude Code in a terminal, etc.)

Any MCP client can attach to `http://127.0.0.1:4317/mcp` with the bearer token from `~/.config/pennodepaper/config.json`:

```bash
claude mcp add --transport http pennodepaper "http://127.0.0.1:4317/mcp?actor=claude" --header "Authorization: Bearer <token>"
```

No AI installed? Everything else still works: you build the story by hand, and `npm run ai-demo -w @pnp/server` shows what an AI session looks like.

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

**Painted maps** (the **Paint** tab of the map editor) reuse the same model through image-to-image. They need nothing extra, only a model good at top-down maps; the *map style* text in the settings steers it.

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

---

## 🩺 Troubleshooting

| Symptom | Fix |
|---|---|
| `http://127.0.0.1:5273` is refused | Use **`http://localhost:5273`**: the dev server may only listen on IPv6. |
| `EADDRINUSE` / port already in use | Another program uses port `4317` (or `5273`). Stop it, or run in production mode with `PNP_PORT=<free port>`. |
| `npm install` fails with a Node error | Check `node -v`: it must be 20 or newer. |
| Chat says **agy not found** / Claude does nothing | The CLI is not on the PATH of the terminal that started PenNodePaper. Check `claude --version` / `agy --version`, and make sure you are logged in. Restart `npm run dev` after installing. |
| agy chat can't use the tools | Click **Connect agy** in the chat (once), then try again. |
| Generating a picture fails, or the ComfyUI dot in the settings is red | Start ComfyUI, open **⚙ Settings → ComfyUI** and press **↻ test**; the dot turns green when it answers. In WSL2 see the [ComfyUI note](#-windows). |
| ComfyUI refuses the workflow | A model file in the settings isn't installed or has the wrong CLIP type. Pick the files from the lists in the settings. |
| *GM binder (PDF)* fails | `weasyprint --version` must work in the same terminal. Install WeasyPrint (see the [table](#-other-optional-tools)). |
| Importing a `.docx` / `.pdf` does nothing | Install `unzip` (docx) or poppler's `pdftotext` (pdf). Pasted text and `.md` / `.txt` always work. |
| Pictures load slowly in a big campaign | Install ImageMagick; thumbnails are created automatically. |
| VTT doesn't connect | Check the address and token in **⚙ Settings → VTT link**, that the VTT's link toggle is on, and that both run on the same computer (the server only accepts `127.0.0.1`). |

Still stuck? Open an issue: <https://github.com/Rec0iL/PenNodePaper/issues>
