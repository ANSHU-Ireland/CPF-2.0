#!/usr/bin/env node
// Delivery Plan Step 50 — reproducible source archive for a tagged release.
//
// Wraps `git archive` so the release process is documented and repeatable
// rather than a one-off manual command. Produces a tarball of exactly the
// tracked files at HEAD (no node_modules, no local .env/database state, no
// build output) and writes it to dist/ (gitignored — the archive itself is
// never committed as a binary artifact).
//
// Usage: node tools/release/make-source-archive.mjs [ref]
//   ref defaults to HEAD.

import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");
const ref = process.argv[2] ?? "HEAD";

const shortSha = execFileSync("git", ["rev-parse", "--short", ref], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();

const outDir = path.join(repoRoot, "dist");
mkdirSync(outDir, { recursive: true });

const outFile = path.join(outDir, `cpf-source-${shortSha}.tar.gz`);

execFileSync(
  "git",
  ["archive", "--format=tar.gz", `--output=${outFile}`, `--prefix=cpf-${shortSha}/`, ref],
  { cwd: repoRoot, stdio: "inherit" },
);

const { size } = statSync(outFile);
console.log(`Source archive written: ${path.relative(repoRoot, outFile)} (${(size / 1024).toFixed(1)} KiB, ref ${ref} @ ${shortSha})`);
