# ClauseGuard setup for Windows (PowerShell).
#
#   powershell -ExecutionPolicy Bypass -File scripts\bootstrap.ps1
#
# Installs Python dependencies, downloads both frozen checkpoints and both
# datasets, and builds the frontend. The fitted artefacts (prototype bank and
# verifier calibration) come down with the git clone via Git LFS, so the slow
# fitting steps are NOT repeated here.
#
# Needs: Python 3.11+, Node 20+, and Git with Git LFS, all on PATH.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Need($cmd, $hint) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Error "$cmd not found on PATH. $hint"
        exit 1
    }
}

Need "python" "Install Python 3.11+ from python.org and tick 'Add to PATH'."
Need "npm"    "Install Node 20+ from nodejs.org."
Need "git"    "Install Git from git-scm.com."

Write-Host "==> checking Git LFS pulled the fitted artefacts"
$proto = Join-Path $Root "backend\artifacts\prototypes.npz"
if (-not (Test-Path $proto)) {
    Write-Error "backend\artifacts\prototypes.npz is missing. Run: git lfs install; git lfs pull"
    exit 1
}
# An unresolved LFS pointer is a small text file; a real npz is a ZIP ('PK').
$head = [System.IO.File]::ReadAllBytes($proto)[0..1]
if ([char]$head[0] -ne 'P' -or [char]$head[1] -ne 'K') {
    Write-Error "prototypes.npz is an unresolved Git LFS pointer. Run: git lfs install; git lfs pull"
    exit 1
}

Write-Host "==> creating the virtual environment"
if (-not (Test-Path ".venv")) { python -m venv .venv }
$Py = Join-Path $Root ".venv\Scripts\python.exe"

Write-Host "==> installing PyTorch (CPU build - much smaller than the CUDA wheels)"
& $Py -m pip install --quiet --upgrade pip
& $Py -m pip install --quiet torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu

Write-Host "==> installing the remaining dependencies"
& $Py -m pip install --quiet -r backend\requirements-dev.txt

Write-Host "==> downloading the datasets (CUAD + ContractNLI, ~110MB)"
& $Py scripts\download_data.py

Write-Host "==> downloading both checkpoints (~1.1GB)"
& $Py scripts\download_models.py

Write-Host "==> building the frontend"
Set-Location (Join-Path $Root "frontend")
npm install --no-audit --no-fund
npm run build
Set-Location $Root

Write-Host ""
Write-Host "Setup complete. Start it with:"
Write-Host "    .venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --port 7860"
Write-Host "then open http://localhost:7860"
Write-Host ""
