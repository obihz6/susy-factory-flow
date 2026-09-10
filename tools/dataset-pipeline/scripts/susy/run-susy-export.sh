#!/usr/bin/env bash
# SUSY dataset export runner: drives a local Supersymmetry 1.12.2 client with
# the susy-hei-oracle mod (HEI icon rendering + SusyCore /recipemapdump) and
# normalizes the resulting dump into a planner RecipeDataset.
#
# Modeled on run-gtnh-oracle-export.sh; simplified because SUSY exports run
# against a locally installed instance rather than a CI-downloaded pack.
#
# Required environment: none. The instance is resolved in this order:
#   1. SUSY_INSTANCE_DIR (explicit, validated)
#   2. auto-detected: ./temp/.minecraft, ./temp checkouts, known launcher
#      instance roots (Prism/PolyMC/MultiMC/ATLauncher/CurseForge/vanilla),
#      including Prism-style wrappers whose game dir lives one level down in
#      minecraft/ or .minecraft/
#   3. nothing found: a barebone instance is downloaded into ./temp/.minecraft
#      (bootstrap-susy-instance.mjs; SUSY_BOOTSTRAP=0 disables this)
#
# Launcher-managed instances (Prism & co) have no start script; the runner
# then launches through the launcher CLI itself (`flatpak run ... -l <id>` for
# a flatpak launcher, forwarding JAVA_TOOL_OPTIONS into the sandbox). The
# flatpak sandbox can only write inside its own app data, so when the instance
# lives under ~/.var/app/ the recipedump and rendered icons are produced
# beside the game dir and moved into SUSY_RAW_EXPORT_DIR afterwards.
#
# Optional:
#   SUSY_BOOTSTRAP_REF         pack ref for the bootstrap (release tag or
#                              branch; default: latest GitHub release)
#   SUSY_DATASET_OUT_DIR       where recipes.json is written
#                              (default public/datasets/susy/<version>)
#   SUSY_RAW_EXPORT_DIR        scratch dir for logs and recipedump.json
#                              (default temp/raw-export)
#   SUSY_DATASET_VERSION_ID    e.g. "0.1.16.14.1" (default: the instance's
#                              pack.toml version)
#   SUSY_DATASET_VERSION_LABEL human label stored in the manifest
#                              (default "SUSY <version>")
#   SUSY_HEI_ORACLE_JAR        prebuilt oracle jar; when unset, the newest jar
#                              under tools/dataset-pipeline/susy-hei-oracle or
#                              temp/susy-hei-oracle build/libs is used.
#   SUSY_LAUNCH_COMMAND        client launch command override (default: the
#                              instance's launch-susy-client.sh / start script).
#   SUSY_EXPORT_TIMEOUT_SECONDS  overall watchdog (default 14400)
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
resolver="$repo_root/tools/dataset-pipeline/scripts/susy/resolve-susy-instance.mjs"

resolver_args=()
if [[ -n "${SUSY_INSTANCE_DIR:-}" ]]; then resolver_args+=(--instance "$SUSY_INSTANCE_DIR"); fi
if [[ -n "${SUSY_BOOTSTRAP_REF:-}" ]]; then resolver_args+=(--ref "$SUSY_BOOTSTRAP_REF"); fi
if [[ "${SUSY_BOOTSTRAP:-1}" == "0" ]]; then resolver_args+=(--no-bootstrap); else resolver_args+=(--bootstrap-if-missing); fi

resolved="$(node "$resolver" "${resolver_args[@]}")"
eval "$resolved"
if [[ "${FOUND:-0}" != "1" ]]; then
  echo "No Supersymmetry instance available; refusing to guess." >&2
  exit 1
fi

: "${SUSY_INSTANCE_DIR:=$INSTANCEDIR}"
: "${SUSY_DATASET_VERSION_ID:=$VERSION}"
: "${SUSY_DATASET_VERSION_LABEL:=SUSY $VERSION}"
: "${SUSY_HEI_ORACLE_JAR:=${ORACLEJAR:-}}"
: "${SUSY_JAVA_8:=${JAVA8:-}}"
if [[ -z "$SUSY_JAVA_8" || ! -f "$SUSY_JAVA_8" ]]; then
  echo "Java 8 was not resolved before the client launch. Set SUSY_JAVA_8 or rerun the download step." >&2
  exit 1
fi
export JAVA_HOME="$(dirname "$(dirname "$SUSY_JAVA_8")")"
export PATH="$(dirname "$SUSY_JAVA_8"):$PATH"
: "${SUSY_DATASET_OUT_DIR:=$repo_root/public/datasets/susy/$SUSY_DATASET_VERSION_ID}"
: "${SUSY_RAW_EXPORT_DIR:=$repo_root/temp/raw-export}"
if [[ -z "${SUSY_LAUNCH_COMMAND:-}" && -n "${LAUNCHSCRIPT:-}" ]]; then
  SUSY_LAUNCH_COMMAND="bash '$LAUNCHSCRIPT'"
fi

: "${SUSY_DATASET_VERSION_ID:?SUSY_DATASET_VERSION_ID could not be derived from the instance}"
: "${SUSY_DATASET_VERSION_LABEL:?SUSY_DATASET_VERSION_LABEL could not be derived from the instance}"

export SUSY_EXPORT_TIMEOUT_SECONDS="${SUSY_EXPORT_TIMEOUT_SECONDS:-14400}"

mkdir -p "$SUSY_DATASET_OUT_DIR" "$SUSY_RAW_EXPORT_DIR"

runtime_log="$SUSY_RAW_EXPORT_DIR/susy-runtime.log"
runner_log="$SUSY_RAW_EXPORT_DIR/export-runner.log"

# A flatpak sandboxed launcher can only write inside its own app data, so the
# JVM-written artifacts must live beside the instance; the logs stay host-side
# because tee/tail run outside the sandbox.
case "$(realpath "$SUSY_INSTANCE_DIR")" in
  "$HOME"/.var/app/*) jvm_export_root="$SUSY_INSTANCE_DIR/.susy-oracle-export" ;;
  *) jvm_export_root="$SUSY_RAW_EXPORT_DIR" ;;
esac
mkdir -p "$jvm_export_root"
recipedump_path="$(realpath -m "$jvm_export_root/recipedump.json")"
rendered_icon_dir="$(realpath -m "$jvm_export_root/rendered-icons")"

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

# Prism only applies JvmArgs when OverrideJavaArgs=true. Without that flag the
# oracle jar is visible in the mod list, but `susy.oracle.autorun` is absent and
# the client simply opens the selected world — exactly the symptom this runner
# is meant to prevent. Back up the launcher config and restore it on exit so the
# export is non-destructive.
prism_instance_cfg=""
prism_instance_cfg_backup=""
restore_prism_instance_cfg() {
  if [[ -n "$prism_instance_cfg" && -n "$prism_instance_cfg_backup" && -f "$prism_instance_cfg_backup" ]]; then
    cp "$prism_instance_cfg_backup" "$prism_instance_cfg" 2>/dev/null || true
    rm -f "$prism_instance_cfg_backup"
  fi
}
# The runtime cleanup trap below also restores this file. Keep this early
# restore trap until the runtime process exists so failures during setup do not
# leave Prism configured with oracle arguments.
trap restore_prism_instance_cfg EXIT

run_id="$(date +%s)-$$"
if [[ -n "${PRISMINSTANCEID:-}" ]]; then
  prism_instance_cfg="$(dirname "$SUSY_INSTANCE_DIR")/instance.cfg"
  if [[ -f "$prism_instance_cfg" ]]; then
    prism_instance_cfg_backup="$(mktemp "${TMPDIR:-/tmp}/susy-instance.cfg.XXXXXX")"
    cp "$prism_instance_cfg" "$prism_instance_cfg_backup"
    # Use the shared Node patcher: instance.cfg is a QSettings INI file and
    # JvmArgs must be in [General]. Shell text insertion previously put it in
    # [UI] and mangled Windows backslashes.
    node "$repo_root/tools/dataset-pipeline/scripts/susy/patch-prism-instance.mjs" \
      --config "$prism_instance_cfg" \
      --run-id "$run_id" \
      --recipedump-path "$recipedump_path" \
      --icon-dir "$rendered_icon_dir"
    echo "Configured and verified Prism [General] oracle JVM arguments in $prism_instance_cfg."
  else
    echo "WARNING: Prism instance.cfg not found at $prism_instance_cfg; relying on JAVA_TOOL_OPTIONS."
  fi
fi

export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-} \
-Dsusy.oracle.autorun=true \
-Dsusy.oracle.dumpRecipes=true \
-Dsusy.oracle.runId=$run_id \
-Dsusy.oracle.recipedumpPath=$recipedump_path \
-Dsusy.oracle.iconDir=$rendered_icon_dir"

if [[ -z "${SUSY_LAUNCH_COMMAND:-}" && -n "${LAUNCHSCRIPT:-}" ]]; then
  SUSY_LAUNCH_COMMAND="bash '$LAUNCHSCRIPT'"
fi
if [[ -z "${SUSY_LAUNCH_COMMAND:-}" && -n "${PRISMINSTANCEID:-}" ]]; then
  # Launcher-managed instance (Prism/PolyMC/...): launch through the launcher
  # itself so it supplies Java, libraries and assets. A flatpak launcher needs
  # JAVA_TOOL_OPTIONS forwarded explicitly or the oracle never sees its flags.
  if [[ -n "${PRISMFLATPAKAPPID:-}" ]]; then
    SUSY_LAUNCH_COMMAND="flatpak run --env=\"JAVA_TOOL_OPTIONS=$JAVA_TOOL_OPTIONS\" '$PRISMFLATPAKAPPID' -l '$PRISMINSTANCEID'"
  else
    SUSY_LAUNCH_COMMAND="prismlauncher -l '$PRISMINSTANCEID'"
  fi
  echo "No start script; launching through the launcher CLI."
fi

if [[ -z "${SUSY_LAUNCH_COMMAND:-}" ]]; then
  start_script="$(
    find "$SUSY_INSTANCE_DIR" -maxdepth 2 -type f \( -iname '*start*.sh' -o -iname 'launch*.sh' -o -iname '*.bat' \) \
      | sort | head -n 1
  )"
  if [[ -n "$start_script" && ${start_script##*.} == "sh" ]]; then
    chmod +x "$start_script"
    SUSY_LAUNCH_COMMAND="bash '$(realpath "$start_script")'"
  else
    SUSY_LAUNCH_COMMAND="xvfb-run -a bash -lc 'cd \"$SUSY_INSTANCE_DIR\" && \"$SUSY_JAVA_8\" -jar binClient-modified.jar nogui'"
    echo "No start script found; falling back to: $SUSY_LAUNCH_COMMAND"
  fi
fi

setsid bash -lc "cd '$SUSY_INSTANCE_DIR' && $SUSY_LAUNCH_COMMAND" >>"$runtime_log" 2>&1 &
runtime_pid=$!
tail -n 0 -f "$runtime_log" &
tail_pid=$!

stop_runtime() {
  kill "${tail_pid:-}" 2>/dev/null || true
  if [[ -n "${runtime_pid:-}" ]]; then
    kill -TERM "-$runtime_pid" 2>/dev/null || true
    sleep 5
    kill -KILL "-$runtime_pid" 2>/dev/null || true
  fi
}
cleanup_runtime() {
  stop_runtime
  restore_prism_instance_cfg
}
trap cleanup_runtime EXIT

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
      if [[ -n "${PRISMINSTANCEID:-}" ]]; then
        # Launched through a launcher CLI: the launcher stays open after the
        # game exits (QuitAfterGameStop=false), so process death never comes.
        # The dump runs synchronously on the client thread right before the
        # shutdown, so a settled file means the pipeline is complete.
        echo "recipedump.json settled; treating the export as complete."
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

cleanup_runtime
trap - EXIT

if (( dump_ready != 1 )); then
  echo "Timed out waiting for $recipedump_path." >&2
  exit 1
fi

# Bring the JVM-written artifacts back next to the logs when the sandbox
# forced them beside the instance.
if [[ "$jvm_export_root" != "$SUSY_RAW_EXPORT_DIR" ]]; then
  mv -f "$recipedump_path" "$SUSY_RAW_EXPORT_DIR/recipedump.json"
  rm -rf "$SUSY_RAW_EXPORT_DIR/rendered-icons"
  mv "$rendered_icon_dir" "$SUSY_RAW_EXPORT_DIR/rendered-icons"
  recipedump_path="$SUSY_RAW_EXPORT_DIR/recipedump.json"
  rendered_icon_dir="$SUSY_RAW_EXPORT_DIR/rendered-icons"
fi

# The local orchestrator uses this runner for the client-only extraction phase.
# Leave the raw dump and rendered icons in temp so later stages can be resumed
# independently without booting Minecraft again.
if [[ "${SUSY_EXPORT_PHASE:-full}" == "extract" ]]; then
  echo "SUSY extraction completed; raw artifacts are in $SUSY_RAW_EXPORT_DIR."
  exit 0
fi

echo "Normalizing SusyCore recipedump into the planner dataset."
SUSY_DATASET_VERSION_ID="$SUSY_DATASET_VERSION_ID" \
SUSY_DATASET_VERSION_LABEL="$SUSY_DATASET_VERSION_LABEL" \
SUSY_RENDERED_ICON_DIR="$rendered_icon_dir" \
  node "$repo_root/tools/dataset-pipeline/scripts/susy/normalize-susy-recipedump.mjs" \
  "$recipedump_path" "$SUSY_DATASET_OUT_DIR/recipes.json"

echo "Applying rendered HEI icons to the normalized dataset."
node "$repo_root/tools/dataset-pipeline/scripts/susy/apply-susy-icons.mjs" \
  "$SUSY_DATASET_OUT_DIR/recipes.json" "$rendered_icon_dir" "$SUSY_DATASET_OUT_DIR" "/datasets/susy"

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
