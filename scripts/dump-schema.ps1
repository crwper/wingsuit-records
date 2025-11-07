param(
  [string]$Schema = "public",
  # Relative to the repo root (this script’s folder)
  [string]$OutFile = "../supabase/schema.sql",
  # Optional: override DB URL if you’re not using `supabase link`
  [string]$DbUrl
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Resolve output path relative to this script’s directory
$base = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($base)) { $base = (Get-Location).Path }
$dest = if ([IO.Path]::IsPathRooted($OutFile)) { $OutFile } else { Join-Path $base $OutFile }

# Ensure folder exists
$destDir = Split-Path -Parent $dest
if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }

# Check CLI is available
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
  throw "Supabase CLI not found on PATH. Install it and try again."
}

# Backup existing file (timestamped), if present
if (Test-Path $dest -PathType Leaf) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backup = Join-Path $destDir ("schema.sql.$stamp.bak")
  Copy-Item $dest $backup -Force
  Write-Host "Backed up existing schema to $backup"
}

# Build args and run
$args = @('db','dump','--schema', $Schema, '--file', $dest)
if ($DbUrl) { $args += @('--db-url', $DbUrl) }

Write-Host "Running: supabase $($args -join ' ')" -ForegroundColor Cyan
& supabase @args
if ($LASTEXITCODE -ne 0) { throw "supabase db dump failed with exit code $LASTEXITCODE" }

Write-Host "Wrote schema to $dest" -ForegroundColor Green
