import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareVersions,
  findLauncherInstanceInfo,
  findOracleJar,
  inspectInstanceDir,
  parsePackToml,
} from "./susy-instance-lib.mjs";

const PACK_TOML = [
  'name = "Supersymmetry"',
  'author = "SymmetricDevs"',
  'version = "0.1.16.14.1"',
  'pack-format = "packwiz:1.1.0"',
  "",
  "[index]",
  'file = "index.toml"',
  'hash = "abc"',
  "",
  "[versions]",
  'forge = "14.23.5.2860"',
  'minecraft = "1.12.2"',
  "",
].join("\n");

describe("parsePackToml", () => {
  it("reads the name, version and loader versions", () => {
    expect(parsePackToml(PACK_TOML)).toEqual({
      name: "Supersymmetry",
      version: "0.1.16.14.1",
      minecraft: "1.12.2",
      forge: "14.23.5.2860",
    });
  });

  it("ignores comments, other tables and malformed lines", () => {
    const toml = [
      '# version = "9.9.9"',
      "[env]",
      'version = "not-the-pack"',
      "broken = noquotes",
      "[index]",
      'hash = "x"',
      "",
    ].join("\n");
    expect(parsePackToml(toml)).toEqual({
      name: undefined,
      version: undefined,
      minecraft: undefined,
      forge: undefined,
    });
  });
});

describe("compareVersions", () => {
  it("compares numerically, not lexicographically", () => {
    expect(compareVersions("0.2.10", "0.2.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.16.3", "0.1.16.14.1")).toBeLessThan(0);
    expect(compareVersions("0.1.16.14.1", "0.1.16.14.1")).toBe(0);
  });

  it("treats missing versions as oldest", () => {
    expect(compareVersions(undefined, "0.1.0")).toBeLessThan(0);
  });
});

describe("inspectInstanceDir", () => {
  function makeDir(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "susy-instance-"));
    for (const [name, content] of Object.entries(files)) {
      const full = path.join(dir, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    return dir;
  }

  it("recognizes a runnable instance: pack.toml plus real mod jars", () => {
    const dir = makeDir({
      "pack.toml": PACK_TOML,
      "mods/supersymmetry-0.1.16.14.1.jar": "jar",
      "mods/susycore-1.4.jar": "jar",
      "mods/jei.jar": "jar",
      "launch-susy-client.sh": "#!/bin/sh\n",
    });
    const info = inspectInstanceDir(dir);
    expect(info.kind).toBe("instance");
    expect(info.pack?.version).toBe("0.1.16.14.1");
    expect(info.jarCount).toBe(3);
    expect(info.susyJar).toBe("supersymmetry-0.1.16.14.1.jar");
    expect(info.susyCoreJar).toBe("susycore-1.4.jar");
    expect(path.basename(info.launchScript)).toBe("launch-susy-client.sh");
  });

  it("treats packwiz metadata without jars as a pack source, not an instance", () => {
    const dir = makeDir({
      "pack.toml": PACK_TOML,
      "mods/jei.pw.toml": "[update]\n",
    });
    const info = inspectInstanceDir(dir);
    expect(info.kind).toBe("pack-source");
    expect(info.jarCount).toBe(0);
  });

  it("accepts a jar-only directory when a SUSY jar names it", () => {
    const dir = makeDir({ "mods/supersymmetry-1.0.jar": "jar" });
    const info = inspectInstanceDir(dir);
    expect(info.kind).toBe("instance");
    expect(info.pack).toBeUndefined();
  });

  it("returns unknown for an unrelated directory", () => {
    const dir = makeDir({ "mods/readme.txt": "hi" });
    expect(inspectInstanceDir(dir).kind).toBe("unknown");
    expect(inspectInstanceDir(path.join(dir, "missing")).kind).toBe("unknown");
  });
});

describe("findLauncherInstanceInfo", () => {
  function makeWrapper(files) {
    const wrapper = fs.mkdtempSync(path.join(os.tmpdir(), "susy-wrapper-"));
    for (const [name, content] of Object.entries(files)) {
      const full = path.join(wrapper, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    return wrapper;
  }

  const INSTANCE_CFG = [
    "[General]",
    "name=Supersymmetry",
    "ManagedPackName=Supersymmetry",
    "ManagedPackVersionName=0.1.16.14.1",
    "",
  ].join("\n");

  it("finds the wrapper above a Prism-style game dir and reads managed pack metadata", () => {
    const wrapper = makeWrapper({
      "instance.cfg": INSTANCE_CFG,
      "minecraft/mods/susycore-1.4.jar": "jar",
    });
    const info = findLauncherInstanceInfo(path.join(wrapper, "minecraft"));
    expect(info?.instanceId).toBe(path.basename(wrapper));
    expect(info?.managedPackName).toBe("Supersymmetry");
    expect(info?.managedPackVersion).toBe("0.1.16.14.1");
    expect(info?.flatpakAppId).toBeUndefined();
  });

  it("detects a flatpak app id from a .var/app path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "susy-flatpak-"));
    const instance = path.join(
      root,
      ".var",
      "app",
      "org.prismlauncher.PrismLauncher",
      "data",
      "PrismLauncher",
      "instances",
      "SUSY Oracle Export",
    );
    fs.mkdirSync(path.join(instance, "minecraft"), { recursive: true });
    fs.writeFileSync(path.join(instance, "instance.cfg"), INSTANCE_CFG);
    const info = findLauncherInstanceInfo(path.join(instance, "minecraft"));
    expect(info?.instanceId).toBe("SUSY Oracle Export");
    expect(info?.flatpakAppId).toBe("org.prismlauncher.PrismLauncher");
  });

  it("returns undefined when no launcher wrapper owns the directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "susy-plain-"));
    fs.mkdirSync(path.join(dir, "mods"), { recursive: true });
    expect(findLauncherInstanceInfo(dir)).toBeUndefined();
  });
});

describe("findOracleJar", () => {
  // A fresh repo per test: sharing one fixture would let a pipeline-build jar
  // from an earlier case leak into later ones and mask the fallback logic.
  const makeRepo = () => fs.mkdtempSync(path.join(os.tmpdir(), "susy-repo-"));

  it("prefers the explicit env jar", () => {
    const repo = makeRepo();
    const jar = path.join(repo, "explicit.jar");
    fs.writeFileSync(jar, "jar");
    expect(findOracleJar(repo, { SUSY_HEI_ORACLE_JAR: jar })).toBe(jar);
  });

  it("finds the pipeline build and skips sources jars", () => {
    const repo = makeRepo();
    const libs = path.join(repo, "tools", "dataset-pipeline", "susy-hei-oracle", "build", "libs");
    fs.mkdirSync(libs, { recursive: true });
    fs.writeFileSync(path.join(libs, "susy-hei-oracle-1.0.0.jar"), "jar");
    fs.writeFileSync(path.join(libs, "susy-hei-oracle-1.0.0-sources.jar"), "jar");
    expect(findOracleJar(repo, {})).toBe(path.join(libs, "susy-hei-oracle-1.0.0.jar"));
  });

  it("falls back to a repo-local mod checkout build", () => {
    const repo = makeRepo();
    const libs = path.join(repo, "temp", "susy-hei-oracle", "susy-hei-oracle", "build", "libs");
    fs.mkdirSync(libs, { recursive: true });
    fs.writeFileSync(path.join(libs, "susy-hei-oracle-2.0.0.jar"), "jar");
    expect(findOracleJar(repo, {})).toBe(path.join(libs, "susy-hei-oracle-2.0.0.jar"));
  });

  it("prefers the highest-version build across locations", () => {
    const repo = makeRepo();
    const pipelineLibs = path.join(
      repo,
      "tools",
      "dataset-pipeline",
      "susy-hei-oracle",
      "build",
      "libs",
    );
    fs.mkdirSync(pipelineLibs, { recursive: true });
    fs.writeFileSync(path.join(pipelineLibs, "susy-hei-oracle-1.0.0.jar"), "jar");
    const checkoutLibs = path.join(repo, "temp", "susy-hei-oracle", "susy-hei-oracle", "build", "libs");
    fs.mkdirSync(checkoutLibs, { recursive: true });
    fs.writeFileSync(path.join(checkoutLibs, "susy-hei-oracle-2.0.0.jar"), "jar");
    expect(findOracleJar(repo, {})).toBe(path.join(checkoutLibs, "susy-hei-oracle-2.0.0.jar"));
  });
});
