# Demoing from a company laptop

The situation this covers: you build on your own machine, but you can only take
a Windows company laptop into the office, and you need to show the running
product and walk through the code.

---

## Plan A — browser only (recommended)

Nothing is installed on the company laptop. You open two tabs.

| Tab | What it shows |
|---|---|
| The live link | the running product |
| github.com/abi672003/clauseguard | the code you walk through |

### Before you leave home

Start the demo server on your own machine and **leave it running**:

```bash
cd ~/clauseguard
./scripts/serve_demo.sh
```

That script exists specifically for this. It:

1. **Keeps your Mac awake** (`caffeinate`) so the link does not die when it idles.
2. **Publishes the current URL to a GitHub Gist**, so you can find it from the
   office. This matters more than it sounds — a Cloudflare quick tunnel gets a
   **new random hostname every restart**, and without the gist you would have no
   way to learn the new one from a different building.
3. **Restarts the tunnel automatically** if it drops, and republishes the URL.

**Bookmark the gist, never the tunnel URL.** The gist address is permanent; the
tunnel address is not.

### What will break it

Be honest with yourself about these before relying on Plan A:

- Your Mac **going to sleep, shutting down, or losing wifi** kills the link.
  `caffeinate` prevents idle sleep; it does **not** prevent a closed lid on
  battery, so leave it **plugged in and lid open**.
- Your **home internet** dropping kills it.
- A tunnel restart changes the URL — recoverable via the gist, but only if you
  check it.

Test it the day before: from your phone on mobile data (not home wifi), open the
gist, follow the link, and click through every screen.

---

## Plan B — run it on the Windows laptop

Slower to set up but depends on nothing at home. Worth doing as a backup even if
you intend to use Plan A.

### Prerequisites

Install these (all free, no admin rights needed for the first two if you pick
the per-user installer):

- **Python 3.11 or 3.12** — python.org, tick **Add python.exe to PATH**
- **Node 20+** — nodejs.org
- **Git** — git-scm.com, which bundles Git LFS

### Setup

```powershell
git clone https://github.com/abi672003/clauseguard.git
cd clauseguard
git lfs install
git lfs pull

powershell -ExecutionPolicy Bypass -File scripts\bootstrap.ps1
```

`bootstrap.ps1` installs the CPU build of PyTorch, the remaining dependencies,
both checkpoints (~1.1GB) and both datasets (~110MB), then builds the frontend.
Budget **20–30 minutes** and about **4GB of disk**.

It does **not** refit anything. The prototype bank and the verifier calibration
are committed to the repo through Git LFS, so the 15-minute extractor fit and
the 10-minute calibration are already done. The script checks they arrived
intact and stops early with instructions if Git LFS did not resolve them.

### Run it

```powershell
.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --port 7860
```

Open <http://localhost:7860>. One process serves the API and the UI.

The database starts empty — open **Contracts** and click **Load real CUAD
contracts**. Analysis takes a few minutes per contract, so do this *before* the
demo, not during it.

### Making small edits there

```powershell
# Python: add --reload, changes apply in about a second
.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --port 7860 --reload

# UI: rebuild after editing, then refresh the browser
cd frontend
npm run build
```

### Corporate network

If PyPI, huggingface.co or the npm registry are blocked, `bootstrap.ps1` will
fail on the download step. In that case fall back to Plan A, or ask IT to allow
`pypi.org`, `files.pythonhosted.org`, `huggingface.co`, `cdn-lfs.huggingface.co`
and `registry.npmjs.org`.

---

## Plan C — a permanent host

If the link needs to work when you are *not* running anything, it has to live on
a machine that is always on. See [DEPLOY.md](DEPLOY.md). Hugging Face Spaces is
the least work (~$9/month for the Docker tier); the same Dockerfile also
deploys to Fly.io, Render or Cloud Run.

---

## Have a fallback that cannot fail

Whatever you pick, record a **2–3 minute screen capture** of the working product
the night before: loading a contract, the pipeline running, an obligation's
verification panel, and the `/research` ablation. If the network betrays you in
the room, you still have something to show, and you can talk over it.
