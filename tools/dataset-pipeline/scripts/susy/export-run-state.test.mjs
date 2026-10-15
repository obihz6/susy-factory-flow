import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetSusyExportRunState } from "./export-run-state.mjs";

const tempDirs = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("SUSY export run state", () => {
  it("clears old dumps, rendered icons, and runtime crash logs on retry", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "susy-export-state-"));
    tempDirs.push(root);
    const raw = path.join(root, "raw-export");
    const jvm = path.join(root, "instance-export");
    const runtimeLog = path.join(raw, "susy-runtime.log");
    const errorLog = path.join(raw, "susy-runtime.err.log");
    const instanceDump = path.join(root, "instance", "recipedump.json");
    await fs.mkdir(path.dirname(instanceDump), { recursive: true });
    await fs.mkdir(path.join(raw, "rendered-icons"), { recursive: true });
    await fs.mkdir(path.join(jvm, "rendered-icons"), { recursive: true });
    await fs.writeFile(path.join(raw, "recipedump.json"), '{"old":true}');
    await fs.writeFile(path.join(jvm, "recipedump.json"), '{"old":true}');
    await fs.writeFile(instanceDump, '{"old":true}');
    await fs.writeFile(path.join(raw, "rendered-icons", "old.png"), "old");
    await fs.writeFile(path.join(jvm, "rendered-icons", "old.png"), "old");
    await fs.writeFile(runtimeLog, "Minecraft Crash Report from the previous attempt\n");
    await fs.writeFile(errorLog, "previous launch failure\n");

    await resetSusyExportRunState({
      rawExportDir: raw,
      runtimeLogPath: runtimeLog,
      runtimeErrorLogPath: errorLog,
      jvmExportRoot: jvm,
      oracleGameDumpPath: instanceDump,
    });

    await expect(fs.access(path.join(raw, "recipedump.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.access(path.join(jvm, "recipedump.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.access(instanceDump)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(path.join(raw, "rendered-icons"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.access(path.join(jvm, "rendered-icons"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await fs.readFile(runtimeLog, "utf8")).toBe("");
    expect(await fs.readFile(errorLog, "utf8")).toBe("");
  });
});
