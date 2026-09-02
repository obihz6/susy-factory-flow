import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

// The solve worker loads HiGHS at runtime and fetches its wasm from
// /highs.wasm; this puts the binary where Next serves it. Runs as predev and
// prebuild so neither a dev checkout nor a deploy clone can forget it, and
// the file itself stays out of git.
mkdirSync("public", { recursive: true });
for (const file of ["highs.wasm", "highs.js"]) {
  const source = path.join("node_modules", "highs", "build", file);
  const target = path.join("public", file);
  if (!existsSync(source)) {
    console.error(`${source} not found; run npm install first.`);
    process.exit(1);
  }
  if (!existsSync(target) || statSync(target).size !== statSync(source).size) {
    copyFileSync(source, target);
    console.log(`copied ${source} -> ${target}`);
  }
}
