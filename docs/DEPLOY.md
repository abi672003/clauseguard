# Deploying ClauseGuard

Everything below is already configured in the repo. These are the two
credentialed steps that cannot be automated.

---

## 1. GitHub

`gh` is installed. Authenticate once, then create and push:

```bash
gh auth login          # choose GitHub.com → HTTPS → browser
cd ~/clauseguard
gh repo create clauseguard --public --source=. --remote=origin --push
```

That pushes `main` including the Git LFS artefact (`prototypes.npz`).

Verify:
```bash
gh repo view --web
```

> The repo lives at `~/clauseguard` with its own `.git`. Your home directory is
> itself a git repo pointing at `ecom-website`; ClauseGuard is deliberately a
> separate repository and is not tracked by it.

---

## 2. Hugging Face Space — the public URL

A Docker Space is the right host here: free, 16GB RAM, and it runs the
Dockerfile as-is. One container serves the API and the built React client, so
the whole product is one URL.

```bash
pip install -U "huggingface_hub[cli]"
hf auth login --add-to-git-credential      # the flag matters: the git push reuses this token
./scripts/deploy_hf.sh <your-hf-username>  # e.g. ./scripts/deploy_hf.sh abi672003
```

Result: `https://huggingface.co/spaces/<username>/clauseguard`

**The first build takes 10–15 minutes.** It installs CPU-only torch, then bakes
in both checkpoints (~1.1GB) and both datasets, so the running container makes
no Hugging Face network call and starts deterministically.

**First load takes ~60s** while the two transformer models warm up. `/api/v1/health`
reports `models_loaded` so you can watch it come up.

### Optional: enable the Claude agent
In the Space UI → Settings → Variables and secrets, add a secret:

| Name | Value |
|---|---|
| `CLAUSEGUARD_ANTHROPIC_API_KEY` | your key from console.anthropic.com |

Without it the deterministic policy engine runs. That is not a degraded mode —
it is reproducible, free, and it is what the ablation runs on.

### Populate the demo
Once the Space is up, either click **Contracts → Load real CUAD contracts**, or
run the pipeline from a terminal against the Space. Analysis of six contracts
takes a few minutes on Space hardware.

---

## 3. Local Docker (alternative)

```bash
docker compose up --build     # → http://localhost:7860
```

Needs ~5GB of free disk for the image. The build downloads both datasets and
both checkpoints.

---

## Other hosts

The same `Dockerfile` deploys unchanged to Render, Railway or Fly.io. It honours
`$PORT` and exposes `/api/v1/health` for health checks. Budget **at least 2GB of
RAM** — the two transformer models need roughly 1.5GB resident, so 512MB free
tiers will OOM.

```bash
fly launch --dockerfile Dockerfile --vm-memory 2048
```
