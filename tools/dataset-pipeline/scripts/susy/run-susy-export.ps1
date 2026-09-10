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

$RunnerRawExportDir = if ($env:SUSY_RAW_EXPORT_DIR) { [System.IO.Path]::GetFullPath($env:SUSY_RAW_EXPORT_DIR) } else { Join-Path $RepoRoot "temp\raw-export" }
$RunnerLog = Join-Path $RunnerRawExportDir "export-runner.log"
$PreviousClientPidFile = Join-Path $RunnerRawExportDir "previous-client.pid"
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
$Java8 = if ($env:SUSY_JAVA_8) { $env:SUSY_JAVA_8 } elseif ($resolved.java8) { $resolved.java8 } else { $null }
if (-not $Java8 -or -not (Test-Path -LiteralPath $Java8)) {
  Fail "Java 8 was not resolved before the instance launch. Set SUSY_JAVA_8 or rerun the bootstrap."
}
$env:JAVA_HOME = Split-Path -Parent (Split-Path -Parent $Java8)
$env:Path = "$(Split-Path -Parent $Java8);$env:Path"
$InstanceLogPath = Join-Path $InstanceDir "logs\latest.log"

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
$RunId = [guid]::NewGuid().ToString("N")
$OracleGameDumpPath = Join-Path $InstanceDir "recipedump.json"

# Kill any client launched by a previous attempt that may still be running.
if (Test-Path -LiteralPath $PreviousClientPidFile) {
  $previousPid = Get-Content -LiteralPath $PreviousClientPidFile -ErrorAction SilentlyContinue
  if ($previousPid -and $previousPid -match '^\d+$') {
    $existingProc = Get-Process -Id $previousPid -ErrorAction SilentlyContinue
    if ($existingProc) {
      Write-Log "Killing previously launched client (PID $previousPid) from a failed attempt."
      Stop-Process -Id $previousPid -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
      if (Get-Process -Id $previousPid -ErrorAction SilentlyContinue) {
        Write-Log "WARNING: Could not kill previous client PID $previousPid; the oracle jar may remain locked."
      }
    }
  }
  Remove-Item -LiteralPath $PreviousClientPidFile -Force -ErrorAction SilentlyContinue
}

# Never accept a dump or icon map from an earlier run as this run's result.
Remove-Item -LiteralPath $RecipedumpPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $OracleGameDumpPath -Force -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $RenderedIconDir) {
  Remove-Item -LiteralPath $RenderedIconDir -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $RenderedIconDir | Out-Null

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
Write-Log "Copied oracle jar to: $(Join-Path $instanceMods (Split-Path -Leaf $OracleJar))"

# Verify the oracle jar is in the mods folder.
$modsAfterCopy = Get-ChildItem -LiteralPath $instanceMods -Filter "susy*hei*oracle*.jar" -File -ErrorAction SilentlyContinue
if (-not $modsAfterCopy) {
  Fail "Oracle jar was not found in mods folder after copy! Check: $instanceMods"
}
Write-Log "Verified: Oracle jar present in mods folder: $($modsAfterCopy.FullName)"

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
  "-Dsusy.oracle.runId=$RunId -Dsusy.oracle.recipedumpPath=`"$RecipedumpPath`" -Dsusy.oracle.iconDir=`"$RenderedIconDir`""
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

function Find-LauncherExecutable {
  foreach ($name in @("prismlauncher.exe", "PrismLauncher.exe", "prismlauncher", "PrismLauncher")) {
    $command = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) {
      if ($command.Source) { return $command.Source }
      return $command.Path
    }
  }

  foreach ($candidate in @(
    (Join-Path ${env:ProgramFiles} "PrismLauncher\prismlauncher.exe"),
    (Join-Path ${env:ProgramFiles} "PrismLauncher\PrismLauncher.exe"),
    (Join-Path ${env:LOCALAPPDATA} "Programs\PrismLauncher\prismlauncher.exe"),
    (Join-Path ${env:LOCALAPPDATA} "Programs\PrismLauncher\PrismLauncher.exe")
  )) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  return $null
}

# Prism launches the game in a child process and the `-l` request commonly
# exits as soon as that request has been handed to the already-running Prism
# GUI. JAVA_TOOL_OPTIONS is not guaranteed to be forwarded by every Prism
# installation, so put the oracle properties in the instance JVM arguments for
# this launch and restore the file in the finally block below.
$script:PrismInstanceConfigPath = $null
$script:PrismInstanceConfigOriginal = $null

# Also set JAVA_TOOL_OPTIONS as a fallback - some Prism versions forward this.
$env:JAVA_TOOL_OPTIONS = "-Dsusy.oracle.autorun=true -Dsusy.oracle.dumpRecipes=true -Dsusy.oracle.runId=$RunId -Dsusy.oracle.recipedumpPath=$RecipedumpPath -Dsusy.oracle.iconDir=$RenderedIconDir"
Write-Log "Set JAVA_TOOL_OPTIONS for oracle: $env:JAVA_TOOL_OPTIONS"

function Set-PrismOracleJvmArguments {
  if (-not $resolved.prismInstanceId) { return }
  $wrapperDir = Split-Path -Parent $InstanceDir
  $configPath = Join-Path $wrapperDir "instance.cfg"
  if (-not (Test-Path -LiteralPath $configPath)) {
    Write-Log "Prism instance.cfg was not found at $configPath; relying on JAVA_TOOL_OPTIONS."
    return
  }

  $original = [System.IO.File]::ReadAllText($configPath)
  $script:PrismInstanceConfigPath = $configPath
  $script:PrismInstanceConfigOriginal = $original

  # Delegate the INI rewrite to Node so the Windows and Unix runners use the
  # same section-aware implementation and the same path normalization rules.
  $patcher = Join-Path $PSScriptRoot "patch-prism-instance.mjs"
  $patchOutput = & node $patcher `
    --config $configPath `
    --run-id $RunId `
    --recipedump-path $RecipedumpPath `
    --icon-dir $RenderedIconDir
  if ($LASTEXITCODE -ne 0) {
    Fail "Could not patch Prism [General] oracle JVM settings in instance.cfg."
  }
  Write-Log "Configured oracle JVM arguments in [General] of Prism instance.cfg (OverrideJavaArgs=true)."
  Write-Log "Verified: Prism [General] contains slash-safe oracle JVM args."
}

function Restore-PrismJvmArguments {
  if ($script:PrismInstanceConfigPath -and $null -ne $script:PrismInstanceConfigOriginal) {
    try {
      [System.IO.File]::WriteAllText($script:PrismInstanceConfigPath, $script:PrismInstanceConfigOriginal)
      Write-Log "Restored the original Prism instance.cfg JVM arguments."
    } catch {
      Write-Log "WARNING: Could not restore ${script:PrismInstanceConfigPath}: $($_.Exception.Message)"
    }
  }
}

function Get-InstanceLogPath {
  if (Test-Path -LiteralPath $InstanceLogPath) { return $InstanceLogPath }
  return $null
}

function Get-SusyJavaProcesses {
  # Cleanroom relaunches the original java.exe into a second JVM. Killing only
  # javaw.exe leaves that child alive, locks latest.log, and makes the next
  # retry exit before Forge can write a useful crash report. Restrict the
  # query to this instance path so unrelated Java applications are untouched.
  $needle = ([System.IO.Path]::GetFullPath($InstanceDir)).Replace("'", "''")
  try {
    return @(Get-CimInstance Win32_Process -Filter "Name = 'java.exe' OR Name = 'javaw.exe'" |
      Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 })
  } catch {
    return @()
  }
}

function Stop-SusyJavaProcesses {
  foreach ($javaProcess in @(Get-SusyJavaProcesses)) {
    Write-Log "Stopping stale SUSY Java process PID $($javaProcess.ProcessId)."
    & taskkill /PID $javaProcess.ProcessId /T /F 2>$null | Out-Null
  }
}

function Write-LaunchDiagnostics {
  param([string]$Reason)
  Write-Log $Reason
  foreach ($diagnosticFile in @($RuntimeLog, $RuntimeErrLog, (Get-InstanceLogPath))) {
    if ($diagnosticFile -and (Test-Path -LiteralPath $diagnosticFile)) {
      Write-Log "Last 80 lines from ${diagnosticFile}:"
      Get-Content -LiteralPath $diagnosticFile -Tail 80 | ForEach-Object { Write-Log $_ }
    }
  }
}

function Find-SusyClientProcess {
  # Cleanroom starts a second javaw.exe a few seconds after the generated
  # launcher invokes java.exe. Poll instead of checking once: on a fast wrapper
  # exit the old implementation reported a false launch failure and the
  # orchestrator retried while the real client was still booting.
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    foreach ($javaProcess in @(Get-SusyJavaProcesses)) {
      $process = Get-Process -Id $javaProcess.ProcessId -ErrorAction SilentlyContinue
      if ($process) { return $process }
    }
    if ($attempt -lt 19) { Start-Sleep -Seconds 1 }
  }
  return $null
}

$launcherManaged = [bool]$resolved.prismInstanceId -and [string]::IsNullOrWhiteSpace($env:SUSY_LAUNCH_COMMAND)

# A failed Cleanroom start can leave either the original java.exe or the
# relaunched javaw.exe alive. Clear only processes whose command line belongs
# to this instance before replacing the oracle jar or starting another client.
if (-not $launcherManaged) {
  Stop-SusyJavaProcesses
}

# Kill any existing Prism process so it picks up the new JVM args.
if ($launcherManaged) {
  Write-Log "Checking for existing Prism processes..."
  $existingPrism = Get-Process -Name "PrismLauncher" -ErrorAction SilentlyContinue
  if ($existingPrism) {
    Write-Log "Killing existing Prism process (PID $($existingPrism.Id)) to ensure clean launch with oracle JVM args."
    Stop-Process -Name "PrismLauncher" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
    if (Get-Process -Name "PrismLauncher" -ErrorAction SilentlyContinue) {
      Write-Log "WARNING: Could not kill existing Prism process. The oracle may not be loaded."
    }
  }
}

if ($launcherManaged) { Set-PrismOracleJvmArguments }
$proc = $null
$launchDesc = ""
$launchStartedAt = Get-Date
$handoffStartedAt = $null
$oracleSeen = $false
$clientLaunched = $false
try {
  if ($env:SUSY_LAUNCH_COMMAND) {
    $launchDesc = $env:SUSY_LAUNCH_COMMAND
    Write-Log "Launch (override): $launchDesc"
    $proc = Start-Process -FilePath "cmd.exe" `
      -ArgumentList @("/d", "/s", "/c", "`"$env:SUSY_LAUNCH_COMMAND`"") `
      -WorkingDirectory $InstanceDir -PassThru `
      -RedirectStandardOutput $RuntimeLog -RedirectStandardError $RuntimeErrLog -WindowStyle Hidden
  } else {
    if ($launcherManaged) {
      $launcher = Find-LauncherExecutable
      if (-not $launcher) {
        Fail "This is a Prism-managed instance, but Prism Launcher was not found. Set SUSY_LAUNCH_COMMAND to the Prism executable and launch arguments."
      }
      $launchDesc = "`"$launcher`" -l `"$($resolved.prismInstanceId)`""
      Write-Log "Launch through Prism: $launchDesc"
      $proc = Start-Process -FilePath $launcher `
        -ArgumentList @("-l", $resolved.prismInstanceId) `
        -WorkingDirectory $InstanceDir -PassThru `
        -RedirectStandardOutput $RuntimeLog -RedirectStandardError $RuntimeErrLog -WindowStyle Hidden
    } else {
      $startScript = Find-StartScript
      if ($startScript -and ($startScript.EndsWith(".cmd") -or $startScript.EndsWith(".bat"))) {
        $launchDesc = "cmd.exe /c `"$startScript`""
        Write-Log "Launch: $launchDesc"
        # Use CALL with /s so cmd preserves quoted paths containing spaces and
        # parentheses (for example a cloned repo under Downloads). Without
        # CALL, cmd can return immediately after parsing a quoted batch path;
        # the runner then mistakes that wrapper exit for a failed Minecraft
        # launch and loses the useful child error output.
        $proc = Start-Process -FilePath "cmd.exe" `
          -ArgumentList @("/d", "/s", "/c", "call `"$startScript`"") `
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
        $launchDesc = "`"$Java8`" -jar binClient-modified.jar nogui"
        Write-Log "No start script found; falling back to: $launchDesc"
        $proc = Start-Process -FilePath $Java8 `
          -ArgumentList @("-jar", "binClient-modified.jar", "nogui") `
          -WorkingDirectory $InstanceDir -PassThru `
          -RedirectStandardOutput $RuntimeLog -RedirectStandardError $RuntimeErrLog -WindowStyle Hidden
      }
    }
  }

  # Prism may hand the launch request to an already-running launcher process,
  # so the short-lived CLI process is not evidence that the game failed. The
  # instance log and requested dump, not this process, are the source of truth.
  if (-not $proc) {
    Write-LaunchDiagnostics "The SUSY client launch did not return a process."
    Fail "Could not start the SUSY client. Check $RuntimeErrLog."
  }
  if ($proc.HasExited -and -not $launcherManaged) {
    # A batch file can be only a wrapper: cmd may finish while Cleanroom has
    # already relaunched the actual Java process. Track that process instead of
    # treating the wrapper's short lifetime as a failed Minecraft launch.
    $replacement = Find-SusyClientProcess
    if ($replacement) {
      Write-Log "Launch wrapper PID $($proc.Id) exited; tracking SUSY Java PID $($replacement.Id)."
      $proc = $replacement
    } else {
      # Do not fail here. The Java/Javaw handoff is asynchronous and can take
      # longer than the cmd wrapper lifetime on a cold first boot. The
      # watchdog below will keep polling for the child and will print the
      # actual runtime/instance log if no child appears.
      Write-Log "Launch wrapper PID $($proc.Id) exited; waiting for the Cleanroom Java child."
    }
  }
  Write-Log "Launcher/client PID: $($proc.Id)"
  $clientLaunched = $true
  # Record the PID so a retry can kill this client if needed.
  $proc.Id | Set-Content -LiteralPath $PreviousClientPidFile -Force
  if ($launcherManaged) {
    # The Prism CLI process is not the Minecraft process. It may remain alive
    # as the Prism GUI, or exit immediately after handing the request off, so
    # never use its lifetime as the extraction watchdog.
    $handoffStartedAt = Get-Date
    Write-Log "Prism launch request submitted; monitoring the managed client and instance log."
  }

  # --- Watchdog loop -----------------------------------------------------------

  $timeoutSeconds = 14400
  if ($env:SUSY_EXPORT_TIMEOUT_SECONDS) { $timeoutSeconds = [int]$env:SUSY_EXPORT_TIMEOUT_SECONDS }
  $deadline = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)
  $dumpReady = $false

  while ([DateTime]::UtcNow -lt $deadline) {
    foreach ($logFile in @($RuntimeLog, $RuntimeErrLog, (Get-InstanceLogPath))) {
      if ($logFile -and (Test-Path -LiteralPath $logFile) -and
          (Select-String -LiteralPath $logFile -Pattern "Minecraft Crash Report|Fatal errors were detected" -Quiet)) {
        Write-Log "Susy client/oracle reported a failure before completing the export."
        Get-Content -LiteralPath $logFile -Tail 120 | ForEach-Object { Write-Log $_ }
        exit 1
      }
    }

    $instanceLog = Get-InstanceLogPath
    if ($instanceLog -and -not $oracleSeen -and
        (Select-String -LiteralPath $instanceLog -Pattern "SUSY HEI oracle run $RunId (client autorun handler registered|export started)" -Quiet)) {
      $oracleSeen = $true
      Write-Log "SUSY HEI oracle run $RunId is running inside the Prism client."
    }

    # Log progress every 30 seconds to show the script is still waiting.
    if ($handoffStartedAt -and (Get-Date).Second % 30 -eq 0) {
      $elapsed = ((Get-Date) - $handoffStartedAt).TotalSeconds
      Write-Log "Waiting for oracle... elapsed: $([math]::Round($elapsed, 1))s"
    }

    if (Test-Path -LiteralPath $RecipedumpPath) {
      $sizeBefore = (Get-Item -LiteralPath $RecipedumpPath).Length
      Start-Sleep -Seconds 5
      $sizeAfter = (Get-Item -LiteralPath $RecipedumpPath).Length
      if ($sizeBefore -eq $sizeAfter -and $sizeAfter -gt 2) {
        # The client exits itself after the dump settles; give it a moment.
        # Prism itself can remain open after the game exits, so a settled dump
        # is sufficient for launcher-managed instances.
        if ($proc.HasExited) {
          if ($launcherManaged) { $dumpReady = $true; break }
          $dumpReady = $true
          break
        }
        Start-Sleep -Seconds 15
        if ($launcherManaged -or $proc.HasExited) { $dumpReady = $true; break }
        Write-Log "recipedump.json present but the client is still running; waiting for its own exit."
      }
    }

      if ($proc.HasExited) {
      $proc.WaitForExit()
      if (Test-Path -LiteralPath $RecipedumpPath) { $dumpReady = $true; break }
      if (-not $launcherManaged) {
        $replacement = Find-SusyClientProcess
        if ($replacement) {
          Write-Log "Tracked client PID $($proc.Id) exited; continuing with SUSY Java PID $($replacement.Id)."
          $proc = $replacement
        } else {
          # Never conclude that a standalone launch failed merely because the
          # cmd wrapper exited. Find-SusyClientProcess polls through the
          # Cleanroom relaunch window; only after the wrapper has been gone for
          # a full watchdog interval do we report the collected diagnostics.
          Write-Log "No SUSY Java child is visible yet; continuing to wait for the launch handoff."
        }
      }
    }

    if (-not $launcherManaged -and $proc.HasExited -and -not (Find-SusyClientProcess)) {
      $launchWaitSeconds = ((Get-Date) - $launchStartedAt).TotalSeconds
      if ($launchWaitSeconds -gt 90) {
        Write-LaunchDiagnostics "Standalone launch wrapper exited and no SUSY Java child appeared after $([math]::Round($launchWaitSeconds, 1)) seconds."
        Fail "Susy client failed to start. Check $RuntimeErrLog and the instance log above."
      }
    }

    if ($launcherManaged -and $handoffStartedAt) {
      $handoffSeconds = ((Get-Date) - $handoffStartedAt).TotalSeconds
      if ($handoffSeconds -gt 600 -and -not $oracleSeen) {
        $logHint = Get-InstanceLogPath
        if ($logHint -and (Test-Path -LiteralPath $logHint)) {
          Write-Log "Last 120 lines from the Prism instance log:"
          Get-Content -LiteralPath $logHint -Tail 120 | ForEach-Object { Write-Log $_ }
        }
        Fail "Prism accepted the launch request, but the SUSY oracle was not seen in the instance log after 600 seconds (10 minutes). Confirm the oracle jar is enabled in Prism and inspect $logHint."
      }
      if ($handoffSeconds -gt 600) {
        Fail "Prism launched the instance, but no recipedump appeared after 600 seconds (10 minutes). Check $RuntimeErrLog and $(Get-InstanceLogPath)."
      }
    }

    Start-Sleep -Seconds 5
  }

  if (-not $dumpReady) {
    Fail "Timed out waiting for $RecipedumpPath. Check $(Get-InstanceLogPath)."
  }
} finally {
  Restore-PrismJvmArguments
  # Clean up the PID file on success so retries know there's no leftover client.
  if ($clientLaunched -and (Test-Path -LiteralPath $PreviousClientPidFile)) {
    Remove-Item -LiteralPath $PreviousClientPidFile -Force -ErrorAction SilentlyContinue
  }
  # Do not terminate Prism itself: for a launcher-managed instance `$proc` is
  # the Prism GUI/request process, not the Minecraft client.
  if ($proc -and -not $proc.HasExited -and -not $launcherManaged) {
    Write-Log "Stopping the SUSY client (PID $($proc.Id))..."
    & taskkill /PID $proc.Id /T /F 2>$null | Out-Null
    try { $proc.WaitForExit(10000) | Out-Null } catch {}
  }
}

# The local orchestrator uses this runner for the client-only extraction phase.
# Leave the raw dump and rendered icons under temp so later stages can resume
# without booting Minecraft again.
if ($env:SUSY_EXPORT_PHASE -eq "extract") {
  Write-Log "SUSY extraction completed; raw artifacts are in $RawExportDir."
  exit 0
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
