import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const cli = join(root, "bin/relume-sitemap.mjs");
const fixture = join(root, "test/fixtures/crawl.json");
const temp = mkdtempSync(join(tmpdir(), "relume-sitemap-"));

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function runFailure(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0, `Expected command to fail: ${args.join(" ")}`);
  return `${result.stdout}\n${result.stderr}`;
}

try {
  const help = run(["--help"]);
  assert.match(help, /Relume Sitemap Tool/);

  const withSections = join(temp, "with-sections");
  run(["build", "--crawl", fixture, "--out", withSections, "--sections", "include"]);
  const validWithSections = run(["validate", "--payload", join(withSections, "relume-payload.html")]);
  assert.match(validWithSections, /Valid Relume payload/);

  const payload = JSON.parse(readFileSync(join(withSections, "relume-payload.json"), "utf8"));
  assert.equal(payload.type, "page");
  assert.equal(payload.state.name, "Example Home");
  assert.equal(payload.state.subPages.length, 2);
  assert.ok(payload.state.sections.length > 0);

  const withoutSections = join(temp, "without-sections");
  run(["build", "--crawl", fixture, "--out", withoutSections, "--sections", "none"]);
  const payloadWithoutSections = JSON.parse(readFileSync(join(withoutSections, "relume-payload.json"), "utf8"));
  assert.equal(payloadWithoutSections.state.sections.length, 0);

  assert.match(
    runFailure(["crawl", "--sitemap", fixture, "--include", "/", "--out", join(temp, "invalid-concurrency"), "--concurrency", "0"]),
    /crawl --concurrency must be a positive integer/,
  );
  assert.match(
    runFailure(["discover", "--url", "https://example.com", "--out", join(temp, "invalid-max-pages"), "--max-pages", "nope"]),
    /discover --max-pages must be a positive integer/,
  );
  assert.match(
    runFailure(["crawl", "--sitemap", fixture, "--include", "/", "--out", join(temp, "invalid-retries"), "--retries", "-1"]),
    /crawl --retries must be a non-negative integer/,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
