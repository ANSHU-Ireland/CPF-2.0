#!/usr/bin/env node
/**
 * Docs cross-link check (Delivery Plan Step 49). Scans every markdown file
 * under docs/ (plus root-level README.md) for relative markdown links
 * (`[text](path)` and `[text](path#anchor)`) and verifies the target file
 * exists on disk. Does not check external (http/https) links or mailto:
 * links. Exits non-zero and prints every broken link if any are found, so
 * this can be wired into CI later without any further changes.
 *
 * Usage: node tools/docs-link-check.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { readdirSync } from "node:fs";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function collectMarkdownFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectMarkdownFiles(full, acc);
    } else if (extname(entry.name) === ".md") {
      acc.push(full);
    }
  }
  return acc;
}

const files = [
  ...collectMarkdownFiles(join(repoRoot, "docs")),
  join(repoRoot, "README.md"),
].filter((f) => existsSync(f));

const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
const broken = [];

for (const file of files) {
  const content = readFileSync(file, "utf8");
  let match;
  while ((match = linkPattern.exec(content)) !== null) {
    const target = match[1].trim();
    if (/^(https?:|mailto:|#)/.test(target)) continue; // external / same-page anchors
    const [pathPart] = target.split("#");
    if (!pathPart) continue;
    const resolved = resolve(dirname(file), pathPart);
    if (!existsSync(resolved)) {
      broken.push({ file: file.replace(repoRoot + "\\", "").replace(repoRoot + "/", ""), target });
    }
  }
}

if (broken.length > 0) {
  console.error(`Found ${broken.length} broken relative link(s):`);
  for (const b of broken) console.error(`  ${b.file} -> ${b.target}`);
  process.exit(1);
}

console.log(`Docs link check passed: ${files.length} markdown files scanned, 0 broken relative links.`);
