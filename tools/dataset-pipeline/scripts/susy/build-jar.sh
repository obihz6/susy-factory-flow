#!/usr/bin/env bash
# susy-hei-oracle jar builder (Linux/macOS counterpart of build-jar.ps1).
#
# The mod is a ForgeGradle 2.3 project (MC 1.12.2), which only runs on a
# Gradle 4.x driven by a JDK 8 — whatever java/gradle the machine has on
# PATH is irrelevant and usually too new. Instead of asking for a manual
# setup, this script provisions both tools into <repo>/temp/susy-build on
# first use (cached across builds; override with SUSY_BUILD_TOOLCHAIN_DIR)
# and then runs the build against tools/dataset-pipeline/susy-hei-oracle.
#
# Usage:
#   ./build-jar.sh
#   ./build-jar.sh --clean          # gradle clean first
#
# Output: <mod>/build/libs/susy-hei-oracle-<version>.jar — exactly where the
# SUSY export runner's findOracleJar looks, so after this script the export
# just works.

set -euo pipefail

# A Linux JDK cannot execute under MSYS/Cygwin; send Windows users next door
# instead of failing deep inside the Gradle launcher with a cryptic message.
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    echo "This is the Linux/macOS builder; on Windows use:" >&2
    echo "  powershell -ExecutionPolicy Bypass -File build-jar.ps1" >&2
    exit 1 ;;
esac

CLEAN=0
case "${1:-}" in
  --clean|-Clean) CLEAN=1 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
MOD_DIR="$REPO_ROOT/tools/dataset-pipeline/susy-hei-oracle"
[ -f "$MOD_DIR/build.gradle" ] || { echo "susy-hei-oracle mod not found at $MOD_DIR" >&2; exit 1; }
TOOLCHAIN_DIR="${SUSY_BUILD_TOOLCHAIN_DIR:-$REPO_ROOT/temp/susy-build}"
mkdir -p "$TOOLCHAIN_DIR"

JDK_URL="https://api.adoptium.net/v3/binary/latest/8/ga/linux/x64/jdk/hotspot/normal/eclipse?project=jdk"
JDK_TARBALL="$TOOLCHAIN_DIR/jdk8.tar.gz"
JDK_HOME="$TOOLCHAIN_DIR/jdk8"

GRADLE_VERSION="4.10.3"
GRADLE_URL="https://services.gradle.org/distributions/gradle-$GRADLE_VERSION-bin.zip"
GRADLE_ZIP="$TOOLCHAIN_DIR/gradle-$GRADLE_VERSION-bin.zip"
GRADLE_HOME="$TOOLCHAIN_DIR/gradle-$GRADLE_VERSION"

fetch() {
  local url="$1" out="$2" label="$3"
  if [ -f "$out" ]; then return 0; fi
  echo "Downloading $label..."
  curl -fsSL "$url" -o "$out"
}

install_jdk8() {
  if [ -x "$JDK_HOME/bin/java" ]; then return 0; fi
  fetch "$JDK_URL" "$JDK_TARBALL" "Temurin JDK 8"
  local staging="$TOOLCHAIN_DIR/.jdk-staging"
  rm -rf "$staging"; mkdir -p "$staging"
  # Adoptium tarballs wrap the home in a versioned folder whose name drifts; take it.
  tar -xzf "$JDK_TARBALL" -C "$staging"
  local inner
  inner="$(dirname "$(dirname "$(find "$staging" -type f -name java -path "*/bin/java" | head -n1)")")"
  [ -d "$inner" ] || { echo "No bin/java inside $JDK_TARBALL." >&2; exit 1; }
  rm -rf "$JDK_HOME"
  mv "$inner" "$JDK_HOME"
  rm -rf "$staging"
}

unzip_to() {
  local zip="$1" dest="$2"
  if command -v unzip >/dev/null 2>&1; then
    unzip -q "$zip" -d "$dest"
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$zip" "$dest" <<'PYEOF'
import sys, zipfile
zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])
PYEOF
  else
    echo "Need 'unzip' or 'python3' to unpack $zip." >&2
    exit 1
  fi
}

install_gradle() {
  if [ -x "$GRADLE_HOME/bin/gradle" ]; then return 0; fi
  fetch "$GRADLE_URL" "$GRADLE_ZIP" "Gradle $GRADLE_VERSION"
  local staging="$TOOLCHAIN_DIR/.gradle-staging"
  rm -rf "$staging"; mkdir -p "$staging"
  unzip_to "$GRADLE_ZIP" "$staging"
  local inner
  inner="$(dirname "$(dirname "$(find "$staging" -type f -name gradle -path "*/bin/gradle" | head -n1)")")"
  [ -d "$inner" ] || { echo "No bin/gradle inside $GRADLE_ZIP." >&2; exit 1; }
  rm -rf "$GRADLE_HOME"
  mv "$inner" "$GRADLE_HOME"
  rm -rf "$staging"
}

install_jdk8
install_gradle

export JAVA_HOME="$JDK_HOME"
echo "Building susy-hei-oracle with Gradle $GRADLE_VERSION on $JDK_HOME..."

cd "$MOD_DIR"
if [ "$CLEAN" -eq 1 ]; then
  "$GRADLE_HOME/bin/gradle" clean --no-daemon
fi
"$GRADLE_HOME/bin/gradle" build --no-daemon

found=0
for jar in "$MOD_DIR"/build/libs/*.jar; do
  [ -e "$jar" ] || continue
  case "$jar" in *-sources.jar) continue ;; esac
  echo "Oracle jar ready: $jar"
  found=1
done
[ "$found" -eq 1 ] || { echo "Build succeeded but no jar landed in build/libs." >&2; exit 1; }
