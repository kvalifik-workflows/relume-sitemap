#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "skills/relume-sitemap/SKILL.md");
const targets = [
  join(root, "plugins/codex/relume-sitemap/skills/relume-sitemap/SKILL.md"),
  join(root, "plugins/claude/relume-sitemap/skills/relume-sitemap/SKILL.md"),
];
const checkOnly = process.argv.includes("--check");
const sourceText = readFileSync(source, "utf8");
let hasDrift = false;

for (const target of targets) {
  const targetText = readFileSync(target, "utf8");
  if (targetText === sourceText) continue;
  hasDrift = true;
  if (checkOnly) {
    console.error(`Skill copy is out of sync: ${target}`);
  } else {
    writeFileSync(target, sourceText);
    console.log(`Synced ${target}`);
  }
}

if (checkOnly && hasDrift) {
  console.error("Run `npm run sync:skills` to update packaged skill copies.");
  process.exit(1);
}

if (!hasDrift) {
  console.log("Packaged skill copies are in sync.");
}
