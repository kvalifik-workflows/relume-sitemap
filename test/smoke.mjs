import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { gzipSync } from "node:zlib";

const root = resolve(new URL("..", import.meta.url).pathname);
const cli = join(root, "bin/relume-sitemap.mjs");
const fixture = join(root, "test/fixtures/crawl.json");
const temp = mkdtempSync(join(tmpdir(), "relume-sitemap-"));

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function runFailure(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
  });
  assert.notEqual(result.status, 0, `Expected command to fail: ${args.join(" ")}`);
  return `${result.stdout}\n${result.stderr}`;
}

function runAsync(args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectRun);
    child.on("close", (status) => {
      if (status !== 0) {
        rejectRun(new Error(`Command failed: ${args.join(" ")}\n${stdout}\n${stderr}`));
        return;
      }
      resolveRun(stdout);
    });
  });
}

async function startFixtureServer() {
  const pages = new Map([
    [
      "/",
      '<!doctype html><title>Fixture Home</title><meta name="description" content="Home from local server."><main><h1>Fixture Home</h1><a href="/about">About</a><a href="/services">Services</a></main>',
    ],
    [
      "/about",
      '<!doctype html><title>About | Fixture</title><meta name="description" content="About from local server."><main><h1>About</h1></main>',
    ],
    [
      "/services",
      '<!doctype html><title>Services | Fixture</title><meta name="description" content="Services from local server."><main><h1>Services</h1><a href="/services/websites">Websites</a></main>',
    ],
    [
      "/services/websites",
      '<!doctype html><title>Websites | Fixture</title><meta name="description" content="Websites from local server."><main><h1>Websites</h1></main>',
    ],
  ]);
  const server = createServer((request, response) => {
    if (request.url === "/sitemap.xml") {
      const origin = `http://${request.headers.host}`;
      response.writeHead(200, { "content-type": "application/xml" });
      response.end(
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...[...pages.keys()].map((path) => `  <url><loc>${origin}${path}</loc></url>`),
          "</urlset>",
          "",
        ].join("\n"),
      );
      return;
    }

    const html = pages.get(request.url);
    if (html) {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(html);
      return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });
  const listening = once(server, "listening");
  const failed = once(server, "error").then(([error]) => {
    throw error;
  });
  server.listen(0, "127.0.0.1");
  try {
    await Promise.race([listening, failed]);
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") {
      console.warn(`Skipping local HTTP crawl tests: ${error.message}`);
      return null;
    }
    throw error;
  }
  const address = server.address();
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

let fixtureServer;

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
  assert.doesNotMatch(JSON.stringify(payload), / Section"/);
  assert.doesNotMatch(JSON.stringify(payload), /Page section focused/);
  assert.match(
    runFailure(["copy", "--payload", join(withSections, "relume-payload.html")], { env: { RELUME_SITEMAP_TEST_PLATFORM: "linux" } }),
    /copy currently requires macOS/,
  );

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

  const prefixCrawl = join(temp, "prefix-crawl.json");
  const prefixConfig = join(temp, "prefix-config.json");
  writeFileSync(
    prefixCrawl,
    `${JSON.stringify(
      {
        stats: { crawledAt: "2026-05-07T00:00:00.000Z", sourceSitemap: "fixture", include: "/", baseUrl: "https://example.com", urlCount: 4 },
        pages: [
          { url: "https://example.com/", path: "/", status: 200, name: "Home", title: "Home", description: "", type: "home", headings: [], links: [], sections: [] },
          { url: "https://example.com/blog", path: "/blog", status: 200, name: "Blog", title: "Blog", description: "", type: "page", headings: [], links: [], sections: [] },
          { url: "https://example.com/blog/post", path: "/blog/post", status: 200, name: "Post", title: "Post", description: "", type: "page", headings: [], links: [], sections: [] },
          { url: "https://example.com/blogger", path: "/blogger", status: 200, name: "Blogger", title: "Blogger", description: "", type: "page", headings: [], links: [], sections: [] },
        ],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    prefixConfig,
    `${JSON.stringify({ groups: [{ name: "Blog", hubPath: "/blog", itemPrefix: "/blog" }], sections: "none" }, null, 2)}\n`,
  );
  const prefixOut = join(temp, "prefix-out");
  run(["build", "--crawl", prefixCrawl, "--out", prefixOut, "--config", prefixConfig, "--custom-groups"]);
  const prefixPayload = JSON.parse(readFileSync(join(prefixOut, "relume-payload.json"), "utf8"));
  const blogNode = prefixPayload.state.subPages.find((page) => page.name === "Blog");
  const ungroupedNode = prefixPayload.state.subPages.find((page) => page.name === "Ungrouped");
  assert.deepEqual(blogNode.subPages.map((page) => page.name), ["Post"]);
  assert.deepEqual(ungroupedNode.subPages.map((page) => page.name), ["Blogger"]);

  const overridePath = join(temp, "section-overrides.json");
  writeFileSync(
    overridePath,
    `${JSON.stringify(
      {
        pages: [
          {
            path: "/",
            sections: [
              { name: "Hero Section", description: 'Page section focused on "Hero".' },
              { name: "Featured Work Section", description: "" },
            ],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  const overrideOut = join(temp, "override-out");
  run(["build", "--crawl", fixture, "--out", overrideOut, "--sections", "ai", "--section-overrides", overridePath]);
  const overridePayload = JSON.parse(readFileSync(join(overrideOut, "relume-payload.json"), "utf8"));
  const overrideSitemap = readFileSync(join(overrideOut, "sitemap.md"), "utf8");
  assert.deepEqual(
    overridePayload.state.sections.filter((section) => section.type === "inline").map((section) => section.value.name),
    ["Hero", "Featured Work"],
  );
  assert.doesNotMatch(JSON.stringify(overridePayload), /Page section focused/);
  assert.match(overrideSitemap, /"source": "section-overrides"/);

  const cmsCrawl = join(temp, "cms-crawl.json");
  writeFileSync(
    cmsCrawl,
    `${JSON.stringify(
      {
        stats: { crawledAt: "2026-05-07T00:00:00.000Z", sourceSitemap: "fixture", include: "/", baseUrl: "https://example.com", urlCount: 8 },
        pages: [
          { url: "https://example.com/", path: "/", status: 200, name: "Home", title: "Home", description: "", type: "home", headings: [], links: [], sections: [] },
          { url: "https://example.com/blog", path: "/blog", status: 200, name: "Blog", title: "Blog", description: "", type: "page", headings: [], links: [], sections: [] },
          ...Array.from({ length: 6 }, (_, index) => ({
            url: `https://example.com/blog/post-${index + 1}`,
            path: `/blog/post-${index + 1}`,
            status: 200,
            name: `Post ${index + 1}`,
            title: `Post ${index + 1}`,
            description: "",
            type: "page",
            headings: [{ level: 1, text: `Post ${index + 1}` }],
            links: [],
            sections: [],
          })),
        ],
      },
      null,
      2,
    )}\n`,
  );
  assert.match(run(["analyze-cms", "--crawl", cmsCrawl]), /\/blog -> Blog Post Template/);
  const cmsOut = join(temp, "cms-out");
  run(["build", "--crawl", cmsCrawl, "--out", cmsOut, "--cms-mode", "templates"]);
  const cmsPayload = JSON.parse(readFileSync(join(cmsOut, "relume-payload.json"), "utf8"));
  const cmsBlog = cmsPayload.state.subPages.find((page) => page.name === "Blog");
  assert.deepEqual(cmsBlog.subPages.map((page) => page.name), ["Blog Post Template"]);

  const escapingConfig = join(temp, "escaping-config.json");
  writeFileSync(escapingConfig, `${JSON.stringify({ siteName: '<Site & "Name">' }, null, 2)}\n`);
  const escapingOut = join(temp, "escaping");
  run(["build", "--crawl", fixture, "--out", escapingOut, "--config", escapingConfig]);
  const copyPage = readFileSync(join(escapingOut, "copy-to-clipboard.html"), "utf8");
  const sitemapMarkdown = readFileSync(join(escapingOut, "sitemap.md"), "utf8");
  assert.doesNotMatch(copyPage, /<title>Copy <Site/);
  assert.match(copyPage, /Copy &lt;Site &amp; "Name"&gt; Relume Payload/);
  assert.match(sitemapMarkdown, /^# &lt;Site &amp; "Name"&gt; Visual Sitemap/m);

  const nestedSitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "  <url><loc><![CDATA[https://example.com/nested-one]]></loc></url>",
    "  <url><loc>https://example.com/nested-two</loc></url>",
    "</urlset>",
    "",
  ].join("\n");
  writeFileSync(join(temp, "nested-sitemap.xml.gz"), gzipSync(nestedSitemap));
  writeFileSync(
    join(temp, "sitemap-index.xml"),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      "  <sitemap><loc>nested-sitemap.xml.gz</loc></sitemap>",
      "</sitemapindex>",
      "",
    ].join("\n"),
  );
  assert.match(run(["inspect", "--sitemap", join(temp, "sitemap-index.xml")]), /Found 2 URLs/);

  const localFixture = await startFixtureServer();
  if (localFixture) {
    fixtureServer = localFixture.server;
    const inspected = await runAsync(["inspect", "--sitemap", `${localFixture.origin}/sitemap.xml`]);
    assert.match(inspected, /Found 4 URLs/);

    const localCrawlOut = join(temp, "local-crawl");
    await runAsync(["crawl", "--sitemap", `${localFixture.origin}/sitemap.xml`, "--include", "/", "--out", localCrawlOut, "--concurrency", "2"]);
    const localCrawl = JSON.parse(readFileSync(join(localCrawlOut, "crawl.json"), "utf8"));
    assert.equal(localCrawl.stats.urlCount, 4);
    assert.equal(localCrawl.stats.statusCounts["200"], 4);
    assert.deepEqual(localCrawl.pages.find((page) => page.path === "/").links, ["/about", "/services"]);
    assert.deepEqual(localCrawl.pages.find((page) => page.path === "/services").links, ["/services/websites"]);
  }

  assert.match(runFailure(["validate", "--payload", fixture]), /No data-blocks-payload-v1 attribute found/);
} finally {
  if (fixtureServer) {
    await new Promise((resolveClose) => fixtureServer.close(resolveClose));
  }
  rmSync(temp, { recursive: true, force: true });
}
