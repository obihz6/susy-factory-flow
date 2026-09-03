#requires -Version 5.1
# SUSY dataset export runner (Windows port of run-susy-export.sh): drives a
# local Supersymmetry 1.12.2 client with the susy-hei-oracle mod and
# normalizes the resulting dump into a planner RecipeDataset.
#
# Instance resolution (resolve-susy-instance.mjs):
#   1. SUSY_INSTANCE_DIR (explicit, validated)
#   2. auto-detected: ./temp/.minecraft, ./temp checkouts, known launcher
#      instance roots (Prism/PolyMC/MultiMC/ATLauncher/CurseForge/vanilla)
#   3. nothing found: a barebone instance is downloaded into .\temp\.minecraft
#      (bootstrap-susy-instance.mjs; SUSY_BOOTSTRAP=0 disables this)
#
# Optional environment:
#   SUSY_BOOTSTRAP_REF           pack ref for the bootstrap (default: latest GitHub release)
#   SUSY_DATASET_OUT_DIR         where recipes.json is written (default public/datasets/susy/<version>)
#   SUSY_RAW_EXPORT_DIR          scratch dir for logs and recipedump.json (default temp/raw-export)
#   SUSY_DATASET_VERSION_ID      e.g. "0.1.16.14.1" (default: the instance's pack.toml version)
#   SUSY_DATASET_VERSION_LABEL   human label stored in the manifest (default "SUSY <version>")
#   SUSY_HEI_ORACLE_JAR          prebuilt oracle jar (else newest jar under tools/dataset-pipeline/susy-hei-oracle/build/libs)
#   SUSY_LAUNCH_COMMAND          client launch command override
#   SUSY_EXPORT_TIMEOUT_SECONDS  overall watchdog (default 14400)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..\..")).Path
$Resolver = Join-Path $PSScriptRoot "resolve-susy-instance.mjs"

$RunnerLog = Join-Path $RepoRoot "temp\raw-export\export-runner.log"
function Write-Log {
  param([string]$Message)
  $line = $Message
  Write-Host $line
  $dir = Split-Path -Parent $RunnerLog
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  Add-Content -LiteralPath $RunnerLog -Value $line
}

function Fail {
  param([string]$Message)
  Write-Log $Message
  exit 1
}

function Invoke-NodeStep {
  param([string[]]$NodeArgs)
  & node @NodeArgs
  if ($LASTEXITCODE -ne 0) { Fail ("node step failed: " + ($NodeArgs -join " ")) }
}

# --- Resolve the instance ---------------------------------------------------

$resolverArgs = @($Resolver)
if ($env:SUSY_INSTANCE_DIR) { $resolverArgs += @("--instance", $env:SUSY_INSTANCE_DIR) }
if ($env:SUSY_BOOTSTRAP_REF) { $resolverArgs += @("--ref", $env:SUSY_BOOTSTRAP_REF) }
if ($env:SUSY_BOOTSTRAP -eq "0") { $resolverArgs += "--no-bootstrap" } else { $resolverArgs += "--bootstrap-if-missing" }

Write-Log "Resolving Supersymmetry instance..."
$resolverOutput = & node @resolverArgs --json
$resolverExit = $LASTEXITCODE
if ($resolverExit -ne 0) { Fail "resolve-susy-instance failed (exit $resolverExit)." }

# When the resolver bootstraps an instance, the bootstrap's own JSON lands on
# the same inherited stdout before the resolver's verdict; take the last
# flat {...} document emitted.
$resolved = $null
$jsonText = ($resolverOutput | ForEach-Object { $_.ToString() }) -join "`n"
$documents = [regex]::Matches($jsonText, "\{[^{}]*\}")
foreach ($document in $documents) {
  try { $parsed = $document.Value | ConvertFrom-Json } catch { continue }
  if ($parsed.PSObject.Properties.Name -contains "found") { $resolved = $parsed }
}
if (-not $resolved -or $resolved.found -ne $true) {
  Fail "No Supersymmetry instance available; refusing to guess."
}

# --- Derived settings ---------------------------------------------------------

$InstanceDir = [System.IO.Path]::GetFullPath($resolved.instanceDir)
if (-not (Test-Path -LiteralPath $InstanceDir)) { Fail "Resolved instance '$InstanceDir' does not exist." }

$VersionId = if ($env:SUSY_DATASET_VERSION_ID) { $env:SUSY_DATASET_VERSION_ID } else { $resolved.version }
$VersionLabel = if ($env:SUSY_DATASET_VERSION_LABEL) { $env:SUSY_DATASET_VERSION_LABEL } elseif ($VersionId) { "SUSY $VersionId" } else { $null }
if (-not $VersionId -or -not $VersionLabel) {
  Fail "SUSY_DATASET_VERSION_ID/LABEL could not be derived from the instance."
}

$DatasetOutDir = if ($env:SUSY_DATASET_OUT_DIR) { $env:SUSY_DATASET_OUT_DIR } else { Join-Path $RepoRoot "public\datasets\susy\$VersionId" }
$RawExportDir = if ($env:SUSY_RAW_EXPORT_DIR) { $env:SUSY_RAW_EXPORT_DIR } else { Join-Path $RepoRoot "temp\raw-export" }
New-Item -ItemType Directory -Force -Path $DatasetOutDir, $RawExportDir | Out-Null

$RuntimeLog = Join-Path $RawExportDir "susy-runtime.out.log"
$RuntimeErrLog = Join-Path $RawExportDir "susy-runtime.err.log"
$RecipedumpPath = [System.IO.Path]::GetFullPath((Join-Path $RawExportDir "recipedump.json"))
$RenderedIconDir = [System.IO.Path]::GetFullPath((Join-Path $RawExportDir "rendered-icons"))

$startedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss+00:00")
Write-Log "SUSY export runner started at $startedAt"
Write-Log "Instance: $InstanceDir"
Write-Log "Dataset: $VersionId ($VersionLabel)"

# --- Oracle jar ----------------------------------------------------------------

$OracleJar = $env:SUSY_HEI_ORACLE_JAR
if (-not $OracleJar -and $resolved.oracleJar) { $OracleJar = $resolved.oracleJar }
if (-not $OracleJar -or -not (Test-Path -LiteralPath $OracleJar)) {
  $libs = Join-Path $RepoRoot "tools\dataset-pipeline\susy-hei-oracle\build\libs"
  $OracleJar = $null
  if (Test-Path -LiteralPath $libs) {
    $candidate = Get-ChildItem -LiteralPath $libs -Filter "*.jar" -File |
      Where-Object { $_.Name -notlike "*-sources.jar" } |
      Sort-Object -Property Name |
      Select-Object -Last 1
    if ($candidate) { $OracleJar = $candidate.FullName }
  }
}
if (-not $OracleJar -or -not (Test-Path -LiteralPath $OracleJar)) {
  Fail "No susy-hei-oracle jar found. Build the mod first or set SUSY_HEI_ORACLE_JAR."
}
Write-Log "Oracle jar: $OracleJar"

# --- Prepare the instance --------------------------------------------------------

$instanceMods = Join-Path $InstanceDir "mods"
New-Item -ItemType Directory -Force -Path $instanceMods | Out-Null
Get-ChildItem -LiteralPath $instanceMods -Filter "susy*hei*oracle*.jar" -File -ErrorAction SilentlyContinue |
  ForEach-Object {
    Write-Log "Removing stale oracle jar: $($_.FullName)"
    try {
      Remove-Item -LiteralPath $_.FullName -Force
    } catch {
      Fail "Cannot replace $($_.FullName): it is locked by a running process. Close the Susy client (and Prism) first, then retry."
    }
  }
Copy-Item -LiteralPath $OracleJar -Destination (Join-Path $instanceMods (Split-Path -Leaf $OracleJar)) -Force

$instanceOptions = Join-Path $InstanceDir "options.txt"
if (Test-Path -LiteralPath $instanceOptions) {
  $optionsText = [System.IO.File]::ReadAllText($instanceOptions)
  $patched = [regex]::Replace($optionsText, "(?m)^pauseWhenEmpty:.*", "pauseWhenEmpty:false")
  if ($patched -cne $optionsText) {
    [System.IO.File]::WriteAllText($instanceOptions, $patched)
    Write-Log "Set pauseWhenEmpty:false in options.txt."
  }
}

New-Item -ItemType Directory -Force -Path $RenderedIconDir | Out-Null

$susyJavaOpts = "$($env:JAVA_TOOL_OPTIONS) -Dsusy.oracle.autorun=true -Dsusy.oracle.dumpRecipes=true " +
  "-Dsusy.oracle.recipedumpPath=`"$RecipedumpPath`" -Dsusy.oracle.iconDir=`"$RenderedIconDir`""
$env:JAVA_TOOL_OPTIONS = $susyJavaOpts.Trim()

# --- Launch the client -------------------------------------------------------------

function Find-StartScript {
  $depth2 = Get-ChildItem -LiteralPath $InstanceDir -File -ErrorAction SilentlyContinue
  $childDirs = Get-ChildItem -LiteralPath $InstanceDir -Directory -ErrorAction SilentlyContinue
  foreach ($child in $childDirs) {
    $depth2 += @(Get-ChildItem -LiteralPath $child.FullName -File -ErrorAction SilentlyContinue)
  }
  $pick = { param($Pattern) @( $depth2 | Where-Object { $_.Name -ilike $Pattern } | Sort-Object -Property Name ) }
  foreach ($pattern in @("*.cmd", "*.bat", "*start*.sh", "launch*.sh")) {
    $hit = & $pick $pattern | Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  return $null
}

$proc = $null
$launchDesc = ""
try {
  if ($env:SUSY_LAUNCH_COMMAND) {
    $launchDesc = $env:SUSY_LAUNCH_COMMAND
    Write-Log "Launch (override): $launchDesc"
    $proc = Start-Process -FilePath "cmd.exe" `
      -ArgumentList @("/d", "/s", "/c", "`"$env:SUSY_LAUNCH_COMMAND`"") `
      -WorkingDirectory $InstanceDir -PassThru `
      -RedirectStandardOutput $RuntimeLog -RedirectStandardError $RuntimeErrLog -WindowStyle Hidden
  } else {
    $startScript = Find-StartScript
    if ($startScript -and ($startScript.EndsWith(".cmd") -or $startScript.EndsWith(".bat"))) {
      $launchDesc = "cmd.exe /c `"$startScript`""
      Write-Log "Launch: $launchDesc"
      $proc = Start-Process -FilePath "cmd.exe" `
        -ArgumentList @("/d", "/c", "`"$startScript`"") `
        -WorkingDirectory $InstanceDir -PassThru `
        -RedirectStandardOutput $RuntimeLog -RedirectStandardError $RuntimeErrLog -WindowStyle Hidden
    } elseif ($startScript) {
      $launchDesc = "bash `"$startScript`""
      Write-Log "Launch: $launchDesc"
      $proc = Start-Process -FilePath "bash" `
        -ArgumentList @($startScript) `
        -WorkingDirectory $InstanceDir -PassThru `
        -RedirectStandardOutput $RuntimeLog -RedirectStandardError $RuntimeErrLog -WindowStyle Hidden
    } else {
      $fallbackJar = Join-Path $InstanceDir "binClient-modified.jar"
      if (-not (Test-Path -LiteralPath $fallbackJar)) {
        Fail "No start script and no binClient-modified.jar in the instance; cannot launch."
      }
      $launchDesc = "java -jar binClient-modified.jar nogui"
      Write-Log "No start script found; falling back to: $launchDesc"
      $proc = Start-Process -FilePath "java" `
        -ArgumentList @("-jar", "binClient-modified.jar", "nogui") `
        -WorkingDirectory $InstanceDir -PassThru `
        -RedirectStandardOutput $RuntimeLog -RedirectStandardError $RuntimeErrLog -WindowStyle Hidden
    }
  }

  if (-not $proc -or $proc.HasExited) {
    Fail "The Susy client exited immediately (exit code $($proc.ExitCode)). Check $RuntimeErrLog."
  }
  Write-Log "Client PID: $($proc.Id)"

  # --- Watchdog loop -----------------------------------------------------------

  $timeoutSeconds = 14400
  if ($env:SUSY_EXPORT_TIMEOUT_SECONDS) { $timeoutSeconds = [int]$env:SUSY_EXPORT_TIMEOUT_SECONDS }
  $deadline = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)
  $dumpReady = $false

  while ([DateTime]::UtcNow -lt $deadline) {
    foreach ($logFile in @($RuntimeLog, $RuntimeErrLog)) {
      if ((Test-Path -LiteralPath $logFile) -and
          (Select-String -LiteralPath $logFile -Pattern "Minecraft Crash Report|Fatal errors were detected" -Quiet)) {
        Write-Log "Susy client crashed before completing the export."
        Get-Content -LiteralPath $logFile -Tail 120 | ForEach-Object { Write-Log $_ }
        exit 1
      }
    }

    if (Test-Path -LiteralPath $RecipedumpPath) {
      $sizeBefore = (Get-Item -LiteralPath $RecipedumpPath).Length
      Start-Sleep -Seconds 5
      $sizeAfter = (Get-Item -LiteralPath $RecipedumpPath).Length
      if ($sizeBefore -eq $sizeAfter -and $sizeAfter -gt 2) {
        # The client exits itself after the dump settles; give it a moment.
        if ($proc.HasExited) { $dumpReady = $true; break }
        Start-Sleep -Seconds 15
        if ($proc.HasExited) { $dumpReady = $true; break }
        Write-Log "recipedump.json present but the client is still running; waiting for its own exit."
      }
    }

    if ($proc.HasExited) {
      $proc.WaitForExit()
      if (Test-Path -LiteralPath $RecipedumpPath) { $dumpReady = $true; break }
      Fail "Susy client exited without producing $RecipedumpPath."
    }

    Start-Sleep -Seconds 5
  }

  if (-not $dumpReady) {
    Fail "Timed out waiting for $RecipedumpPath."
  }
} finally {
  if ($proc -and -not $proc.HasExited) {
    Write-Log "Stopping the Susy client (PID $($proc.Id))..."
    & taskkill /PID $proc.Id /T /F 2>$null | Out-Null
    try { $proc.WaitForExit(10000) | Out-Null } catch {}
  }
}

# --- Normalize and publish -------------------------------------------------------

# The dataset scripts read these from the environment; PowerShell variables
# alone never reach the node children (this is exactly why an otherwise
# complete export used to die at the normalize step).
$env:SUSY_DATASET_VERSION_ID = $VersionId
$env:SUSY_DATASET_VERSION_LABEL = $VersionLabel
$env:SUSY_RENDERED_ICON_DIR = $RenderedIconDir

Write-Log "Normalizing SusyCore recipedump into the planner dataset."
Invoke-NodeStep @(
  (Join-Path $PSScriptRoot "normalize-susy-recipedump.mjs"),
  $RecipedumpPath,
  (Join-Path $DatasetOutDir "recipes.json")
)

Write-Log "Applying rendered HEI icons to the normalized dataset."
Invoke-NodeStep @(
  (Join-Path $PSScriptRoot "apply-susy-icons.mjs"),
  (Join-Path $DatasetOutDir "recipes.json"),
  $RenderedIconDir,
  $DatasetOutDir,
  "/datasets/susy"
)

Write-Log "Building resource and recipe indexes."
Invoke-NodeStep @(
  (Join-Path $RepoRoot "tools\dataset-pipeline\scripts\build-resource-index.mjs"),
  (Join-Path $DatasetOutDir "recipes.json")
)
Invoke-NodeStep @(
  (Join-Path $RepoRoot "tools\dataset-pipeline\scripts\build-recipe-index.mjs"),
  (Join-Path $DatasetOutDir "recipes.json"),
  $DatasetOutDir
)

# The manifest stage needs a compressed dataset whose top-level keys stay
# one-per-line; gzip the line-oriented file only after the index builders ran.
$recipesPath = Join-Path $DatasetOutDir "recipes.json"
$gzPath = "$recipesPath.gz"
$inputStream = [System.IO.File]::OpenRead($recipesPath)
try {
  $gzStream = [System.IO.File]::Create($gzPath)
  try {
    $gzip = New-Object System.IO.Compression.GzipStream($gzStream, [System.IO.Compression.CompressionLevel]::Optimal)
    try { $inputStream.CopyTo($gzip) } finally { $gzip.Dispose() }
  } finally { $gzStream.Dispose() }
} finally { $inputStream.Dispose() }

Write-Log "Rebuilding datasets manifest."
$env:DATASETS_ROOT = Split-Path -Parent $DatasetOutDir
Invoke-NodeStep @((Join-Path $RepoRoot "tools\dataset-pipeline\scripts\rebuild-manifest.mjs"))

Write-Log "SUSY export completed."
