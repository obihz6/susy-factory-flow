import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
import uuid
from pathlib import Path


SCRIPT = Path(__file__).with_name("normalize_susy_recipedump.py")
FIXTURE = Path(__file__).with_name("fixture-recipedump.json")

sys.path.insert(0, str(Path(__file__).parent))
import normalize_susy_recipedump as normalizer  # noqa: E402


class NormalizeSusyRecipedumpTests(unittest.TestCase):
    def run_normalizer(self, output, *args, input_path=FIXTURE):
        environment = os.environ.copy()
        environment.pop("SUSY_DATASET_VERSION_ID", None)
        environment.pop("SUSY_DATASET_VERSION_LABEL", None)
        return subprocess.run(
            [sys.executable, str(SCRIPT), str(input_path), str(output), *args],
            capture_output=True,
            text=True,
            env=environment,
            check=False,
        )

    def test_fixture_is_normalized_to_plain_recipe_dataset(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "recipes.json"
            result = self.run_normalizer(
                output,
                "--version-id",
                "susy-test",
                "--version-label",
                "0.1.16.7.1",
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            dataset = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(dataset["schemaVersion"], 1)
            self.assertEqual(dataset["datasetVersionId"], "susy-test")
            self.assertEqual(dataset["gtnhVersion"], "0.1.16.7.1")
            self.assertEqual(dataset["sourceInfo"]["sourceId"], "gtnh-oracle")
            self.assertEqual(len(dataset["recipes"]), 11)
            self.assertEqual(dataset["oreDictionary"]["ingotIron"], ["minecraft:iron_ingot"])

    def test_discovers_recipedump_under_the_temp_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            repo_root = Path(directory) / "repo"
            expected = repo_root / "temp" / "raw-export" / "recipedump.json"
            expected.parent.mkdir(parents=True)
            expected.write_text("{}", encoding="utf-8")

            discovered = normalizer.discover_recipedump(
                repo_root=repo_root,
                cwd=Path(directory) / "elsewhere",
                env={},
            )

            self.assertEqual(discovered, expected.resolve())

    def test_missing_version_generates_a_uuid_and_dataset_output_path(self):
        with tempfile.TemporaryDirectory() as directory:
            dataset_root = Path(directory) / "datasets"
            environment = os.environ.copy()
            environment.pop("SUSY_DATASET_VERSION_ID", None)
            environment.pop("SUSY_DATASET_VERSION_LABEL", None)
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    str(FIXTURE),
                    "--dataset-root",
                    str(dataset_root),
                ],
                capture_output=True,
                text=True,
                env=environment,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            version_dirs = [entry for entry in dataset_root.iterdir() if entry.is_dir()]
            self.assertEqual(len(version_dirs), 1)
            generated_id = version_dirs[0].name
            self.assertEqual(uuid.UUID(generated_id).version, 4)
            dataset = json.loads((version_dirs[0] / "recipes.json").read_text(encoding="utf-8"))
            self.assertEqual(dataset["datasetVersionId"], generated_id)
            self.assertEqual(dataset["gtnhVersion"], f"SUSY {generated_id}")

    def test_invalid_json_is_rejected_with_a_clear_error(self):
        with tempfile.TemporaryDirectory() as directory:
            invalid = Path(directory) / "invalid.json"
            invalid.write_text("{not json", encoding="utf-8")
            result = self.run_normalizer(Path(directory) / "recipes.json", input_path=invalid)

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Input is not valid JSON", result.stderr)

    def test_manifest_is_not_advertised_before_packaging(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "recipes.json"
            manifest = Path(directory) / "datasets.manifest.json"
            result = self.run_normalizer(
                output,
                "--version-id",
                "susy-test",
                "--version-label",
                "0.1.16.7.1",
                "--manifest",
                str(manifest),
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("packaged artifacts", result.stderr)
            self.assertFalse(manifest.exists())

    def test_manifest_uses_packaged_lookup_index_checksum(self):
        with tempfile.TemporaryDirectory() as directory:
            dataset_dir = Path(directory)
            output = dataset_dir / "recipes.json"
            manifest = dataset_dir / "datasets.manifest.json"
            for name in (
                "recipes.json.gz",
                "resource-index.json.gz",
                "recipe-index.json.gz",
                "recipe-lookup-index.json.gz",
            ):
                (dataset_dir / name).write_bytes(name.encode())

            result = self.run_normalizer(
                output,
                "--version-id",
                "susy-test",
                "--version-label",
                "0.1.16.7.1",
                "--manifest",
                str(manifest),
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            entry = json.loads(manifest.read_text(encoding="utf-8"))["versions"][0]
            self.assertEqual(entry["recipeDatasetPath"], "/datasets/susy/susy-test/recipes.json.gz")
            self.assertEqual(
                entry["checksumSha256"],
                hashlib.sha256(b"recipe-lookup-index.json.gz").hexdigest(),
            )
            self.assertEqual(entry["sourceInfo"]["sourceId"], "gtnh-oracle")


if __name__ == "__main__":
    unittest.main()
