#!/usr/bin/env python3
r"""
SusyCore recipedump.json -> planner RecipeDataset.

Python port of normalize-susy-recipedump.mjs. It is a line-by-line-equivalent
rewrite, not a reinterpretation: every helper, loop and field name below
mirrors the original .mjs so the two can be diffed against each other if the
Node version ever changes.

Raw source: SusyCore's `/recipemapdump` command (SymmetricDevs/Susy-Core,
CommandRecipemapDump.java), which writes one JSON object with these keys:

  items       full item catalog ({resource, metadata, displayName, material?})
  fluids      full fluid catalog ({fluidName, unlocalizedName, localizedName})
  oreDict     { oreName: [itemStack] }
  recipemaps  { : { maxInputs..., recipes: [gtRecipe] } }
  gtMTEs      { : { metaName, isController, tier?, recipemapName? } }
  smelting    [ {input, output} ]
  crafting    [ {type, keymap/shape | ingredients, output} ]
  materials   { ... } (unused here)

Usage:
  python normalize_susy_recipedump.py [INPUT] [OUTPUT] [options]

With no arguments the normalizer looks for a SusyCore recipedump under the
repository's temp directory and writes
public/datasets/susy/<version-id>/recipes.json.

Options:
  --dataset-root PATH   Dataset root for the automatic output location.
  --version-id ID       Override the dataset version id (otherwise use the
                         environment, dump metadata, or a generated UUID).
  --version-label TEXT  Override the human-readable pack version.
  --manifest PATH       Update PATH only when the complete packaged dataset is
                         already present beside OUTPUT.
  --url-root URL        Public dataset URL prefix for manifest paths.

The normalizer writes one plain, line-oriented recipes.json. Indexes, gzip and
published-manifest generation remain the responsibility of the surrounding
Node pipeline, just as they are for normalize-susy-recipedump.mjs.
"""

import argparse
import hashlib
import json
import math
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[3]
DEFAULT_DATASET_ROOT = REPO_ROOT / "public" / "datasets" / "susy"
RECIPEDUMP_FILENAME = "recipedump.json"

# ---------------------------------------------------------------------------
# JS-coercion helpers
# ---------------------------------------------------------------------------


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def sha16(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


def to_number(value):
    if value is None:
        return 0
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return value
    s = str(value).strip()
    if s == "":
        return 0
    try:
        if re.fullmatch(r"[+-]?\d+", s):
            return int(s)
        return float(s)
    except ValueError:
        return 0


def to_number_or_none(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return value
    s = str(value).strip()
    if s == "":
        return None
    try:
        if re.fullmatch(r"[+-]?\d+", s):
            return int(s)
        return float(s)
    except ValueError:
        return None


def js_number_to_string(n):
    if isinstance(n, float) and n.is_integer():
        n = int(n)
    return str(n)


def js_round(x):
    return math.floor(x + 0.5)


# ---------------------------------------------------------------------------
# Output writer
# ---------------------------------------------------------------------------


def normalize_numbers(obj):
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return int(obj) if obj.is_integer() else obj
    if isinstance(obj, dict):
        normalized = {}
        for key, value in obj.items():
            value = normalize_numbers(value)
            if value is not None:
                normalized[key] = value
        return normalized
    if isinstance(obj, list):
        return [normalize_numbers(v) for v in obj]
    return obj


def write_dataset_json(path, dataset):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    keys = list(dataset.keys())
    lines = ["{"]
    for i, key in enumerate(keys):
        comma = "," if i < len(keys) - 1 else ""
        value_json = json.dumps(normalize_numbers(dataset[key]), ensure_ascii=False, separators=(",", ":"))
        lines.append(f'"{key}":{value_json}{comma}')
    lines.append("}")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")


def update_datasets_manifest(manifest_path, dataset_dir, dataset_version_id, susy_version, generated_at, url_root):
    """Update a manifest for a dataset that has already been fully packaged.

    The normalizer intentionally does not advertise plain ``recipes.json`` as a
    published dataset. The manifest's checksum is the lookup-index checksum,
    matching rebuild-manifest.mjs, and every required packaged artifact must be
    present before this function is allowed to change the manifest.
    """
    dataset_dir = Path(dataset_dir)
    required = {
        "recipeDatasetPath": dataset_dir / "recipes.json.gz",
        "resourceIndexPath": dataset_dir / "resource-index.json.gz",
        "recipeIndexPath": dataset_dir / "recipe-index.json.gz",
        "recipeLookupIndexPath": dataset_dir / "recipe-lookup-index.json.gz",
    }
    missing = [str(path) for path in required.values() if not path.is_file() or path.stat().st_size == 0]
    if missing:
        raise ValueError(
            "Cannot update the dataset manifest until these packaged artifacts exist: "
            + ", ".join(missing)
        )

    checksum = hashlib.sha256(required["recipeLookupIndexPath"].read_bytes()).hexdigest()
    url_root = "/" + url_root.strip("/")
    manifest_path = Path(manifest_path)
    manifest_data = {"schemaVersion": 1, "versions": []}
    if manifest_path.exists():
        with manifest_path.open("r", encoding="utf-8") as handle:
            manifest_data = json.load(handle)
        if not isinstance(manifest_data, dict) or not isinstance(manifest_data.get("versions", []), list):
            raise ValueError(f"Invalid datasets manifest: {manifest_path}")

    versions = manifest_data.get("versions", [])
    version_entry = {
        "id": dataset_version_id,
        "gtnhVersion": susy_version,
        "channel": "experimental",
        "publishedAt": generated_at,
        "manifestPath": f"{url_root}/datasets.manifest.json",
        **{key: f"{url_root}/{dataset_version_id}/{path.name}" for key, path in required.items()},
        "checksumSha256": checksum,
        "sourceInfo": {
            "sourceId": "gtnh-oracle",
            "sourceVersion": susy_version,
            "generatedAt": generated_at,
            "notes": f"SusyCore /recipemapdump of Supersymmetry {susy_version}; smelting durations synthesized.",
        },
    }
    for index, version in enumerate(versions):
        if isinstance(version, dict) and version.get("id") == dataset_version_id:
            versions[index] = version_entry
            break
    else:
        versions.insert(0, version_entry)
    manifest_data["versions"] = versions
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with manifest_path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(manifest_data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    print(f"Datasets manifest updated at: {manifest_path}")


# ---------------------------------------------------------------------------
# Resource identity
# ---------------------------------------------------------------------------

VOLTAGE_NAMES = ["ULV", "LV", "MV", "HV", "EV", "IV", "LuV", "ZPM", "UV"]
VOLTAGES = [8, 32, 128, 512, 2048, 8192, 32768, 131072, 524288]

TIER_SUFFIX = re.compile(r"\.(ulv|lv|mv|hv|ev|iv|luv|zpm|uv|uhv|uev|uiv|uxv|opv|max)$", re.IGNORECASE)

TIER_ORDER = {tier: i for i, tier in enumerate(
    ["ulv", "lv", "mv", "hv", "ev", "iv", "luv", "zpm", "uv", "uhv"]
)}

CROP_FARM_MACHINE_TYPE = "Crop Farm"
NOT_TILLED_SOIL_PLANT_IDS = {"minecraft:reeds", "minecraft:cactus", "minecraft:sand"}

VANILLA_PLANT_IDS = {
    "minecraft:wheat", "minecraft:wheat_seeds", "minecraft:carrot", "minecraft:potato",
    "minecraft:beetroot", "minecraft:beetroot_seeds", "minecraft:sugar_cane",
    "minecraft:cocoa_beans", "minecraft:cactus", "minecraft:melon_slice", "minecraft:pumpkin",
    "minecraft:sweet_berries", "minecraft:glow_berries", "minecraft:nether_wart", "minecraft:kelp",
    "minecraft:bamboo", "minecraft:apple", "minecraft:brown_mushroom", "minecraft:red_mushroom",
}


def item_id(resource, metadata):
    canonical = str(resource or "").lower()
    if not canonical or canonical == "null":
        return None
    meta = to_number(metadata)
    return f"{canonical}@{int(meta)}" if meta else canonical


def voltage_tier_for_eu(eut):
    value = max(0, abs(to_number(eut) or 0))
    for tier, cap in enumerate(VOLTAGES):
        if value <= cap:
            return VOLTAGE_NAMES[tier]
    return VOLTAGE_NAMES[-1]


def pretty_machine_name(unlocalized_name):
    text = str(unlocalized_name or "")
    tail = text.split(".")[-1] or text
    words = [w for w in re.split(r"[_\s-]+", tail) if w]
    return " ".join(w[0].upper() + w[1:] for w in words)


def mod_id_of(resource_id):
    separator = resource_id.find(":")
    return resource_id[:separator] if separator > 0 else None


def is_circuit_stack(stack):
    resource = str(stack.get("resource") or "").lower()
    return (
        "integrated_circuit" in resource
        or "programmable_circuit" in resource
        or bool(re.search(r"[/:]circuit\b", resource))
    )


def normalize_chance(value):
    numeric = to_number(value)
    if not (numeric > 0):
        return None
    fraction = numeric / 10000 if numeric <= 10000 else numeric / 2147483647
    if fraction >= 1:
        return None
    return js_round(fraction * 10000) / 10000


_VERSION_KEY_CANDIDATES = ("version", "susyVersion", "modVersion", "packVersion", "gameVersion")


def extract_version_id(raw):
    for key in _VERSION_KEY_CANDIDATES:
        value = raw.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    for container_key in ("meta", "info"):
        container = raw.get(container_key)
        if isinstance(container, dict):
            for key in _VERSION_KEY_CANDIDATES:
                value = container.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
    return None


def generate_version_id(input_path=None):
    """Return a unique id for a dump that carries no usable version metadata."""
    return str(uuid.uuid4())


def recipedump_candidates(repo_root=REPO_ROOT, cwd=None, env=None):
    env = os.environ if env is None else env
    cwd = Path.cwd() if cwd is None else Path(cwd)
    repo_root = Path(repo_root)
    candidates = []
    for name in ("SUSY_RECIPEDUMP_PATH", "SUSY_RECIPEDUMP"):
        configured = env.get(name)
        if configured:
            candidates.append(Path(configured).expanduser())
    for root in (repo_root, cwd):
        candidates.extend(
            [
                root / "temp" / "raw-export" / RECIPEDUMP_FILENAME,
                root / "temp" / RECIPEDUMP_FILENAME,
                root / "raw-export" / RECIPEDUMP_FILENAME,
                root / RECIPEDUMP_FILENAME,
            ]
        )
    temp_dir = repo_root / "temp"
    if temp_dir.is_dir():
        candidates.extend(sorted(temp_dir.glob(f"**/{RECIPEDUMP_FILENAME}")))
    unique = []
    seen = set()
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved not in seen:
            seen.add(resolved)
            unique.append(resolved)
    return unique


def discover_recipedump(explicit=None, repo_root=REPO_ROOT, cwd=None, env=None):
    if explicit is not None:
        return explicit.expanduser().resolve()
    candidates = recipedump_candidates(repo_root=repo_root, cwd=cwd, env=env)
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def resolve_dataset_version(raw, input_path, version_id=None, version_label=None):
    if version_id:
        resolved_id, source = version_id, "command line"
    else:
        env_id = os.environ.get("SUSY_DATASET_VERSION_ID")
        if env_id:
            resolved_id, source = env_id, "environment"
        else:
            extracted = extract_version_id(raw)
            if extracted:
                resolved_id, source = extracted, "extracted from the dump"
            else:
                resolved_id, source = generate_version_id(input_path), "generated (no version found anywhere)"

    label = version_label or os.environ.get("SUSY_DATASET_VERSION_LABEL") or f"SUSY {resolved_id}"
    if not version_id and source != "environment":
        print(f"Dataset version id not overridden; using {source}: {resolved_id}", file=sys.stderr)
    if not version_label and not os.environ.get("SUSY_DATASET_VERSION_LABEL"):
        print(f"Dataset version label not overridden; using: {label}", file=sys.stderr)
    return resolved_id, label


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Normalize a SusyCore recipedump.json into a plain RecipeDataset.",
    )
    parser.add_argument(
        "input",
        type=Path,
        nargs="?",
        help="raw SusyCore recipedump JSON (discovered automatically when omitted)",
    )
    parser.add_argument(
        "output",
        type=Path,
        nargs="?",
        help="normalized recipes.json (written under --dataset-root when omitted)",
    )
    parser.add_argument(
        "--dataset-root",
        type=Path,
        default=DEFAULT_DATASET_ROOT,
        help="dataset root for the automatic output location",
    )
    parser.add_argument("--version-id", help="dataset version id override")
    parser.add_argument("--version-label", help="human-readable pack version override")
    parser.add_argument(
        "--manifest",
        type=Path,
        help="update this manifest after checking all packaged dataset artifacts",
    )
    parser.add_argument("--url-root", default="/datasets/susy", help="public dataset URL prefix")
    return parser.parse_args(argv)


def load_recipedump(input_path):
    try:
        with input_path.open("r", encoding="utf-8-sig") as handle:
            raw = json.load(handle)
    except FileNotFoundError:
        raise ValueError(f"Input recipedump file not found: {input_path}") from None
    except json.JSONDecodeError as error:
        raise ValueError(f"Input is not valid JSON ({input_path}): {error}") from error
    if not isinstance(raw, dict):
        raise ValueError(f"Input recipedump must contain a JSON object: {input_path}")
    return raw


def main(argv=None):
    args = parse_args(argv)
    input_path = discover_recipedump(args.input)
    if input_path is None:
        searched = "\n  - ".join(str(path) for path in recipedump_candidates())
        fail(
            "No recipedump.json was found automatically. Pass an input path or "
            f"set SUSY_RECIPEDUMP_PATH. Searched:\n  - {searched}"
        )
    if not input_path.is_file():
        fail(f"Input recipedump file not found at: {input_path}")

    generated_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    try:
        raw = load_recipedump(input_path)
    except (OSError, ValueError) as error:
        fail(str(error))
    dataset_version_id, susy_version = resolve_dataset_version(
        raw, input_path, args.version_id, args.version_label
    )
    if "/" in dataset_version_id or "\\" in dataset_version_id:
        fail(f"Dataset version id must be a single path component: {dataset_version_id}")

    if args.output is not None:
        output_path = args.output.expanduser().resolve()
    else:
        output_path = (args.dataset_root.expanduser().resolve() / dataset_version_id / "recipes.json")

    if args.input is None:
        print(f"Discovered recipedump: {input_path}")
    print(f"Processing dump from: {input_path}")
    print(f"Target dataset path:  {output_path}")

    # -----------------------------------------------------------------
    # Dataset accumulators
    # -----------------------------------------------------------------
    resources = {}
    recipes = []
    recipe_maps = set()
    recipe_map_icons = []
    machine_handler_icons = []

    def add_resource(entry):
        key = f"{entry['kind']}:{entry['id']}"
        existing = resources.get(key)
        if existing is None:
            resources[key] = entry
            return entry
        if not existing.get("displayName") and entry.get("displayName"):
            existing["displayName"] = entry["displayName"]
        if not existing.get("modId") and entry.get("modId"):
            existing["modId"] = entry["modId"]
        return existing

    def assign_slots(recipe):
        item_inputs = 0
        for inp in recipe["inputs"]:
            if inp["kind"] == "item":
                inp["neiSlot"] = {"x": 6, "y": 4 + item_inputs * 18}
            else:
                inp["neiSlot"] = {"x": 30, "y": 4 + item_inputs * 18}
            item_inputs += 1
        for index, output in enumerate(recipe["outputs"]):
            output["neiSlot"] = {"x": 102, "y": 4 + index * 18}

    # -----------------------------------------------------------------
    # Catalog joins
    # -----------------------------------------------------------------

    fluid_by_unlocalized_name = {}
    for fluid in raw.get("fluids") if isinstance(raw.get("fluids"), list) else []:
        if not fluid or not isinstance(fluid, dict):
            continue
        entry = {
            "fluidName": str(fluid.get("fluidName") or ""),
            "displayName": str(
                fluid.get("localizedName") or fluid.get("unlocalizedName") or fluid.get("fluidName") or ""
            ),
        }
        if fluid.get("unlocalizedName"):
            fluid_by_unlocalized_name[fluid["unlocalizedName"]] = entry
        if fluid.get("fluidName"):
            fluid_by_unlocalized_name[fluid["fluidName"]] = entry

    item_display_names = {}
    for item in raw.get("items") if isinstance(raw.get("items"), list) else []:
        if not item or not item.get("resource"):
            continue
        rid = item_id(item.get("resource"), item.get("metadata"))
        if rid and item.get("displayName"):
            item_display_names[rid] = str(item["displayName"])

    def strip_fluid_prefix(name):
        return re.sub(r"^fluid\.", "", str(name or ""))

    controllers_by_map_key = {}
    for registry_key, machine in (raw.get("gtMTEs") or {}).items():
        if not machine or not machine.get("isController"):
            continue
        raw_name = str(machine.get("metaName") or registry_key)
        tail = raw_name.split(".")[-1] or raw_name
        tail = TIER_SUFFIX.sub("", tail)
        key = tail.lower()
        controllers_by_map_key.setdefault(key, []).append(
            {"registryKey": registry_key, "machine": machine, "tail": tail}
        )

    machine_item_by_translation_key = {}
    for item in raw.get("items") if isinstance(raw.get("items"), list) else []:
        if not item or not item.get("resource"):
            continue
        if "MachineItemBlock" not in str(item.get("itemClass") or ""):
            continue
        rid = item_id(item.get("resource"), item.get("metadata"))
        translation_key = item.get("translationKey")
        if not rid or not translation_key:
            continue
        if translation_key not in machine_item_by_translation_key:
            machine_item_by_translation_key[translation_key] = {
                "id": rid,
                "displayName": item.get("displayName"),
            }

    def controller_face_resource(map_name):
        candidates = controllers_by_map_key.get(str(map_name).lower())
        if not candidates:
            return None
        lowered = str(map_name).lower()
        chosen = next((c for c in candidates if c["tail"].lower() == lowered), candidates[0])
        item = machine_item_by_translation_key.get(str(chosen["machine"].get("metaName") or ""))
        if not item:
            return None
        resource = {
            "kind": "item",
            "id": item["id"],
            "displayName": item.get("displayName"),
            "modId": mod_id_of(item["id"]),
        }
        add_resource(dict(resource))
        return resource

    # -----------------------------------------------------------------
    # Stack/resource conversion
    # -----------------------------------------------------------------

    def stack_to_resource(stack):
        rid = item_id(stack.get("resource"), stack.get("metadata"))
        if not rid:
            return None
        return add_resource({
            "kind": "item",
            "id": rid,
            "amount": max(1, to_number(stack.get("count")) or 1),
            "displayName": item_display_names.get(rid),
            "modId": mod_id_of(rid),
        })

    def fluid_input_to_resource(input_entry):
        fluid_stack = input_entry.get("inputFluidStack")
        if not fluid_stack:
            return None
        known = fluid_by_unlocalized_name.get(fluid_stack.get("unlocalizedName"))
        rid = (known["fluidName"] if known else "") or strip_fluid_prefix(fluid_stack.get("unlocalizedName"))
        if not rid:
            return None
        return add_resource({
            "kind": "fluid",
            "id": rid,
            "amount": max(1, to_number(fluid_stack.get("amount")) or 1),
            "displayName": fluid_stack.get("specificLocalizedName") or (known.get("displayName") if known else None),
        })

    # -----------------------------------------------------------------
    # GT recipe conversion
    # -----------------------------------------------------------------

    def convert_gt_recipe(map_name, index, raw_recipe):
        inputs = []
        programmed_circuit = None

        for input_entry in raw_recipe.get("inputs") or []:
            stacks = [s for s in (input_entry.get("inputStacks") or []) if s and s.get("resource")]
            if not stacks:
                continue
            non_consumable = bool(input_entry.get("nonConsumable"))
            amount = max(1, to_number(input_entry.get("amount")) or 1)

            primary = stack_to_resource(stacks[0])
            if not primary:
                continue
            entry = {
                "kind": primary["kind"],
                "id": primary["id"],
                "amount": amount,
                "displayName": primary.get("displayName"),
                "modId": primary.get("modId"),
            }
            if non_consumable:
                entry["consumed"] = False
            if non_consumable and any(is_circuit_stack(s) for s in stacks):
                dialled = next(s for s in stacks if is_circuit_stack(s))
                configuration = to_number_or_none(dialled.get("metadata"))
                if configuration is not None:
                    programmed_circuit = js_number_to_string(configuration)
            if len(stacks) > 1:
                alternatives = []
                for s in stacks[1:]:
                    alt = stack_to_resource(s)
                    if alt:
                        alternatives.append({
                            "kind": alt["kind"], "id": alt["id"],
                            "displayName": alt.get("displayName"), "modId": alt.get("modId"),
                        })
                entry["alternatives"] = alternatives
            inputs.append(entry)

        for input_entry in raw_recipe.get("inputsFluid") or []:
            fluid_resource = fluid_input_to_resource(input_entry)
            if not fluid_resource:
                continue
            item = {
                "kind": "fluid",
                "id": fluid_resource["id"],
                "amount": max(
                    1,
                    to_number(input_entry.get("amount")) or to_number(fluid_resource.get("amount")) or 1,
                ),
                "displayName": fluid_resource.get("displayName"),
            }
            if input_entry.get("nonConsumable"):
                item["consumed"] = False
            inputs.append(item)

        outputs = []
        for output in raw_recipe.get("outputs") or []:
            resource = stack_to_resource(output)
            if resource:
                outputs.append({
                    "kind": resource["kind"],
                    "id": resource["id"],
                    "amount": max(1, to_number(output.get("count")) or 1),
                    "displayName": resource.get("displayName"),
                    "modId": resource.get("modId"),
                })
        for output in raw_recipe.get("chancedOutputs") or []:
            resource = stack_to_resource(output)
            if not resource:
                continue
            chance = normalize_chance(output.get("chance"))
            entry = {
                "kind": resource["kind"],
                "id": resource["id"],
                "amount": max(1, to_number(output.get("count")) or 1),
                "displayName": resource.get("displayName"),
                "modId": resource.get("modId"),
            }
            if chance is not None:
                entry["chance"] = chance
            if len(outputs) > 0:
                entry["byproduct"] = True
            outputs.append(entry)
        for output in raw_recipe.get("chancedFluidOutputs") or []:
            known = fluid_by_unlocalized_name.get(output.get("unlocalizedName"))
            rid = (known["fluidName"] if known else "") or strip_fluid_prefix(output.get("unlocalizedName"))
            if not rid:
                continue
            chance = normalize_chance(output.get("chance"))
            add_resource({"kind": "fluid", "id": rid, "displayName": known.get("displayName") if known else None})
            entry = {
                "kind": "fluid",
                "id": rid,
                "amount": max(1, to_number(output.get("amount")) or 1),
                "displayName": known.get("displayName") if known else None,
                "byproduct": True,
            }
            if chance is not None:
                entry["chance"] = chance
            outputs.append(entry)
        for output in raw_recipe.get("fluidOutputs") or []:
            known = fluid_by_unlocalized_name.get(output.get("unlocalizedName"))
            rid = (known["fluidName"] if known else "") or strip_fluid_prefix(output.get("unlocalizedName"))
            if not rid:
                continue
            add_resource({"kind": "fluid", "id": rid, "displayName": known.get("displayName") if known else None})
            outputs.append({
                "kind": "fluid",
                "id": rid,
                "amount": max(1, to_number(output.get("amount")) or 1),
                "displayName": output.get("specificLocalizedName") or (known.get("displayName") if known else None),
            })

        if not inputs or not outputs:
            return None

        properties = raw_recipe.get("properties") or []
        temperature_property = next((p for p in properties if p.get("propertyKey") == "temperature"), None)
        metadata = {}
        for prop in properties:
            key = prop.get("propertyKey")
            if key == "eu_to_start":
                metadata["fusionEuToStart"] = prop.get("eu_to_start")
            if key == "cleanroom":
                metadata["cleanroom"] = prop.get("cleanroom")
            if key == "dimension":
                metadata["dimensions"] = prop.get("dimensions")
            if key == "cells":
                metadata["cells"] = prop.get("cells")

        recipe = {
            "id": sha16(f"susy:{map_name}:{index}"),
            "name": outputs[0].get("displayName") or outputs[0].get("id") or map_name,
            "kind": "gregtech_machine",
            "machineType": map_name,
            "minimumTier": voltage_tier_for_eu(raw_recipe.get("EUt")),
            "durationTicks": max(1, to_number(raw_recipe.get("duration")) or 1),
            "eut": max(0, to_number(raw_recipe.get("EUt")) or 0),
            "inputs": inputs,
            "outputs": outputs,
        }
        if raw_recipe.get("categoryName"):
            recipe["category"] = raw_recipe["categoryName"]
        if programmed_circuit is not None:
            recipe["programmedCircuit"] = programmed_circuit
        if temperature_property is not None:
            recipe["specialValue"] = to_number_or_none(temperature_property.get("temperature"))
        if metadata:
            recipe["metadata"] = metadata
        source = {"datasetVersionId": dataset_version_id, "recipeMap": map_name}
        if raw_recipe.get("categoryModID"):
            source["sourceMod"] = raw_recipe["categoryModID"]
        source["exporter"] = "gtnh-oracle"
        if raw_recipe.get("categoryUniqueID"):
            source["rawRecipeId"] = raw_recipe["categoryUniqueID"]
        recipe["source"] = source
        assign_slots(recipe)
        return recipe

    # -----------------------------------------------------------------
    # Domains
    # -----------------------------------------------------------------

    machines_by_recipe_map = {}
    for registry_key, machine in (raw.get("gtMTEs") or {}).items():
        if not machine or not machine.get("recipemapName"):
            continue
        machines_by_recipe_map.setdefault(machine["recipemapName"], []).append(
            {"registryKey": registry_key, "machine": machine}
        )

    def family_handlers(machines):
        by_family = {}

        def tier_rank(entry):
            return TIER_ORDER.get(str(entry["machine"].get("tier") or "").lower(), 99)

        for entry in sorted(machines, key=tier_rank):
            registry_key = entry["registryKey"]
            machine = entry["machine"]
            raw_name = str(machine.get("metaName") or registry_key.split(":")[-1] or registry_key)
            family_name = TIER_SUFFIX.sub("", raw_name)
            prefix = "multi:" if machine.get("isController") else "single:"
            family_key = f"{prefix}{family_name.lower()}"
            if family_key in by_family:
                continue
            handler = {
                "id": family_key,
                "label": pretty_machine_name(family_name),
                "kind": "multiblock" if machine.get("isController") else "single",
                "_metaName": str(machine.get("metaName") or ""),
            }
            tier_num = to_number_or_none(machine.get("tier"))
            if tier_num is not None:
                handler["minimumTier"] = VOLTAGE_NAMES[min(int(tier_num), len(VOLTAGE_NAMES) - 1)]
            by_family[family_key] = handler
        return list(by_family.values())

    for map_name, rmap in (raw.get("recipemaps") or {}).items():
        machine_type = pretty_machine_name(map_name)
        families = family_handlers(machines_by_recipe_map.get(map_name) or [])
        handlers = [{k: v for k, v in fam.items() if k != "_metaName"} for fam in families]

        family_icon_resources = []
        for family in families:
            machine_item = machine_item_by_translation_key.get(family["_metaName"])
            if not machine_item:
                continue
            resource = {
                "kind": "item",
                "id": machine_item["id"],
                "displayName": machine_item.get("displayName"),
                "modId": mod_id_of(machine_item["id"]),
            }
            add_resource(dict(resource))
            machine_handler_icons.append({"familyId": family["id"], "resource": resource})
            family_icon_resources.append(resource)

        index = 0
        for raw_recipe in rmap.get("recipes") or []:
            recipe = convert_gt_recipe(machine_type, index, raw_recipe)
            index += 1
            if not recipe:
                continue
            if handlers:
                recipe["machineHandlers"] = handlers
            recipe_maps.add(machine_type)
            recipes.append(recipe)
            if not any(icon["recipeMap"] == machine_type for icon in recipe_map_icons):
                primary_output = next(
                    (o for o in recipe["outputs"] if o["kind"] == "item"),
                    recipe["outputs"][0] if recipe["outputs"] else None,
                )
                resource = family_icon_resources[0] if family_icon_resources else None
                if resource is None:
                    resource = controller_face_resource(map_name)
                if resource is None and primary_output:
                    resource = {
                        "kind": primary_output["kind"],
                        "id": primary_output["id"],
                        "displayName": primary_output.get("displayName"),
                        "modId": primary_output.get("modId"),
                    }
                if resource:
                    recipe_map_icons.append({"recipeMap": machine_type, "resource": resource})

    smelting_count = 0
    for entry in raw.get("smelting") or []:
        input_stack = entry.get("input")
        output_stack = entry.get("output")
        input_resource = stack_to_resource(input_stack) if input_stack else None
        output_resource = stack_to_resource(output_stack) if output_stack else None
        if not input_resource or not output_resource:
            continue
        smelting_count += 1
        recipe = {
            "id": sha16(f"susy:smelting:{smelting_count}:{input_resource['id']}"),
            "name": output_resource.get("displayName") or output_resource["id"],
            "kind": "gregtech_machine",
            "machineType": "Electric Furnace",
            "minimumTier": "LV",
            "durationTicks": 128,
            "eut": 4,
            "inputs": [{
                "kind": input_resource["kind"],
                "id": input_resource["id"],
                "amount": max(1, to_number(input_stack.get("count")) or 1),
                "displayName": input_resource.get("displayName"),
                "modId": input_resource.get("modId"),
                "neiSlot": {"x": 6, "y": 22},
            }],
            "outputs": [{
                "kind": output_resource["kind"],
                "id": output_resource["id"],
                "amount": max(1, to_number(output_stack.get("count")) or 1),
                "displayName": output_resource.get("displayName"),
                "modId": output_resource.get("modId"),
                "neiSlot": {"x": 102, "y": 22},
            }],
            "source": {"datasetVersionId": dataset_version_id, "recipeMap": "Electric Furnace", "exporter": "gtnh-oracle"},
            "metadata": {"synthesizedDuration": True},
        }
        recipe_maps.add("Electric Furnace")
        recipes.append(recipe)

    crafting_count = 0
    for entry in raw.get("crafting") or []:
        output_stack = entry.get("output")
        output_resource = stack_to_resource(output_stack) if output_stack else None
        if not output_resource or not to_number(output_stack.get("count")):
            continue
        recipe_def = entry.get("recipe") or {}
        if entry.get("type") == "shaped" and recipe_def.get("keymap"):
            ingredients = list(recipe_def["keymap"].values())
        elif isinstance(recipe_def.get("ingredients"), list):
            ingredients = recipe_def["ingredients"]
        else:
            ingredients = []

        inputs = []
        for ingredient in ingredients:
            valid_inputs = ingredient.get("validInputs") if isinstance(ingredient, dict) else None
            valid_inputs = valid_inputs if isinstance(valid_inputs, list) else []
            stacks = [s for s in valid_inputs if s and s.get("resource")]
            if not stacks:
                continue
            primary = stack_to_resource(stacks[0])
            if not primary:
                continue
            converted = {
                "kind": primary["kind"],
                "id": primary["id"],
                "amount": max(1, to_number(stacks[0].get("count")) or 1),
                "displayName": primary.get("displayName"),
                "modId": primary.get("modId"),
            }
            if len(stacks) > 1:
                alternatives = []
                for s in stacks[1:]:
                    alt = stack_to_resource(s)
                    if alt:
                        alternatives.append({
                            "kind": alt["kind"], "id": alt["id"],
                            "displayName": alt.get("displayName"), "modId": alt.get("modId"),
                        })
                converted["alternatives"] = alternatives
            inputs.append(converted)
        if not inputs:
            continue
        crafting_count += 1
        for idx, inp in enumerate(inputs):
            inp["neiSlot"] = {"x": 6 + (idx % 3) * 18, "y": 4 + (idx // 3) * 18}
        recipe = {
            "id": sha16(f"susy:crafting:{crafting_count}:{output_resource['id']}"),
            "name": output_resource.get("displayName") or output_resource["id"],
            "machineType": "Crafting Table",
            "minimumTier": "ULV",
            "durationTicks": 0,
            "eut": 0,
            "inputs": inputs,
            "outputs": [{
                "kind": output_resource["kind"],
                "id": output_resource["id"],
                "amount": max(1, to_number(output_stack.get("count")) or 1),
                "displayName": output_resource.get("displayName"),
                "modId": output_resource.get("modId"),
                "neiSlot": {"x": 102, "y": 22},
            }],
            "source": {
                "datasetVersionId": dataset_version_id,
                "recipeMap": "crafting",
                "exporter": "gtnh-oracle",
            },
        }
        if isinstance(entry.get("registryName"), str):
            recipe["source"]["rawRecipeId"] = entry["registryName"]
        recipe_maps.add("Crafting Table")
        recipes.append(recipe)

    def planted_stack_of(raw_recipe):
        for input_entry in raw_recipe.get("inputs") or []:
            for stack in input_entry.get("inputStacks") or []:
                resource = str(stack.get("resource") or "").lower()
                if is_circuit_stack(stack) or resource == "gregtech:meta_item_1":
                    continue
                return {
                    "stack": stack,
                    "plantCount": max(1, to_number(input_entry.get("amount")) or to_number(stack.get("count")) or 1),
                }
        return None

    seen_crop_farm_seeds = set()
    crop_farm_icon_pushed = False
    for map_name, rmap in (raw.get("recipemaps") or {}).items():
        if not (re.search(r"greenhouse", map_name, re.IGNORECASE) and re.search(r"plant", map_name, re.IGNORECASE)):
            continue
        for raw_recipe in rmap.get("recipes") or []:
            planted = planted_stack_of(raw_recipe)
            if not planted:
                continue
            seed_id = item_id(planted["stack"].get("resource"), planted["stack"].get("metadata"))
            if not seed_id or seed_id in NOT_TILLED_SOIL_PLANT_IDS:
                continue
            if seed_id in seen_crop_farm_seeds:
                continue
            seen_crop_farm_seeds.add(seed_id)

            plant_count = planted["plantCount"]

            def per_plant_amount(count, _plant_count=plant_count):
                return max(0, js_round(((to_number(count) or 0) / _plant_count) * 1e6) / 1e6)

            outputs = []
            for output in raw_recipe.get("outputs") or []:
                resource = stack_to_resource(output)
                if not resource:
                    continue
                amount = per_plant_amount(output.get("count"))
                if not (amount > 0):
                    continue
                outputs.append({
                    "kind": resource["kind"],
                    "id": resource["id"],
                    "amount": amount,
                    "displayName": resource.get("displayName"),
                    "modId": resource.get("modId"),
                })
            if not outputs:
                continue

            seed_display_name = item_display_names.get(seed_id)
            add_resource({
                "kind": "item",
                "id": seed_id,
                "displayName": seed_display_name,
                "modId": mod_id_of(seed_id),
            })

            produce_output = next((o for o in outputs if o["id"] != seed_id), outputs[0])
            crop_label = produce_output.get("displayName") or produce_output.get("id") or seed_display_name or seed_id

            recipe = {
                "id": sha16(f"susy:crop-farm:{seed_id}"),
                "name": f"{CROP_FARM_MACHINE_TYPE}: {crop_label}",
                "kind": "crop_produce",
                "machineType": CROP_FARM_MACHINE_TYPE,
                "category": "crop-farm",
                "minimumTier": "NONE",
                "durationTicks": max(1, to_number(raw_recipe.get("duration")) or 1),
                "eut": 0,
                "inputs": [{
                    "kind": "item",
                    "id": seed_id,
                    "amount": 1,
                    "displayName": seed_display_name,
                    "modId": mod_id_of(seed_id),
                    "consumed": False,
                }],
                "outputs": outputs,
                "notes": (
                    "One hand-worked farmland crop. Yields follow the pack's own greenhouse "
                    "growth cycle scaled to a single planted crop; the seed stays in the field. "
                    "Machine count = crops planted."
                ),
                "source": {
                    "datasetVersionId": dataset_version_id,
                    "recipeMap": CROP_FARM_MACHINE_TYPE,
                    "exporter": "gtnh-oracle",
                },
            }
            if raw_recipe.get("categoryModID"):
                recipe["source"]["sourceMod"] = raw_recipe["categoryModID"]
            if raw_recipe.get("categoryUniqueID"):
                recipe["source"]["rawRecipeId"] = raw_recipe["categoryUniqueID"]
            assign_slots(recipe)
            recipe_maps.add(CROP_FARM_MACHINE_TYPE)
            recipes.append(recipe)

            if not crop_farm_icon_pushed:
                recipe_map_icons.append({
                    "recipeMap": CROP_FARM_MACHINE_TYPE,
                    "resource": {
                        "kind": "item", "id": seed_id,
                        "displayName": seed_display_name, "modId": mod_id_of(seed_id),
                    },
                })
                crop_farm_icon_pushed = True

    plant_source_keys = set()
    for pid in VANILLA_PLANT_IDS:
        if f"item:{pid}" in resources:
            plant_source_keys.add(f"item:{pid}")

    def collect_stack(stack):
        if not stack or not stack.get("resource"):
            return
        rid = item_id(stack.get("resource"), stack.get("metadata"))
        if rid:
            plant_source_keys.add(f"item:{rid}")

    for map_name, rmap in (raw.get("recipemaps") or {}).items():
        if not re.search(r"greenhouse", map_name, re.IGNORECASE):
            continue
        for raw_recipe in rmap.get("recipes") or []:
            for input_entry in raw_recipe.get("inputs") or []:
                for stack in input_entry.get("inputStacks") or []:
                    collect_stack(stack)
            for output in raw_recipe.get("outputs") or []:
                collect_stack(output)
            for output in raw_recipe.get("chancedOutputs") or []:
                collect_stack(output)

    # -----------------------------------------------------------------
    # Output
    # -----------------------------------------------------------------

    ore_dictionary = {}
    for name, stacks in (raw.get("oreDict") or {}).items():
        ids = []
        seen = set()
        for stack in stacks if isinstance(stacks, list) else []:
            if not stack:
                continue
            rid = item_id(stack.get("resource"), stack.get("metadata"))
            if rid and rid not in seen:
                seen.add(rid)
                ids.append(rid)
        if ids:
            ore_dictionary[name] = ids

    for resource in resources.values():
        membership = [name for name, ids in ore_dictionary.items() if resource["id"] in ids]
        if membership:
            resource["oreDictionary"] = membership

    dataset = {
        "schemaVersion": 1,
        "datasetVersionId": dataset_version_id,
        "gtnhVersion": susy_version,
        "sourceInfo": {
            "sourceId": "gtnh-oracle",
            "sourceVersion": susy_version,
            "generatedAt": generated_at,
            "notes": f"SusyCore /recipemapdump of Supersymmetry {susy_version}; smelting durations synthesized.",
        },
        "resources": list(resources.values()),
        "recipes": recipes,
        "oreDictionary": ore_dictionary,
        "recipeMaps": sorted(recipe_maps),
    }
    if recipe_map_icons:
        dataset["recipeMapIcons"] = recipe_map_icons
    if machine_handler_icons:
        dataset["machineHandlerIcons"] = machine_handler_icons
    if plant_source_keys:
        dataset["plantSourceKeys"] = sorted(plant_source_keys)
    dataset["generatedAt"] = generated_at

    write_dataset_json(output_path, dataset)
    print(
        f"SUSY dataset written to '{output_path}': {len(recipes)} recipes, {len(resources)} resources, "
        f"{len(ore_dictionary)} oredict entries."
    )

    if args.manifest:
        try:
            update_datasets_manifest(
                args.manifest.expanduser().resolve(),
                output_path.parent,
                dataset_version_id,
                susy_version,
                generated_at,
                args.url_root,
            )
        except (OSError, ValueError, json.JSONDecodeError) as error:
            fail(f"Could not update dataset manifest: {error}")


if __name__ == "__main__":
    main()