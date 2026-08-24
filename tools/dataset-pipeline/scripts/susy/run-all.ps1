#requires -Version 5.1
# One-shot SUSY dataset export for Windows: the general entry point that wires
# the two halves the pipeline leaves to the operator.
#
#   1. Oracle jar missing? Builds it via .\build-jar.ps1, which provisions
#      JDK 8 + Gradle 4.10.3 into temp\susy-build by itself.
#   2. Instance has no start script / binClient-modified.jar (the norm for a
#      Prism-managed pack on Windows)? Finds prismlauncher.exe and exports
#      SUSY_LAUNCH_COMMAND so the runner knows how to boot the client.
#   3. Hands over to run-susy-export.ps1, which does everything else:
#      launch, dump watchdog, normalization, indexes, manifest.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File run-all.ps1
#   powershell -ExecutionPolicy Bypass -File run-all.ps1 -DryRun   # checks only
#
# Respected environment (same contract as run-susy-export.ps1):
#   SUSY_INSTANCE_DIR, SUSY_BOOTSTRAP_REF, SUSY_LAUNCH_COMMAND,
#   SUSY_HEI_ORACLE_JAR, plus SUSY_PRISM_EXE to pin the Prism executable.

param([switch]$DryRun)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..\..")).Path
$Runner = Join-Path $PSScriptRoot "run-susy-export.ps1"
$BuildJar = Join-Path $PSScriptRoot "build-jar.ps1"

function Say {
  param([string]$Message)
  Write-Host "[run-all] $Message"
}

function Die {
  param([string]$Message)
  Write-Host "[run-all] ERROR: $Message" -ForegroundColor Red
  exit 1
}

# --- Resolve the instance up front -------------------------------------------
# Same resolver contract as the runner; knowing the instance here is what lets
# us decide between its own start script and a Prism launch before handing over.

$resolverArgs = @(Join-Path $PSScriptRoot "resolve-susy-instance.mjs")
if ($env:SUSY_INSTANCE_DIR) { $resolverArgs += @("--instance", $env:SUSY_INSTANCE_DIR) }
if ($env:SUSY_BOOTSTRAP_REF) { $resolverArgs += @("--ref", $env:SUSY_BOOTSTRAP_REF) }
if ($DryRun) { $resolverArgs += "--no-bootstrap" } else { $resolverArgs += "--bootstrap-if-missing" }

Say "Resolving Supersymmetry instance..."
$resolverOutput = & node @resolverArgs --json
if ($LASTEXITCODE -ne 0) { Die "resolve-susy-instance failed." }

# The bootstrap may emit its own JSON first; take the last {...} with "found".
$jsonText = ($resolverOutput | ForEach-Object { $_.ToString() }) -join "`n"
$resolved = $null
foreach ($document in [regex]::Matches($jsonText, "\{[^{}]*\}")) {
  try { $parsed = $document.Value | ConvertFrom-Json } catch { continue }
  if ($parsed.PSObject.Properties.Name -contains "found") { $resolved = $parsed }
}
if (-not $resolved -or $resolved.found -ne $true) {
  Die "No Supersymmetry instance available."
}
$InstanceDir = [System.IO.Path]::GetFullPath($resolved.instanceDir)
Say "Instance: $InstanceDir"

# --- Step 1: oracle jar -------------------------------------------------------

function Get-BuiltOracleJar {
  $libs = Join-Path $RepoRoot "tools\dataset-pipeline\susy-hei-oracle\build\libs"
  if (-not (Test-Path -LiteralPath $libs)) { return $null }
  $jar = Get-ChildItem -LiteralPath $libs -Filter "*.jar" -File |
    Where-Object { $_.Name -notlike "*-sources.jar" } |
    Sort-Object -Property LastWriteTime -Descending |
    Select-Object -First 1
  if ($jar) { return $jar.FullName }
  return $null
}

if ($env:SUSY_HEI_ORACLE_JAR -and (Test-Path -LiteralPath $env:SUSY_HEI_ORACLE_JAR)) {
  Say "Oracle jar (env): $($env:SUSY_HEI_ORACLE_JAR)"
} elseif ($resolved.oracleJar -and (Test-Path -LiteralPath $resolved.oracleJar)) {
  Say "Oracle jar (found): $($resolved.oracleJar)"
} else {
  Say "No oracle jar found; building it (JDK 8 + Gradle provisioned automatically)..."
  if ($DryRun) {
    Say "(dry-run) would now run build-jar.ps1."
  } else {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $BuildJar
    if ($LASTEXITCODE -ne 0) { Die "build-jar.ps1 failed." }
    $built = Get-BuiltOracleJar
    if (-not $built) { Die "Build reported success but no jar landed in build\libs." }
    Say "Oracle jar built: $built"
  }
}

# --- Step 2: how the client will be launched ----------------------------------

function Test-RunnerCanLaunch {
  # Mirrors Find-StartScript's search space (instance dir + one level of child
  # dirs) plus the binClient-modified.jar fallback.
  $files = @(Get-ChildItem -LiteralPath $InstanceDir -File -ErrorAction SilentlyContinue)
  foreach ($child in (Get-ChildItem -LiteralPath $InstanceDir -Directory -ErrorAction SilentlyContinue)) {
    $files += @(Get-ChildItem -LiteralPath $child.FullName -File -ErrorAction SilentlyContinue)
  }
  foreach ($pattern in @("*.cmd", "*.bat", "*start*.sh", "launch*.sh")) {
    if ($files | Where-Object { $_.Name -ilike $pattern }) { return $true }
  }
  return (Test-Path -LiteralPath (Join-Path $InstanceDir "binClient-modified.jar"))
}

function Find-PrismExe {
  if ($env:SUSY_PRISM_EXE -and (Test-Path -LiteralPath $env:SUSY_PRISM_EXE)) {
    return $env:SUSY_PRISM_EXE
  }
  foreach ($candidate in @(
    "$env:LOCALAPPDATA\Programs\PrismLauncher\prismlauncher.exe",
    "C:\Program Files\PrismLauncher\prismlauncher.exe",
    "C:\Program Files\prismlauncher\prismlauncher.exe",
    "$env:LOCALAPPDATA\PrismLauncher\prismlauncher.exe"
  )) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  foreach ($root in @("$env:LOCALAPPDATA\Programs", "C:\Program Files", "C:\Program Files (x86)")) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $hit = Get-ChildItem -LiteralPath $root -Recurse -Depth 2 -Filter "prismlauncher.exe" -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  foreach ($hive in @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )) {
    $location = Get-ItemProperty -LiteralPath $hive -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -match "Prism.*Launcher" -and $_.InstallLocation } |
      Select-Object -ExpandProperty InstallLocation -First 1
    if ($location -and (Test-Path -LiteralPath (Join-Path $location "prismlauncher.exe"))) {
      return (Join-Path $location "prismlauncher.exe")
    }
  }
  return $null
}

if ($env:SUSY_LAUNCH_COMMAND) {
  Say "Launch command (env override): $($env:SUSY_LAUNCH_COMMAND)"
} elseif (Test-RunnerCanLaunch) {
  Say "Instance ships its own start script/binClient; the runner will launch it."
} else {
  $prismExe = Find-PrismExe
  if (-not $prismExe) {
    Die "No start script and no Prism Launcher executable found. Install Prism Launcher, or set SUSY_PRISM_EXE / SUSY_LAUNCH_COMMAND."
  }
  # Prefer the id the resolver extracted from instance.cfg; fall back to the
  # wrapper folder name (<id>\minecraft) one level above the game dir.
  $instanceId = if ($resolved.PSObject.Properties.Name -contains "prismInstanceId" -and $resolved.prismInstanceId) {
    $resolved.prismInstanceId
  } else {
    Split-Path -Leaf (Split-Path -Parent $InstanceDir)
  }
  $env:SUSY_LAUNCH_COMMAND = "`"$prismExe`" -l `"$instanceId`""
  Say "Launch via Prism: $env:SUSY_LAUNCH_COMMAND"
}

# --- Step 3: hand over ---------------------------------------------------------

if ($DryRun) {
  Say "(dry-run) All checks passed; would now execute run-susy-export.ps1."
  exit 0
}

Say "Handing over to run-susy-export.ps1..."
& powershell -NoProfile -ExecutionPolicy Bypass -File $Runner
exit $LASTEXITCODE
