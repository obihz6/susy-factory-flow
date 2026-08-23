#!/usr/bin/env bash
# SUSY dataset export runner: drives a local Supersymmetry 1.12.2 client with
# the susy-hei-oracle mod (HEI icon rendering + SusyCore /recipemapdump) and
# normalizes the resulting dump into a planner RecipeDataset.
#
# Modeled on run-gtnh-oracle-export.sh; simplified because SUSY exports run
# against a locally installed instance rather than a CI-downloaded pack.
#
# Required environment:
#   SUSY_INSTANCE_DIR           path to the local SUSY instance (contains mods/)
#   SUSY_DATASET_OUT_DIR        where recipes.json is written
#   SUSY_RAW_EXPORT_DIR         scratch dir for logs and recipedump.json
#   SUSY_DATASET_VERSION_ID     e.g. "0.1.16.7.1"
#   SUSY_DATASET_VERSION_LABEL  human label stored in the manifest
#
# Optional:
#   SUSY_HEI_ORACLE_JAR     prebuilt oracle jar; when unset, the newest jar
#                           under tools/dataset-pipeline/susy-hei-oracle/build/libs
#                           is used and must have been built beforehand.
#   SUSY_LAUNCH_COMMAND     client launch command override (default: auto-detect
#                           the instance's start script; falls back to xvfb-run).
#   SUSY_EXPORT_TIMEOUT_SECONDS  overall watchdog (default 14400)
set -euo pipefail

: "${SUSY_INSTANCE_DIR:?SUSY_INSTANCE_DIR is required}"
: "${SUSY_DATASET_OUT_DIR:?SUSY_DATASET_OUT_DIR is required}"
: "${SUSY_RAW_EXPORT_DIR:?SUSY_RAW_EXPORT_DIR is required}"
: "${SUSY_DATASET_VERSION_ID:?SUSY_DATASET_VERSION_ID is required}"
: "${SUSY_DATASET_VERSION_LABEL:?SUSY_DATASET_VERSION_LABEL is required}"

export SUSY_EXPORT_TIMEOUT_SECONDS="${SUSY_EXPORT_TIMEOUT_SECONDS:-14400}"

mkdir -p "$SUSY_DATASET_OUT_DIR" "$SUSY_RAW_EXPORT_DIR"

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
runtime_log="$SUSY_RAW_EXPORT_DIR/susy-runtime.log"
runner_log="$SUSY_RAW_EXPORT_DIR/export-runner.log"
recipedump_path="$(realpath -m "$SUSY_RAW_EXPORT_DIR/recipedump.json")"
rendered_icon_dir="$(realpath -m "$SUSY_RAW_EXPORT_DIR/rendered-icons")"

exec > >(tee -a "$runner_log") 2>&1

echo "SUSY export runner started at $(date -u --iso-8601=seconds)"
echo "Instance: $SUSY_INSTANCE_DIR"
echo "Dataset: $SUSY_DATASET_VERSION_ID ($SUSY_DATASET_VERSION_LABEL)"

oracle_jar="${SUSY_HEI_ORACLE_JAR:-}"
if [[ -z "$oracle_jar" ]]; then
  oracle_jar="$(
    find "$repo_root/tools/dataset-pipeline/susy-hei-oracle/build/libs" -maxdepth 1 \
      -type f -name '*.jar' ! -name '*-sources.jar' 2>/dev/null | sort | tail -n 1
  )"
fi
if [[ -z "$oracle_jar" || ! -f "$oracle_jar" ]]; then
  echo "No susy-hei-oracle jar found. Build the mod first or set SUSY_HEI_ORACLE_JAR." >&2
  exit 1
fi
echo "Oracle jar: $oracle_jar"

instance_mods="$SUSY_INSTANCE_DIR/mods"
mkdir -p "$instance_mods"
find "$instance_mods" -maxdepth 1 -type f -iname 'susy*hei*oracle*.jar' -print -delete
cp "$oracle_jar" "$instance_mods/"
mkdir -p "$rendered_icon_dir"

if [[ -f "$SUSY_INSTANCE_DIR/options.txt" ]]; then
  sed -i 's/^pauseWhenEmpty:.*/pauseWhenEmpty:false/' "$SUSY_INSTANCE_DIR/options.txt" || true
fi

export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-} \
-Dsusy.oracle.autorun=true \
-Dsusy.oracle.dumpRecipes=true \
-Dsusy.oracle.recipedumpPath=$recipedump_path \
-Dsusy.oracle.iconDir=$rendered_icon_dir"

if [[ -n "${SUSY_LAUNCH_COMMAND:-}" ]]; then
  runtime_command="$SUSY_LAUNCH_COMMAND"
else
  start_script="$(
    find "$SUSY_INSTANCE_DIR" -maxdepth 2 -type f \( -iname '*start*.sh' -o -iname 'launch*.sh' -o -iname '*.bat' \) \
      | sort | head -n 1
  )"
  if [[ -n "$start_script" && ${start_script##*.} == "sh" ]]; then
    chmod +x "$start_script"
    runtime_command="bash '$(realpath "$start_script")'"
  else
    runtime_command="xvfb-run -a bash -lc 'cd \"$SUSY_INSTANCE_DIR\" && java -jar binClient-modified.jar nogui'"
    echo "No start script found; falling back to: $runtime_command"
  fi
fi

setsid bash -lc "cd '$SUSY_INSTANCE_DIR' && $runtime_command" >>"$runtime_log" 2>&1 &
runtime_pid=$!
tail -n 0 -f "$runtime_log" &
tail_pid=$!

stop_runtime() {
  kill "$tail_pid" 2>/dev/null || true
  if [[ -n "${runtime_pid:-}" ]]; then
    kill -TERM "-$runtime_pid" 2>/dev/null || true
    sleep 5
    kill -KILL "-$runtime_pid" 2>/dev/null || true
  fi
}
trap stop_runtime EXIT

deadline=$((SECONDS + SUSY_EXPORT_TIMEOUT_SECONDS))
dump_ready=0
while (( SECONDS < deadline )); do
  if grep -Eqi 'Minecraft Crash Report|Fatal errors were detected' "$runtime_log"; then
    echo "Susy client crashed before completing the export." >&2
    tail -n 120 "$runtime_log" >&2 || true
    exit 1
  fi
  if [[ -f "$recipedump_path" ]]; then
    size_before="$(stat -c%s "$recipedump_path")"
    sleep 5
    size_after="$(stat -c%s "$recipedump_path")"
    if [[ "$size_before" == "$size_after" && "$size_after" -gt 2 ]]; then
      # The client exits itself after the dump settles; give it a moment.
      if ! kill -0 "$runtime_pid" 2>/dev/null; then
        dump_ready=1
        break
      fi
      sleep 15
      if ! kill -0 "$runtime_pid" 2>/dev/null; then
        dump_ready=1
        break
      fi
      echo "recipedump.json present but the client is still running; waiting for its own exit."
    fi
  fi
  if ! kill -0 "$runtime_pid" 2>/dev/null; then
    wait "$runtime_pid" || true
    [[ -f "$recipedump_path" ]] && { dump_ready=1; break; }
    echo "Susy client exited without producing $recipedump_path." >&2
    exit 1
  fi
  sleep 5
done

stop_runtime
trap - EXIT

if (( dump_ready != 1 )); then
  echo "Timed out waiting for $recipedump_path." >&2
  exit 1
fi

echo "Normalizing SusyCore recipedump into the planner dataset."
node "$repo_root/tools/dataset-pipeline/scripts/susy/normalize-susy-recipedump.mjs" \
  "$recipedump_path" "$SUSY_DATASET_OUT_DIR/recipes.json"

echo "Building resource and recipe indexes."
node "$repo_root/tools/dataset-pipeline/scripts/build-resource-index.mjs" \
  "$SUSY_DATASET_OUT_DIR/recipes.json"
node "$repo_root/tools/dataset-pipeline/scripts/build-recipe-index.mjs" \
  "$SUSY_DATASET_OUT_DIR/recipes.json" "$SUSY_DATASET_OUT_DIR"

# The manifest stage needs a compressed dataset whose top-level keys stay
# one-per-line; gzip the line-oriented file only after the index builders ran.
gzip -c "$SUSY_DATASET_OUT_DIR/recipes.json" > "$SUSY_DATASET_OUT_DIR/recipes.json.gz"
DATASETS_ROOT="$(dirname "$SUSY_DATASET_OUT_DIR")" \
  node "$repo_root/tools/dataset-pipeline/scripts/rebuild-manifest.mjs"

echo "SUSY export completed."
