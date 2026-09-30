#requires -Version 5.1
# susy-hei-oracle jar builder.
#
# The mod is a ForgeGradle 2.3 project (MC 1.12.2), which only runs on a
# Gradle 4.x driven by a JDK 8 — whatever java.exe/gradle the machine has on
# PATH is irrelevant and usually too new. Instead of asking for a manual
# setup, this script provisions both tools into <repo>\temp\susy-build on
# first use (cached across builds; override with SUSY_BUILD_TOOLCHAIN_DIR)
# and then runs the build against tools\dataset-pipeline\susy-hei-oracle.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File build-jar.ps1
#   powershell -ExecutionPolicy Bypass -File build-jar.ps1 -Clean   # gradle clean first
#
# Output: <mod>\build\libs\susy-hei-oracle-<version>.jar — exactly where the
# SUSY export runner's findOracleJar looks, so after this script the export
# just works. Invoked automatically by run-all.ps1 when the jar is missing.

param([switch]$Clean)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # PS 5.1 renders progress bars per byte; skip that.

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..\..")).Path
$ModDir = Join-Path $RepoRoot "tools\dataset-pipeline\susy-hei-oracle"
if (-not (Test-Path -LiteralPath (Join-Path $ModDir "build.gradle"))) {
  throw "susy-hei-oracle mod not found at $ModDir"
}

$ToolchainDir = $env:SUSY_BUILD_TOOLCHAIN_DIR
if (-not $ToolchainDir) { $ToolchainDir = Join-Path $RepoRoot "temp\susy-build" }
New-Item -ItemType Directory -Force -Path $ToolchainDir | Out-Null

$JdkUrl = "https://api.adoptium.net/v3/binary/latest/8/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk"
$JdkZip = Join-Path $ToolchainDir "jdk8.zip"
$JdkHome = Join-Path $ToolchainDir "jdk8"

$GradleVersion = "4.10.3"
$GradleUrl = "https://services.gradle.org/distributions/gradle-$GradleVersion-bin.zip"
$GradleZip = Join-Path $ToolchainDir "gradle-$GradleVersion-bin.zip"
$GradleHome = Join-Path $ToolchainDir "gradle-$GradleVersion"

function Get-ToolZip {
  param([string]$Url, [string]$ZipPath, [string]$Label)
  if (Test-Path -LiteralPath $ZipPath) { return }
  Write-Host "Downloading $Label..."
  Invoke-WebRequest -Uri $Url -OutFile $ZipPath
}

function Install-Jdk8 {
  if (Test-Path -LiteralPath (Join-Path $JdkHome "bin\java.exe")) { return }
  Get-ToolZip -Url $JdkUrl -ZipPath $JdkZip -Label "Temurin JDK 8"
  $staging = Join-Path $ToolchainDir ".jdk-staging"
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
  Expand-Archive -Path $JdkZip -DestinationPath $staging -Force
  # Adoptium zips wrap the home in a versioned folder whose name drifts; take it.
  $inner = Get-ChildItem -LiteralPath $staging -Directory |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "bin\java.exe") } |
    Select-Object -First 1
  if (-not $inner) { throw "No java.exe found inside $JdkZip." }
  if (Test-Path -LiteralPath $JdkHome) { Remove-Item -LiteralPath $JdkHome -Recurse -Force }
  Move-Item -LiteralPath $inner.FullName -Destination $JdkHome
  Remove-Item -LiteralPath $staging -Recurse -Force
}

function Install-Gradle {
  if (Test-Path -LiteralPath (Join-Path $GradleHome "bin\gradle.bat")) { return }
  Get-ToolZip -Url $GradleUrl -ZipPath $GradleZip -Label "Gradle $GradleVersion"
  $staging = Join-Path $ToolchainDir ".gradle-staging"
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
  Expand-Archive -Path $GradleZip -DestinationPath $staging -Force
  $inner = Get-ChildItem -LiteralPath $staging -Directory |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "bin\gradle.bat") } |
    Select-Object -First 1
  if (-not $inner) { throw "No gradle.bat found inside $GradleZip." }
  if (Test-Path -LiteralPath $GradleHome) { Remove-Item -LiteralPath $GradleHome -Recurse -Force }
  Move-Item -LiteralPath $inner.FullName -Destination $GradleHome
  Remove-Item -LiteralPath $staging -Recurse -Force
}

Install-Jdk8
Install-Gradle

$env:JAVA_HOME = $JdkHome
Write-Host "Building susy-hei-oracle with Gradle $GradleVersion on $($JdkHome)..."

Push-Location -LiteralPath $ModDir
try {
  if ($Clean) {
    & (Join-Path $GradleHome "bin\gradle.bat") clean --no-daemon
    if ($LASTEXITCODE -ne 0) { throw "gradle clean failed (exit $LASTEXITCODE)." }
  }
  & (Join-Path $GradleHome "bin\gradle.bat") build --no-daemon
  if ($LASTEXITCODE -ne 0) { throw "gradle build failed (exit $LASTEXITCODE)." }
} finally {
  Pop-Location
}

$jars = Get-ChildItem -LiteralPath (Join-Path $ModDir "build\libs") -Filter "*.jar" -File |
  Where-Object { $_.Name -notlike "*-sources.jar" }
if (-not $jars) { throw "Build succeeded but no jar landed in build\libs." }

foreach ($jar in $jars) { Write-Host "Oracle jar ready: $($jar.FullName)" }
