#!/usr/bin/env bash
set -euo pipefail

channel="${1:-daily}"
publish="${2:-false}"
image="${GTNH_DATASET_DOCKER_IMAGE:-gtnh-factory-flow-dataset:java21}"
memory="${GTNH_EXPORT_MAX_MEMORY:-6G}"
timeout_seconds="${GTNH_EXPORT_TIMEOUT_SECONDS:-21600}"
docker_memory_limit="${GTNH_DATASET_DOCKER_MEMORY_LIMIT:-10g}"
docker_memory_swap="${GTNH_DATASET_DOCKER_MEMORY_SWAP:-12g}"
docker_cpus="${GTNH_DATASET_DOCKER_CPUS:-8}"
dataset_root="${GTNH_DATASETS_ROOT:-public/datasets/susy}"

case "$dataset_root" in
  /*) dataset_root_abs="$dataset_root" ;;
  *) dataset_root_abs="$PWD/$dataset_root" ;;
esac

docker build -t "$image" -f tools/dataset-pipeline/docker/Dockerfile .

mkdir -p .pipeline "$dataset_root_abs"

docker run --rm \
  --name "gtnh-dataset-${channel}" \
  --shm-size=2g \
  -e "CHANNEL=${channel}" \
  -e "GITHUB_TOKEN=${GITHUB_TOKEN:-}" \
  -e "GTNH_DATASETS_ROOT=/datasets" \
  -v "$dataset_root_abs:/datasets" \
  -v "$PWD:/workspace" \
  -w /workspace \
  "$image" \
  bash -lc 'node tools/dataset-pipeline/scripts/detect-gtnh-versions.mjs'

mapfile -t versions < <(
  node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync('.pipeline/detected-versions.json','utf8')); for (const v of data.detected) console.log([v.channel,v.id,v.gtnhVersion,v.sourceKind,v.sourceRef,v.sourceUrl ?? ''].map(x => String(x).replaceAll('\t',' ')).join('\t'))"
)

if [[ "${#versions[@]}" -eq 0 ]]; then
  echo "No GTNH versions detected for channel ${channel}." >&2
  exit 1
fi

for line in "${versions[@]}"; do
  IFS=$'\t' read -r version_channel version_id version_label source_kind source_ref source_url <<<"$line"
  echo "Running ${version_id} in Docker with GTNH_EXPORT_MAX_MEMORY=${memory}."
  docker run --rm \
    --name "gtnh-export-${version_id}" \
    --shm-size=2g \
    --memory="${docker_memory_limit}" \
    --memory-swap="${docker_memory_swap}" \
    --cpus="${docker_cpus}" \
    -e "GITHUB_TOKEN=${GITHUB_TOKEN:-}" \
    -e "GTNH_CHANNEL=${version_channel}" \
    -e "GTNH_VERSION_ID=${version_id}" \
    -e "GTNH_VERSION_LABEL=${version_label}" \
    -e "GTNH_SOURCE_KIND=${source_kind}" \
    -e "GTNH_SOURCE_REF=${source_ref}" \
    -e "GTNH_SOURCE_URL=${source_url}" \
    -e "GTNH_EXPORT_MAX_MEMORY=${memory}" \
    -e "GTNH_EXPORT_TIMEOUT_SECONDS=${timeout_seconds}" \
    -e "GTNH_EXPORT_PACK_KIND=client" \
    -e "GTNH_RENDER_STACK_ICONS=true" \
    -e "GTNH_DATASETS_ROOT=/datasets" \
    -v "$dataset_root_abs:/datasets" \
    -v "$PWD:/workspace" \
    -w /workspace \
    "$image" \
    bash -lc 'npm install && node tools/dataset-pipeline/scripts/generate-dataset.mjs'
done

docker run --rm \
  --name "gtnh-manifest-${channel}" \
  -e "GTNH_DATASETS_ROOT=/datasets" \
  -v "$dataset_root_abs:/datasets" \
  -v "$PWD:/workspace" \
  -w /workspace \
  "$image" \
  node tools/dataset-pipeline/scripts/rebuild-manifest.mjs

if [[ "$publish" == "true" ]]; then
  echo "Datasets are available in ${dataset_root_abs}."
  echo "They are intentionally not committed to git. Sync this directory to the server dataset volume or use the GitHub Action publish job."
fi
