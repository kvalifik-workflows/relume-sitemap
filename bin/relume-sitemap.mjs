#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import {
  FOOTER_ID,
  NAVBAR_ID,
  commentThreads,
  countRelumePages,
  escapeHtmlAttribute,
  globalSections,
  sectionReference,
  sectionValue,
  validatePayloadHtml,
} from "../src/relume/payload.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const toolRoot = resolve(here, "..");
const DEFAULT_FETCH_TIMEOUT_MS = 30000;
const DEFAULT_FETCH_RETRIES = 1;

const COMMON_TYPE_RULES = [
  ["article-category", /^\/[^/]+\/articles-categories\//],
  ["news-category", /^\/[^/]+\/news-categories\//],
  ["article", /^\/[^/]+\/articles\//],
  ["news", /^\/[^/]+\/news\//],
  ["question", /^\/[^/]+\/questions\//],
  ["expert", /^\/[^/]+\/experts\//],
  ["success-story", /^\/[^/]+\/success-stories\//],
  ["women-topic", /^\/[^/]+\/women\//],
  ["men-topic", /^\/[^/]+\/men\//],
  ["legal", /\/(privacy-policy|terms-of-service|cookie-policy|web-accessibility)$/],
  ["info", /^\/[^/]+\/info\//],
  ["home", /^\/(?:[a-z]{2}(?:-[a-z]{2})?)?\/?$/i],
];

const CMS_COLLECTION_LABELS = new Map([
  ["articles-categories", "Articles Category"],
  ["article-categories", "Article Category"],
  ["news-categories", "News Category"],
  ["categories", "Category"],
  ["topics", "Topic"],
  ["articles", "Article"],
  ["article", "Article"],
  ["blog", "Blog Post"],
  ["blogs", "Blog Post"],
  ["posts", "Post"],
  ["news", "News Article"],
  ["insights", "Insight"],
  ["resources", "Resource"],
  ["guides", "Guide"],
  ["ebooks", "Ebook"],
  ["whitepapers", "Whitepaper"],
  ["case-studies", "Case Study"],
  ["cases", "Case Study"],
  ["success-stories", "Success Story"],
  ["projects", "Project"],
  ["project", "Project"],
  ["work", "Project"],
  ["portfolio", "Project"],
  ["events", "Event"],
  ["webinars", "Webinar"],
  ["press", "Press Item"],
  ["questions", "Question"],
  ["faqs", "Question"],
  ["experts", "Expert"],
  ["team", "Team Member"],
  ["people", "Person"],
  ["authors", "Author"],
  ["locations", "Location"],
  ["products", "Product"],
  ["jobs", "Job"],
  ["careers", "Job"],
  ["recipes", "Recipe"],
]);

const CMS_PAGE_TYPES = new Set(["article", "news", "question", "expert", "success-story"]);

function help() {
  console.log(`Relume Sitemap Tool

Usage:
  relume-sitemap inspect --sitemap <url-or-file>
  relume-sitemap discover --url <url> --out <dir> [--max-pages 500] [--concurrency 6] [--fetch-timeout 30000] [--retries 1] [--include /] [--exclude /da,/fr]
  relume-sitemap crawl --sitemap <url-or-file> --include <path-prefix> --out <dir> [--concurrency 6] [--fetch-timeout 30000] [--retries 1]
  relume-sitemap analyze-cms --crawl <crawl.json> [--config <config.json>] [--json]
  relume-sitemap build --crawl <crawl.json> --out <dir> [--config <config.json>] [--sections include|none|ai] [--section-overrides <json>] [--cms-mode expanded|templates] [--cms-include /blog,/projects] [--cms-exclude /team] [--custom-groups] [--copy]
  relume-sitemap copy --payload <relume-payload.html>
  relume-sitemap validate --payload <relume-payload.html>

Examples:
  relume-sitemap inspect --sitemap https://www.example.com/sitemap.xml
  relume-sitemap discover --url https://www.example.com --out ./work/example
  relume-sitemap crawl --sitemap https://www.example.com/sitemap.xml --include / --exclude /da --out ./work/example-en
  relume-sitemap analyze-cms --crawl ./work/example-en/crawl.json
  relume-sitemap build --crawl ./work/example/crawl.json --sections include --cms-mode expanded --out ./work/example --copy
  relume-sitemap build --crawl ./work/example/crawl.json --sections ai --section-overrides ./work/example/section-overrides.json --out ./work/example-ai
`);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function absPath(path, cwd = process.cwd()) {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function truncateText(value = "", maxLength = 500) {
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function cleanSectionName(value = "", fallback = "Content") {
  const text = truncateText(value, 90)
    .replace(/[.?!]+$/g, "")
    .replace(/\s+section$/i, "")
    .trim();
  return text || fallback;
}

function cleanSectionDescription(value = "") {
  const text = truncateText(value, 520);
  if (/^Page section focused on "[^"]+"\.$/i.test(text)) return "";
  return text;
}

function sectionPlanItem(name, description = "", fallback = "Content") {
  return {
    name: cleanSectionName(name, fallback),
    description: cleanSectionDescription(description),
  };
}

function parsePositiveInteger(value, fallback, label, options = {}) {
  const raw = value ?? fallback;
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  if (options.max && number > options.max) {
    throw new Error(`${label} must be less than or equal to ${options.max}.`);
  }
  return number;
}

function parseNonNegativeInteger(value, fallback, label, options = {}) {
  const raw = value ?? fallback;
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  if (options.max && number > options.max) {
    throw new Error(`${label} must be less than or equal to ${options.max}.`);
  }
  return number;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function abortMessage(error) {
  return error?.name === "AbortError" ? "request timed out" : error.message;
}

async function fetchWithTimeout(url, options = {}, fetchOptions = {}) {
  const timeoutMs = fetchOptions.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    throw new Error(`Fetch failed for ${url}: ${abortMessage(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRetries(url, options = {}, fetchOptions = {}) {
  const retries = fetchOptions.retries ?? DEFAULT_FETCH_RETRIES;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, options, fetchOptions);
      if (response.status < 500 || attempt === retries) return response;
      lastError = new Error(`Fetch failed for ${url}: HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
    }
    await sleep(250 * (attempt + 1));
  }
  throw lastError;
}

function normalizeSectionMode(value = "include") {
  if (value === true) throw new Error("--sections requires a value: include, none, or ai");
  const normalized = String(value).toLowerCase();
  if (["include", "sections", "with", "yes", "true"].includes(normalized)) return "include";
  if (["none", "omit", "without", "no", "false"].includes(normalized)) return "none";
  if (["ai", "condensed", "smart", "ai-condensed"].includes(normalized)) return "ai";
  throw new Error(`Unknown --sections mode "${value}". Use "include", "none", or "ai".`);
}

function normalizeCmsMode(value = "expanded") {
  if (value === true) throw new Error("--cms-mode requires a value: expanded or templates");
  const normalized = String(value).toLowerCase();
  if (["expanded", "items", "all", "pages", "individual", "subpages"].includes(normalized)) return "expanded";
  if (["templates", "template", "collapsed", "collapse"].includes(normalized)) return "templates";
  throw new Error(`Unknown --cms-mode "${value}". Use "expanded" or "templates".`);
}

function parsePathList(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : String(value).split(",");
  return values.map((item) => normalizePath(item.trim())).filter(Boolean);
}

function pathMatchesPrefix(path, prefix) {
  const normalized = normalizePath(prefix);
  if (normalized === "/") return path === "/" || path.startsWith("/");
  return path === normalized || path.startsWith(`${normalized}/`);
}

function normalizePath(urlLike, baseUrl = "https://example.com") {
  try {
    const url = new URL(urlLike, baseUrl);
    let path = url.pathname.replace(/\/+$/, "");
    if (!path) path = "/";
    return path;
  } catch {
    return "";
  }
}

function stripHash(path) {
  return path.split("#")[0].replace(/\/+$/, "") || "/";
}

function inferBaseUrl(urls) {
  const first = urls.find((url) => /^https?:\/\//.test(url));
  if (!first) return "https://example.com";
  const parsed = new URL(first);
  return `${parsed.protocol}//${parsed.host}`;
}

function decodeTextBuffer(buffer) {
  const bytes = Buffer.from(buffer);
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  return (isGzip ? gunzipSync(bytes) : bytes).toString("utf8");
}

async function readTextResource(input, options = {}) {
  if (/^https?:\/\//.test(input)) {
    const response = await fetchWithRetries(input, {
      headers: {
        "User-Agent": "Relume Sitemap Tool",
        Accept: "application/xml,text/xml,text/html,*/*",
      },
    }, options);
    if (!response.ok) throw new Error(`Fetch failed for ${input}: HTTP ${response.status}`);
    return decodeTextBuffer(await response.arrayBuffer());
  }
  return decodeTextBuffer(readFileSync(absPath(input)));
}

function urlsFromSitemap(xml) {
  return [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]+))\s*<\/loc>/gi)].map((match) =>
    decodeHtml((match[1] ?? match[2]).trim()),
  );
}

function isSitemapIndex(xml) {
  return /<sitemapindex\b/i.test(xml);
}

function resolveSitemapReference(reference, parent) {
  if (/^https?:\/\//.test(reference)) return reference;
  if (/^https?:\/\//.test(parent)) return new URL(reference, parent).toString();
  return absPath(reference, dirname(absPath(parent)));
}

async function urlsFromSitemapResource(input, options = {}, seen = new Set()) {
  const key = /^https?:\/\//.test(input) ? input : absPath(input);
  if (seen.has(key)) return [];
  seen.add(key);

  const sitemapXml = await readTextResource(input, options);
  const locs = uniqueOrdered(urlsFromSitemap(sitemapXml));
  if (!isSitemapIndex(sitemapXml)) return locs;

  const urls = [];
  for (const loc of locs) {
    urls.push(...(await urlsFromSitemapResource(resolveSitemapReference(loc, input), options, seen)));
  }
  return uniqueOrdered(urls);
}

function xmlEscape(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeHtml(value = "") {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, num) => String.fromCodePoint(Number.parseInt(num, 10)))
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "-")
    .replace(/&ndash;/g, "-")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, "\"")
    .replace(/&ldquo;/g, "\"");
}

function cleanText(value = "") {
  return decodeHtml(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function uniqueOrdered(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = String(value).toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function extractFirst(regex, html) {
  const match = html.match(regex);
  return match ? cleanText(match[1]) : "";
}

function mainHtml(html) {
  const match = html.match(/<main\b[\s\S]*?<\/main>/i);
  return match ? match[0] : html;
}

function extractHeadings(html) {
  const content = mainHtml(html);
  const headings = [];
  for (const match of content.matchAll(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = cleanText(match[2]);
    if (!text || text.length > 180) continue;
    if (/^(search|country|featured news|read more|get started)$/i.test(text)) continue;
    headings.push({ level: Number(match[1]), text });
  }
  return uniqueOrdered(headings.map((heading) => `${heading.level}:${heading.text}`)).map((packed) => {
    const [level, ...parts] = packed.split(":");
    return { level: Number(level), text: parts.join(":") };
  });
}

function extractTextBlocks(html) {
  const content = mainHtml(html);
  const blocks = [];
  for (const match of content.matchAll(/<(h[1-4]|p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const tag = match[1].toLowerCase();
    const text = cleanText(match[2]);
    if (!text || text.length < 4 || text.length > 260) continue;
    if (/^(search|country|featured news|read more|get started|previous|next)$/i.test(text)) continue;
    blocks.push({ type: tag, text });
    if (blocks.length >= 80) break;
  }
  return uniqueOrdered(blocks.map((block) => `${block.type}:${block.text}`)).map((packed) => {
    const [type, ...parts] = packed.split(":");
    return { type, text: parts.join(":") };
  });
}

function extractLinks(html, pathSet, baseUrl) {
  const links = [];
  for (const match of html.matchAll(/href=(?:"([^"]+)"|'([^']+)')/gi)) {
    const raw = match[1] ?? match[2] ?? "";
    if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) continue;
    const path = stripHash(normalizePath(raw, baseUrl));
    if (pathSet.has(path)) links.push(path);
  }
  return uniqueOrdered(links);
}

function titleFromPath(path) {
  const last = path.split("/").filter(Boolean).at(-1) ?? "home";
  return last
    .replace(/-/g, " ")
    .replace(/\buk\b/i, "UK")
    .replace(/\bbmi\b/i, "BMI")
    .replace(/\bgp\b/i, "GP")
    .replace(/\bglp\b/i, "GLP")
    .replace(/\bpcos\b/i, "PCOS")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pageNameFromTitle(title, path, type) {
  if (type?.endsWith("-category")) return titleFromPath(path);
  const cleaned = title
    .replace(/\s*\|\s*[^|]{1,40}$/i, "")
    .replace(/\s+-\s+[^-]{1,40}$/i, "")
    .trim();
  if (cleaned && cleaned.length <= 90) return cleaned;
  return titleFromPath(path);
}

function inferPageType(path, config = {}) {
  for (const rule of config.typeRules ?? []) {
    if (rule.path && path === rule.path) return rule.type;
    if (rule.prefix && path.startsWith(rule.prefix)) return rule.type;
    if (rule.pattern && new RegExp(rule.pattern).test(path)) return rule.type;
  }
  for (const [type, regex] of COMMON_TYPE_RULES) {
    if (regex.test(path)) return type;
  }
  if (path.split("/").filter(Boolean).length <= 2) return "page";
  return "page";
}

function pathParts(path) {
  return path.split("/").filter(Boolean);
}

function parentPathFor(path) {
  const parts = pathParts(path);
  if (parts.length <= 1) return "/";
  return `/${parts.slice(0, -1).join("/")}`;
}

function lastPathSegment(path) {
  return pathParts(path).at(-1) ?? "";
}

function isLocaleSegment(segment) {
  return /^[a-z]{2}(?:-[a-z]{2})?$/i.test(segment);
}

function hasDescendantPath(path, pathSet) {
  const prefix = `${path}/`;
  for (const candidate of pathSet) {
    if (candidate.startsWith(prefix)) return true;
  }
  return false;
}

function typeLabel(type) {
  const labels = {
    article: "Article",
    news: "News Article",
    question: "Question",
    expert: "Expert",
    "success-story": "Success Story",
  };
  return labels[type] ?? "";
}

function singularTitle(title) {
  if (/ies$/i.test(title)) return title.replace(/ies$/i, "y");
  if (/s$/i.test(title) && !/ss$/i.test(title)) return title.replace(/s$/i, "");
  return title;
}

function configuredCmsRules(config = {}) {
  return (config.cmsCollections ?? [])
    .map((entry) => (typeof entry === "string" ? { path: entry } : entry))
    .map((entry) => ({
      ...entry,
      path: normalizePath(entry.path ?? entry.parentPath ?? entry.prefix ?? ""),
    }))
    .filter((entry) => entry.path && entry.path !== "/");
}

function detectCmsCollections(pages, config = {}) {
  const pathSet = new Set(pages.map((page) => page.path));
  const configuredRules = configuredCmsRules(config);
  const leavesByParent = new Map();

  for (const page of pages) {
    const parts = pathParts(page.path);
    if (parts.length < 2) continue;
    if (hasDescendantPath(page.path, pathSet)) continue;
    const parentPath = parentPathFor(page.path);
    if (parentPath === "/") continue;
    if (!leavesByParent.has(parentPath)) leavesByParent.set(parentPath, []);
    leavesByParent.get(parentPath).push(page);
  }

  const collections = [];
  for (const [parentPath, items] of leavesByParent) {
    const segment = lastPathSegment(parentPath).toLowerCase();
    const parentParts = pathParts(parentPath);
    const configured = configuredRules.find((rule) => parentPath === rule.path || pathMatchesPrefix(parentPath, rule.path));
    const labelFromSegment = CMS_COLLECTION_LABELS.get(segment);
    const dominantType = mostCommon(items.map((item) => item.type).filter((type) => type && type !== "page"));
    const typeBasedLabel = typeLabel(dominantType);
    const itemCount = items.length;
    const slugLikeCount = items.filter((item) => isSlugLike(lastPathSegment(item.path))).length;
    const likelySegment = Boolean(labelFromSegment);
    const likelyType = Boolean(dominantType && CMS_PAGE_TYPES.has(dominantType));
    const enoughItems = itemCount >= 5;
    const configuredLikely = Boolean(configured);
    const likely = configuredLikely || (enoughItems && (likelySegment || likelyType) && slugLikeCount / itemCount >= 0.7);
    const possible = likely || (itemCount >= 4 && slugLikeCount / itemCount >= 0.75 && !isLocaleSegment(segment));
    if (!possible) continue;

    const label = configured?.label ?? labelFromSegment ?? typeBasedLabel ?? singularTitle(titleFromPath(segment));
    const reasons = [];
    if (configuredLikely) reasons.push("configured CMS collection");
    if (likelySegment) reasons.push(`collection-like folder "${segment}"`);
    if (likelyType) reasons.push(`dominant page type "${dominantType}"`);
    if (!likelySegment && !likelyType && enoughItems) reasons.push(`${itemCount} slug-like leaf pages`);
    if (parentParts.some(isLocaleSegment)) reasons.push("nested below locale path");
    const confidence = likely ? "high" : "medium";

    collections.push({
      path: parentPath,
      label,
      templateName: configured?.templateName ?? `${label} Template`,
      itemCount,
      itemPaths: items.map((item) => item.path),
      items,
      examplePaths: items.slice(0, 5).map((item) => item.path),
      confidence,
      likely,
      reasons,
    });
  }

  return collections.sort((a, b) => b.itemCount - a.itemCount || a.path.localeCompare(b.path));
}

function mostCommon(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

function isSlugLike(segment) {
  if (!segment) return false;
  if (/^\d+$/.test(segment)) return true;
  if (/^[a-z0-9]+(?:-[a-z0-9]+){1,}$/i.test(segment)) return true;
  return segment.length >= 6 && /^[a-z0-9-]+$/i.test(segment);
}

function cmsCollectionSummary(collection) {
  return {
    path: collection.path,
    itemCount: collection.itemCount,
    confidence: collection.confidence,
    likely: collection.likely,
    templateName: collection.templateName,
    reasons: collection.reasons,
    examplePaths: collection.examplePaths,
  };
}

function cmsReport(collections) {
  if (!collections.length) return "No likely CMS collections found from the crawled URL folder layout.";
  return [
    `Found ${collections.length} possible CMS collection${collections.length === 1 ? "" : "s"} from URL folders:`,
    "",
    ...collections.flatMap((collection) => [
      `- ${collection.path} -> ${collection.templateName}`,
      `  Items: ${collection.itemCount}; confidence: ${collection.confidence}; ${collection.likely ? "likely CMS" : "possible CMS"}`,
      `  Reasons: ${collection.reasons.join(", ")}`,
      `  Examples: ${collection.examplePaths.join(", ")}`,
    ]),
    "",
    "Ask whether to keep each CMS item as a sub-page or use one template page per collection before running build.",
  ].join("\n");
}

function templatePathFor(parentPath, usedPaths) {
  const base = normalizePath(`${parentPath}/__cms-template`);
  let candidate = base;
  let index = 2;
  while (usedPaths.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

function cmsTemplateSections(collection) {
  const representative =
    collection.items.find((item) => item.sections?.length) ??
    collection.items.find((item) => item.headings?.length) ??
    collection.items[0];
  if (representative?.sections?.length) {
    return representative.sections.slice(0, 6).map((section) =>
      sectionPlanItem(section.name.replace(/^(Hero|Header|Article|News Article|Story|Profile|Question)\b/i, "Template"), section.description),
    );
  }
  return [
    sectionPlanItem("Template Header", `Reusable header for ${collection.label.toLowerCase()} CMS items under ${collection.path}.`),
    sectionPlanItem("CMS Content Body", `Reusable body layout for item pages in ${collection.path}.`),
    sectionPlanItem("Related Content", `Links or recommendations related to the current ${collection.label.toLowerCase()} item.`),
  ];
}

function cmsTemplatePage(collection, path) {
  const examples = collection.examplePaths.map((itemPath) => `- ${itemPath}`).join("\n");
  const description = [
    `CMS template representing ${collection.itemCount} detected item URLs under ${collection.path}/*.`,
    "",
    "Example item URLs:",
    examples,
  ].join("\n");
  return {
    url: "",
    path,
    status: 200,
    canonical: "",
    name: collection.templateName,
    title: collection.templateName,
    description,
    descriptionWithUrl: description,
    type: "cms-template",
    headings: [],
    textBlocks: [],
    links: [],
    sections: cmsTemplateSections(collection),
  };
}

function pathMatchesAny(path, filters) {
  return filters.some((filter) => path === filter || pathMatchesPrefix(path, filter));
}

function applyCmsTemplateMode(pages, collections, options = {}) {
  const include = options.include ?? [];
  const exclude = options.exclude ?? [];
  const selectedCollections = collections.filter((collection) => {
    if (pathMatchesAny(collection.path, exclude)) return false;
    if (include.length) return pathMatchesAny(collection.path, include);
    return collection.likely;
  });
  if (!selectedCollections.length) return { pages, collapsedCollections: [] };

  const pageIndex = new Map(pages.map((page, index) => [page.path, index]));
  const usedPaths = new Set(pages.map((page) => page.path));
  const removedPaths = new Set();
  const templatesByIndex = new Map();
  const collapsedCollections = [];

  for (const collection of selectedCollections) {
    const existingItemPaths = collection.itemPaths.filter((path) => pageIndex.has(path) && !removedPaths.has(path));
    if (!existingItemPaths.length) continue;
    for (const path of existingItemPaths) removedPaths.add(path);
    const firstIndex = Math.min(...existingItemPaths.map((path) => pageIndex.get(path)));
    const templatePath = templatePathFor(collection.path, usedPaths);
    usedPaths.add(templatePath);
    templatesByIndex.set(firstIndex, cmsTemplatePage(collection, templatePath));
    collapsedCollections.push({ ...cmsCollectionSummary(collection), templatePath });
  }

  const nextPages = [];
  for (let index = 0; index < pages.length; index += 1) {
    if (templatesByIndex.has(index)) nextPages.push(templatesByIndex.get(index));
    if (!removedPaths.has(pages[index].path)) nextPages.push(pages[index]);
  }
  return { pages: nextPages, collapsedCollections };
}

function sectionOverrideEntries(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.pages)) return raw.pages;
  if (raw?.path && Array.isArray(raw?.sections)) return [raw];
  return Object.entries(raw ?? {}).map(([path, value]) => ({
    path,
    sections: Array.isArray(value) ? value : value?.sections,
  }));
}

function loadSectionOverrides(path) {
  if (!path) return null;
  const sourcePath = absPath(path);
  const raw = readJson(sourcePath);
  const sectionsByPath = new Map();
  for (const entry of sectionOverrideEntries(raw)) {
    const path = normalizePath(entry.path);
    if (!path) throw new Error(`Section override entry is missing a valid path in ${sourcePath}`);
    const sections = (entry.sections ?? [])
      .map((section) => sectionPlanItem(section.name, section.description))
      .filter((section) => section.name);
    if (!sections.length) throw new Error(`Section override for ${path} has no usable sections`);
    sectionsByPath.set(path, sections);
  }
  return { sourcePath, sectionsByPath };
}

function applySectionOverrides(pages, overrides) {
  const existingPaths = new Set(pages.map((page) => page.path));
  const missing = [...overrides.sectionsByPath.keys()].filter((path) => !existingPaths.has(path));
  let applied = 0;
  const nextPages = pages.map((page) => {
    const sections = overrides.sectionsByPath.get(page.path);
    if (!sections) return page;
    applied += 1;
    return { ...page, sections, sectionSource: "section-overrides" };
  });
  return {
    pages: nextPages,
    stats: {
      source: "section-overrides",
      path: overrides.sourcePath,
      requested: overrides.sectionsByPath.size,
      applied,
      ...(missing.length ? { missing } : {}),
    },
  };
}

function inferSectionPlan(page) {
  const headings = page.headings.map((heading) => heading.text);
  const h1 = headings[0] || page.name;
  const supporting = headings.slice(1, 8);
  const desc = page.description || `Page at ${page.path}.`;
  const hero = {
    name: page.type === "legal" ? "Header" : "Hero Header",
    description: `${h1}. ${desc}`.slice(0, 520),
  };
  const contentSections = supporting.map((heading) => ({
    name: cleanSectionName(heading),
    description: "",
  }));

  if (page.type === "article") {
    return [
      hero,
      sectionPlanItem("Article Body", supporting.length ? `Article content covering: ${supporting.slice(0, 5).join("; ")}.` : desc),
      sectionPlanItem("Related Articles", "Links to related articles, resources, or next reading recommendations."),
      sectionPlanItem("CTA", "Prompt readers to continue to a relevant next action."),
    ];
  }
  if (page.type === "news") {
    return [
      hero,
      sectionPlanItem("News Article Body", supporting.length ? `News story content covering: ${supporting.slice(0, 5).join("; ")}.` : desc),
      sectionPlanItem("Related News", "Links to recent news, press releases, or featured updates."),
    ];
  }
  if (page.type === "question") {
    return [
      sectionPlanItem("Question Header", `${h1}. ${desc}`.slice(0, 520)),
      sectionPlanItem("Answer Body", supporting.length ? `Answer content covering: ${supporting.slice(0, 5).join("; ")}.` : "Direct answer to a common visitor question."),
      sectionPlanItem("Contact Support", "Encourage users with additional questions to contact support."),
    ];
  }
  if (page.type === "expert") {
    return [
      sectionPlanItem("Profile Header", `${page.name}. ${desc}`.slice(0, 520)),
      sectionPlanItem("Biography", supporting.length ? `Profile content covering: ${supporting.slice(0, 5).join("; ")}.` : "Professional background, role, expertise, and related content."),
      sectionPlanItem("Related Content", "Links to articles, news, or resources associated with this expert."),
    ];
  }
  if (page.type === "success-story") {
    return [
      sectionPlanItem("Story Header", `${page.name}. ${desc}`.slice(0, 520)),
      sectionPlanItem("Personal Journey", supporting.length ? `Story content covering: ${supporting.slice(0, 5).join("; ")}.` : "User journey, challenge, experience, and outcomes."),
      sectionPlanItem("CTA", "Invite visitors to read more stories or begin the relevant conversion flow."),
    ];
  }
  if (page.type === "legal") {
    return [hero, sectionPlanItem("Legal Page Body", "Full legal or policy content.")];
  }
  if (page.type?.endsWith("-category") || page.type?.endsWith("-hub")) {
    return [
      hero,
      sectionPlanItem("Listing Grid", "Directory or listing of related pages."),
      sectionPlanItem("CTA", "Help visitors continue into relevant content or conversion paths."),
    ];
  }
  return [hero, ...contentSections.slice(0, 5), sectionPlanItem("CTA", "Guide visitors toward the next relevant action or page.")];
}

async function mapWithConcurrency(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;
  let completed = 0;
  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
      completed += 1;
      if (completed % 25 === 0 || completed === items.length) {
        console.log(`Crawled ${completed}/${items.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, runWorker));
  return results;
}

async function fetchPage(url, options = {}) {
  const response = await fetchWithRetries(url, {
    headers: {
      "User-Agent": "Relume Sitemap Tool",
      Accept: "text/html,application/xhtml+xml",
    },
  }, options);
  return { status: response.status, html: await response.text() };
}

function extractPageData(url, html, status, pathSet, baseUrl, config) {
  const path = normalizePath(url, baseUrl);
  const title = extractFirst(/<title[^>]*>([\s\S]*?)<\/title>/i, html);
  const description =
    extractFirst(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i, html) ||
    extractFirst(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i, html) ||
    "";
  const canonical = extractFirst(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i, html);
  const headings = extractHeadings(html);
  const textBlocks = extractTextBlocks(html);
  const links = extractLinks(html, pathSet, baseUrl).filter((link) => link !== path);
  const type = inferPageType(path, config);
  return {
    url,
    path,
    status,
    canonical,
    name: pageNameFromTitle(title, path, type),
    title,
    description,
    type,
    headings,
    textBlocks,
    links,
    sections: [],
  };
}

function detectLanguageScopes(urls, baseUrl) {
  const counts = new Map();
  for (const url of urls) {
    const path = normalizePath(url, baseUrl);
    const match = path.match(/^\/([a-z]{2}(?:-[a-z]{2})?)(?:\/|$)/i);
    const scope = match ? `/${match[1].toLowerCase()}` : "/";
    counts.set(scope, (counts.get(scope) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

async function commandInspect(args) {
  if (!args.sitemap) throw new Error("inspect requires --sitemap");
  const urls = uniqueOrdered(await urlsFromSitemapResource(args.sitemap));
  const baseUrl = args.base || inferBaseUrl(urls);
  const scopes = detectLanguageScopes(urls, baseUrl);
  console.log(`Found ${urls.length} URLs in ${args.sitemap}.`);
  if (scopes.length) {
    console.log("Likely language/path scopes:");
    for (const [scope, count] of scopes) console.log(`  ${scope}: ${count}`);
  }
  if (scopes.length > 1) {
    console.log("Multiple scopes detected. Ask which language/path to include before building a Relume sitemap.");
  }
}

const DISCOVERY_IGNORED_EXTENSIONS =
  /\.(?:avif|bmp|css|csv|docx?|eot|gif|ico|jpe?g|js|json|map|mp3|mp4|ogg|otf|pdf|png|pptx?|svg|ttf|txt|webm|webp|woff2?|xlsx?|xml|zip)$/i;
const DISCOVERY_IGNORED_PREFIXES = ["/cdn-cgi/", "/assets/", "/images/", "/videos/", "/documents/", "/uploads/"];

function normalizeDiscoveredUrl(raw, baseUrl, canonicalHost, allowedHosts) {
  if (!raw) return "";
  const trimmed = decodeHtml(String(raw).trim());
  if (!trimmed || trimmed.startsWith("#") || /^(?:mailto|tel|sms|javascript|data|blob):/i.test(trimmed)) return "";

  let url;
  try {
    url = new URL(trimmed, baseUrl);
  } catch {
    return "";
  }

  if (!allowedHosts.has(url.hostname)) return "";
  if (!/^https?:$/.test(url.protocol)) return "";

  url.protocol = "https:";
  url.hostname = canonicalHost;
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/g, "");

  if (DISCOVERY_IGNORED_EXTENSIONS.test(url.pathname)) return "";
  if (DISCOVERY_IGNORED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return "";
  return url.toString();
}

function extractDiscoverableLinks(html, baseUrl, canonicalHost, allowedHosts) {
  const links = new Set();
  for (const match of html.matchAll(/\s(?:href|src)=["']([^"']+)["']/gi)) {
    const normalized = normalizeDiscoveredUrl(match[1], baseUrl, canonicalHost, allowedHosts);
    if (normalized) links.add(normalized);
  }
  return [...links];
}

async function fetchDiscoveryPage(url, canonicalHost, allowedHosts, options = {}) {
  const response = await fetchWithRetries(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "Relume Sitemap Tool",
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    },
  }, options);
  const contentType = response.headers.get("content-type") ?? "";
  const finalUrl = normalizeDiscoveredUrl(response.url, url, canonicalHost, allowedHosts) || url;
  const html = contentType.includes("text/html") ? await response.text() : "";
  return {
    requestedUrl: url,
    finalUrl,
    status: response.status,
    contentType,
    title: html ? extractFirst(/<title[^>]*>([\s\S]*?)<\/title>/i, html) : "",
    links: html ? extractDiscoverableLinks(html, finalUrl, canonicalHost, allowedHosts) : [],
  };
}

async function commandDiscover(args) {
  if (!args.url || !args.out) throw new Error("discover requires --url and --out");
  const outDir = absPath(args.out);
  ensureDir(outDir);

  const start = new URL(args.url);
  const canonicalHost = start.hostname;
  const allowedHosts = new Set([canonicalHost]);
  if (canonicalHost.startsWith("www.")) allowedHosts.add(canonicalHost.slice(4));
  else allowedHosts.add(`www.${canonicalHost}`);

  const include = normalizePath(args.include ?? "/");
  const excludes = parsePathList(args.exclude);
  const maxPages = parsePositiveInteger(args["max-pages"], 500, "discover --max-pages", { max: 10000 });
  const concurrency = parsePositiveInteger(args.concurrency, 6, "discover --concurrency", { max: 50 });
  const requestOptions = {
    timeoutMs: parsePositiveInteger(args["fetch-timeout"], DEFAULT_FETCH_TIMEOUT_MS, "discover --fetch-timeout"),
    retries: parseNonNegativeInteger(args.retries, DEFAULT_FETCH_RETRIES, "discover --retries", { max: 5 }),
  };
  const startUrl = normalizeDiscoveredUrl(start.toString(), start.toString(), canonicalHost, allowedHosts);
  if (!startUrl) throw new Error(`Could not normalize start URL: ${args.url}`);
  const queue = [startUrl];
  const seen = new Set(queue);
  const pages = [];
  let cursor = 0;

  function inScope(url) {
    const path = normalizePath(url);
    return pathMatchesPrefix(path, include) && !excludes.some((exclude) => pathMatchesPrefix(path, exclude));
  }

  async function worker() {
    while (cursor < queue.length && pages.length < maxPages) {
      const index = cursor;
      cursor += 1;
      const url = queue[index];
      try {
        const page = await fetchDiscoveryPage(url, canonicalHost, allowedHosts, requestOptions);
        pages.push(page);
        if (page.status >= 200 && page.status < 400 && page.contentType.includes("text/html")) {
          for (const link of page.links) {
            if (inScope(link) && !seen.has(link) && seen.size < maxPages) {
              seen.add(link);
              queue.push(link);
            }
          }
        }
      } catch (error) {
        pages.push({ requestedUrl: url, finalUrl: url, status: 0, contentType: "", title: "", links: [], error: error.message });
      }

      if (pages.length % 25 === 0 || cursor >= queue.length || pages.length >= maxPages) {
        console.log(`Discovered ${seen.size} URLs, fetched ${pages.length}.`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  const urls = uniqueOrdered(
    pages
      .filter((page) => page.status >= 200 && page.status < 400 && page.contentType.includes("text/html"))
      .map((page) => page.finalUrl)
      .filter(inScope),
  ).sort((a, b) => normalizePath(a).localeCompare(normalizePath(b)));

  const sitemapXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n");

  writeFileSync(join(outDir, "discovered-sitemap.xml"), sitemapXml);
  writeJson(join(outDir, "discovery.json"), {
    crawledAt: new Date().toISOString(),
    startUrl,
    include,
    ...(excludes.length ? { excludes } : {}),
    maxPages,
    urlCount: urls.length,
    urls,
    pages,
  });
  console.log(`Wrote ${urls.length} URLs to ${join(outDir, "discovered-sitemap.xml")}`);
}

async function commandCrawl(args) {
  if (!args.sitemap || !args.include || !args.out) {
    throw new Error("crawl requires --sitemap, --include, and --out");
  }
  const outDir = absPath(args.out);
  ensureDir(outDir);

  const config = args.config ? readJson(absPath(args.config)) : {};
  const requestOptions = {
    timeoutMs: parsePositiveInteger(args["fetch-timeout"], config.fetchTimeout ?? DEFAULT_FETCH_TIMEOUT_MS, "crawl --fetch-timeout"),
    retries: parseNonNegativeInteger(args.retries, config.retries ?? DEFAULT_FETCH_RETRIES, "crawl --retries", { max: 5 }),
  };
  const allUrls = await urlsFromSitemapResource(args.sitemap, requestOptions);
  const baseUrl = args.base || config.baseUrl || inferBaseUrl(allUrls);
  const include = args.include.replace(/\/+$/, "") || "/";
  const excludes = parsePathList(args.exclude ?? config.exclude);
  const urls = uniqueOrdered(allUrls).filter((url) => {
    const path = normalizePath(url, baseUrl);
    return pathMatchesPrefix(path, include) && !excludes.some((exclude) => pathMatchesPrefix(path, exclude));
  });
  const pathSet = new Set(urls.map((url) => normalizePath(url, baseUrl)));
  const concurrency = parsePositiveInteger(args.concurrency, config.concurrency ?? 6, "crawl --concurrency", { max: 50 });

  console.log(`Found ${urls.length} URLs under ${include}${excludes.length ? ` excluding ${excludes.join(", ")}` : ""}.`);
  const pages = await mapWithConcurrency(
    urls,
    async (url) => {
      try {
        const { status, html } = await fetchPage(url, requestOptions);
        const page = extractPageData(url, html, status, pathSet, baseUrl, config);
        page.sections = inferSectionPlan(page);
        return page;
      } catch (error) {
        const path = normalizePath(url, baseUrl);
        const type = inferPageType(path, config);
        return {
          url,
          path,
          status: 0,
          canonical: "",
          name: titleFromPath(path),
          title: titleFromPath(path),
          description: `Failed to crawl: ${error.message}`,
          type,
          headings: [],
          textBlocks: [],
          links: [],
          sections: [sectionPlanItem("Page Placeholder", `Could not crawl ${url}: ${error.message}`)],
        };
      }
    },
    concurrency,
  );

  const stats = buildStats({ sourceSitemap: args.sitemap, include, excludes, baseUrl, pages });
  writeJson(join(outDir, "crawl.json"), { stats, pages });
  console.log(`Wrote ${join(outDir, "crawl.json")}`);
}

function buildStats({ sourceSitemap, include, excludes = [], baseUrl, pages, relumePageCount }) {
  return {
    crawledAt: new Date().toISOString(),
    sourceSitemap,
    include,
    ...(excludes.length ? { excludes } : {}),
    baseUrl,
    urlCount: pages.length,
    ...(relumePageCount ? { relumePageCount } : {}),
    statusCounts: Object.fromEntries([...pages.reduce((map, page) => map.set(page.status, (map.get(page.status) ?? 0) + 1), new Map())].sort()),
    typeCounts: Object.fromEntries([...pages.reduce((map, page) => map.set(page.type, (map.get(page.type) ?? 0) + 1), new Map())].sort()),
  };
}

function commandAnalyzeCms(args) {
  if (!args.crawl) throw new Error("analyze-cms requires --crawl");
  const crawl = readJson(absPath(args.crawl));
  const config = args.config ? readJson(absPath(args.config)) : {};
  const collections = detectCmsCollections(crawl.pages ?? [], config);
  if (args.json) {
    console.log(JSON.stringify(collections.map(cmsCollectionSummary), null, 2));
    return;
  }
  console.log(cmsReport(collections));
}

function relumePage(page, subPages = [], pageType = "page", options = {}) {
  const includeSections = options.includeSections !== false;
  const sectionPlan = page.sections?.length ? page.sections : inferSectionPlan(page);
  return {
    name: page.name,
    description: page.descriptionWithUrl ?? [page.title, page.description, page.url ? `Source: ${page.url}` : ""].filter(Boolean).join("\n\n"),
    sections: includeSections
      ? [
          sectionReference(NAVBAR_ID),
          ...sectionPlan.slice(0, 8).map((section) => sectionValue(section.name, section.description)),
          sectionReference(FOOTER_ID),
        ]
      : [],
    subPages,
    commentThreads: commentThreads(),
    pageType,
  };
}

function syntheticPage(name, description, sections = []) {
  return {
    name,
    description,
    descriptionWithUrl: description,
    type: "group",
    title: name,
    url: "",
    path: "",
    headings: [],
    links: [],
    sections: sections.length
      ? sections
      : [
          sectionPlanItem("Directory Header", description),
          sectionPlanItem("Page Listing", `Visual grouping for ${name} pages.`),
        ],
  };
}

function sortByName(pages) {
  return [...pages].sort((a, b) => a.name.localeCompare(b.name));
}

function pageMap(pages) {
  return new Map(pages.map((page) => [page.path, page]));
}

function firstMatchingPage(map, paths) {
  for (const path of paths) {
    if (map.has(path)) return map.get(path);
  }
  return undefined;
}

function collectGroupPages(pages, group, used) {
  const results = [];
  for (const path of group.paths ?? []) {
    const page = pages.find((candidate) => candidate.path === path);
    if (page && !used.has(page.path)) results.push(page);
  }
  for (const prefix of [group.itemPrefix, ...(group.prefixes ?? [])].filter(Boolean)) {
    for (const page of pages) {
      if (pathMatchesPrefix(page.path, prefix) && page.path !== group.hubPath && !used.has(page.path)) {
        results.push(page);
      }
    }
  }
  return uniqueOrdered(results.map((page) => page.path))
    .map((path) => pages.find((page) => page.path === path))
    .filter(Boolean);
}

function buildGroup(group, pages, map, used, options = {}) {
  if (group.children?.length) {
    const children = group.children.map((child) => buildGroup(child, pages, map, used, options)).filter(Boolean);
    if (!children.length) return null;
    return relumePage(syntheticPage(group.name, group.description ?? `Visual group for ${group.name}.`), children, "path", options);
  }

  const hub = group.hubPath && map.get(group.hubPath);
  if (hub) used.add(hub.path);

  if (group.categoryPrefix && group.itemPrefix) {
    const categoryPages = sortByName(pages.filter((page) => pathMatchesPrefix(page.path, group.categoryPrefix)));
    const itemPages = pages.filter((page) => pathMatchesPrefix(page.path, group.itemPrefix));
    const assigned = new Set();
    const categoryNodes = categoryPages.map((categoryPage) => {
      used.add(categoryPage.path);
      const linked = sortByName(
        itemPages.filter(
          (item) =>
            !assigned.has(item.path) &&
            (categoryPage.links.includes(item.path) || item.links.includes(categoryPage.path)),
        ),
      );
      for (const item of linked) {
        assigned.add(item.path);
        used.add(item.path);
      }
      return relumePage(categoryPage, linked.map((item) => relumePage(item, [], "page", options)), "page", options);
    });
    const unassigned = sortByName(itemPages.filter((item) => !assigned.has(item.path)));
    if (unassigned.length) {
      for (const item of unassigned) used.add(item.path);
      categoryNodes.push(relumePage(syntheticPage(group.fallbackName ?? `All ${group.name}`, `Pages not assigned to a ${group.name} category.`), unassigned.map((item) => relumePage(item, [], "page", options)), "path", options));
    }
    return relumePage(hub ?? syntheticPage(group.name, group.description ?? `Visual group for ${group.name}.`), categoryNodes, hub ? "page" : "path", options);
  }

  const children = sortByName(collectGroupPages(pages, group, used));
  for (const child of children) used.add(child.path);
  if (!hub && !children.length) return null;
  return relumePage(hub ?? syntheticPage(group.name, group.description ?? `Visual group for ${group.name}.`), children.map((child) => relumePage(child, [], "page", options)), hub ? "page" : "path", options);
}

function buildGenericTree(pages, config, options = {}) {
  const map = pageMap(pages);
  const rootPath = normalizePath(config.rootPath ?? (map.has("/") ? "/" : pages[0]?.path ?? "/"));
  const rootCandidates = [rootPath, ...(config.homeAliases ?? [])];
  const rootSource = firstMatchingPage(map, rootCandidates) ?? pages[0] ?? syntheticPage("Home", "Generated sitemap root.");
  const root = { ...rootSource, name: config.rootName ?? rootSource.name };
  const excluded = new Set([rootSource.path, ...(config.excludeFromTree ?? [])]);
  const pageOrder = new Map(pages.map((page, index) => [page.path, index]));
  const nodes = new Map();

  function ensureNode(path) {
    if (!nodes.has(path)) {
      nodes.set(path, {
        path,
        page: map.get(path),
        children: new Map(),
      });
    }
    return nodes.get(path);
  }

  function partsFor(path) {
    return path.split("/").filter(Boolean);
  }

  function pathFromParts(parts) {
    return parts.length ? `/${parts.join("/")}` : "/";
  }

  function isUnderRoot(path) {
    return rootPath === "/" ? true : path === rootPath || path.startsWith(`${rootPath}/`);
  }

  const rootNode = ensureNode(rootPath);
  rootNode.page = root;

  for (const page of pages) {
    if (excluded.has(page.path) || !isUnderRoot(page.path)) continue;
    const parts = partsFor(page.path);
    const rootDepth = partsFor(rootPath).length;
    let parent = rootNode;

    for (let depth = rootDepth + 1; depth <= parts.length; depth += 1) {
      const path = pathFromParts(parts.slice(0, depth));
      const node = ensureNode(path);
      if (!parent.children.has(path)) parent.children.set(path, node);
      parent = node;
    }
  }

  function orderFor(node) {
    if (pageOrder.has(node.path)) return pageOrder.get(node.path);
    const childOrders = [...node.children.values()].map(orderFor);
    return childOrders.length ? Math.min(...childOrders) : Number.MAX_SAFE_INTEGER;
  }

  function sortedChildren(node) {
    return [...node.children.values()].sort((a, b) => orderFor(a) - orderFor(b) || a.path.localeCompare(b.path));
  }

  function relumeFromNode(node, isRoot = false) {
    const childPages = sortedChildren(node).map((child) => relumeFromNode(child));
    const source =
      node.page ??
      syntheticPage(titleFromPath(node.path), `Pages under ${node.path}.`, [
        sectionPlanItem("Directory Header", `Pages under ${node.path}.`),
        sectionPlanItem("Page Listing", `Child pages in the ${node.path} path.`),
      ]);
    return relumePage(source, childPages, isRoot || node.page ? "page" : "path", options);
  }

  return relumeFromNode(rootNode, true);
}

function buildConfiguredTree(pages, config, options = {}) {
  const map = pageMap(pages);
  const rootPath = config.rootPath ?? pages[0]?.path ?? "/";
  const rootSource = firstMatchingPage(map, [rootPath, ...(config.homeAliases ?? [])]) ?? pages[0] ?? syntheticPage("Home", "Generated sitemap root.");
  const root = {
    ...rootSource,
    name: config.rootName ?? rootSource.name,
    descriptionWithUrl: [rootSource.title, rootSource.description, rootSource.url ? `Source: ${rootSource.url}` : ""].filter(Boolean).join("\n\n"),
  };
  const used = new Set([rootSource.path, ...(config.excludeFromTree ?? [])]);
  const subPages = (config.groups ?? []).map((group) => buildGroup(group, pages, map, used, options)).filter(Boolean);
  const ungrouped = sortByName(pages.filter((page) => !used.has(page.path)));
  if (ungrouped.length) {
    subPages.push(relumePage(syntheticPage("Ungrouped", "Pages not matched by configured grouping rules."), ungrouped.map((page) => relumePage(page, [], "page", options)), "path", options));
  }
  return relumePage(root, subPages, "page", options);
}

function escapeHtmlText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function markdownText(value) {
  return escapeHtmlText(value).replace(/\r?\n/g, " ");
}

function flattenRelume(page, depth = 0, rows = []) {
  rows.push({ depth, name: page.name, pageType: page.pageType, description: page.description });
  for (const subPage of page.subPages ?? []) flattenRelume(subPage, depth + 1, rows);
  return rows;
}

function markdownTree(page) {
  return flattenRelume(page)
    .map((row) => {
      const indent = "  ".repeat(row.depth);
      const source = row.description?.split("\n").filter(Boolean).find((line) => line.startsWith("Source:"));
      return `${indent}- ${markdownText(row.name)}${row.pageType === "path" ? " (path)" : ""}${source ? ` - ${markdownText(source)}` : ""}`;
    })
    .join("\n");
}

function buildCopyPage(clipboardHtml, pageCount, siteName) {
  const htmlLiteral = JSON.stringify(clipboardHtml);
  const safeSiteName = escapeHtmlText(siteName);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Copy ${safeSiteName} Relume Payload</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; background: #fbfaf7; color: #172026; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; }
      main { width: min(780px, calc(100% - 40px)); margin: 0 auto; padding: 72px 0; }
      h1 { margin: 0 0 12px; font-size: clamp(2rem, 6vw, 3.75rem); line-height: 1.08; letter-spacing: 0; }
      p { color: #5c6670; }
      button { min-height: 46px; padding: 0 18px; border: 0; border-radius: 6px; background: #0f766e; color: white; font: inherit; font-weight: 700; cursor: pointer; }
      button:hover { background: #0b5751; }
      code { display: block; margin-top: 24px; padding: 16px; overflow: auto; border: 1px solid #d9dee4; border-radius: 8px; background: white; color: #172026; font-size: 0.9rem; }
      .status { min-height: 28px; margin-top: 14px; color: #0b5751; font-weight: 650; }
      .status.error { color: #9f1239; }
    </style>
  </head>
  <body>
    <main>
      <h1>Copy ${safeSiteName} Relume Payload</h1>
      <p>This writes a Relume-style <code style="display:inline;padding:0;border:0;background:transparent">text/html</code> clipboard payload containing ${pageCount} pages.</p>
      <button type="button" id="copy">Copy Relume Payload</button>
      <p class="status" id="status"></p>
      <p>After copying, go to Relume's sitemap canvas and paste with Cmd+V.</p>
      <code>&lt;p data-blocks-payload-v1="..."&gt;&lt;/p&gt;</code>
    </main>
    <script>
      const clipboardHtml = ${htmlLiteral};
      const status = document.querySelector("#status");
      function setStatus(message, isError = false) { status.textContent = message; status.classList.toggle("error", isError); }
      function copyViaCopyEvent() {
        const scratch = document.createElement("textarea");
        scratch.value = "Relume sitemap clipboard payload";
        scratch.setAttribute("readonly", "");
        scratch.style.position = "fixed";
        scratch.style.opacity = "0";
        document.body.appendChild(scratch);
        scratch.focus();
        scratch.select();
        let wroteClipboardData = false;
        const onCopy = (event) => {
          event.preventDefault();
          event.clipboardData.setData("text/html", clipboardHtml);
          event.clipboardData.setData("text/plain", "Relume sitemap clipboard payload");
          wroteClipboardData = true;
        };
        document.addEventListener("copy", onCopy);
        const commandSucceeded = document.execCommand("copy");
        document.removeEventListener("copy", onCopy);
        scratch.remove();
        if (!commandSucceeded || !wroteClipboardData) throw new Error("Copy event blocked.");
      }
      async function copyViaAsyncClipboard() {
        if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Async clipboard unavailable.");
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([clipboardHtml], { type: "text/html" }),
          "text/plain": new Blob(["Relume sitemap clipboard payload"], { type: "text/plain" }),
        })]);
      }
      document.querySelector("#copy").addEventListener("click", async () => {
        try {
          copyViaCopyEvent();
          setStatus("Copied with copy-event fallback. Paste into Relume now.");
        } catch (copyEventError) {
          try {
            await copyViaAsyncClipboard();
            setStatus("Copied with async clipboard. Paste into Relume now.");
          } catch (asyncClipboardError) {
            setStatus("Copy was blocked by this browser. Use the CLI copy command, or open this page in Chrome/Safari.", true);
            console.error({ copyEventError, asyncClipboardError });
          }
        }
      });
    </script>
  </body>
</html>
`;
}

async function commandBuild(args) {
  if (!args.crawl || !args.out) throw new Error("build requires --crawl and --out");
  const crawlPath = absPath(args.crawl);
  const outDir = absPath(args.out);
  ensureDir(outDir);
  const crawl = readJson(crawlPath);
  const config = args.config ? readJson(absPath(args.config)) : {};
  const pages = crawl.pages.map((page) => ({ ...page, sections: page.sections?.length ? page.sections : inferSectionPlan(page) }));
  const cmsMode = normalizeCmsMode(args["cms-mode"] ?? config.cmsMode ?? "expanded");
  const cmsInclude = parsePathList(args["cms-include"] ?? config.cmsInclude);
  const cmsExclude = parsePathList(args["cms-exclude"] ?? config.cmsExclude);
  const cmsCollections = detectCmsCollections(pages, config);
  const cmsBuild =
    cmsMode === "templates"
      ? applyCmsTemplateMode(pages, cmsCollections, { include: cmsInclude, exclude: cmsExclude })
      : { pages, collapsedCollections: [] };
  const useCustomGroups = Boolean(args["custom-groups"] && config.groups?.length);
  const sectionMode = normalizeSectionMode(args["no-sections"] ? "none" : args.sections ?? config.sections ?? "include");
  const sectionOverrides =
    sectionMode !== "none" ? loadSectionOverrides(args["section-overrides"] ?? config.sectionOverrides) : null;
  const overrideSections = sectionOverrides ? applySectionOverrides(cmsBuild.pages, sectionOverrides) : null;
  const sectionPages = overrideSections?.pages ?? cmsBuild.pages;
  const buildOptions = { includeSections: sectionMode !== "none" };
  const tree = useCustomGroups ? buildConfiguredTree(sectionPages, config, buildOptions) : buildGenericTree(sectionPages, config, buildOptions);
  const relumePageCount = countRelumePages(tree);
  const payload = { type: "page", state: tree, globalSections: globalSections(config.siteName) };
  const payloadHtml = `<meta charset="utf-8"><p data-blocks-payload-v1="${escapeHtmlAttribute(JSON.stringify(payload))}"></p>`;
  const stats = {
    ...crawl.stats,
    relumePageCount,
    sections: sectionMode,
    ...(sectionMode === "ai"
      ? {
          aiSections: overrideSections
            ? {
                enabled: true,
                used: overrideSections.stats.applied > 0,
                source: "section-overrides",
                path: overrideSections.stats.path,
                applied: overrideSections.stats.applied,
              }
            : {
                enabled: true,
                used: false,
                source: "extracted-fallback",
                fallback: "include",
                error: "--sections ai requires --section-overrides in this CLI version.",
              },
        }
      : {}),
    ...(overrideSections ? { sectionOverrides: overrideSections.stats } : {}),
    cmsMode,
    cmsCollectionsDetected: cmsCollections.length,
    ...(cmsBuild.collapsedCollections.length ? { cmsTemplateCollections: cmsBuild.collapsedCollections } : {}),
  };
  const siteName = config.siteName ?? "Generated";
  writeJson(join(outDir, "sitemap-tree.json"), tree);
  writeJson(join(outDir, "relume-payload.json"), payload);
  writeFileSync(join(outDir, "relume-payload.html"), payloadHtml);
  writeFileSync(join(outDir, "copy-to-clipboard.html"), buildCopyPage(payloadHtml, relumePageCount, siteName));
  writeFileSync(
    join(outDir, "sitemap.md"),
    [
      `# ${markdownText(siteName)} Visual Sitemap`,
      "",
      `Relume payload pages: ${relumePageCount}`,
      "",
      "## Stats",
      "",
      "```json",
      JSON.stringify(stats, null, 2),
      "```",
      "",
      "## Sitemap",
      "",
      markdownTree(tree),
      "",
    ].join("\n"),
  );
  validatePayloadHtml(payloadHtml);
  console.log(`Built Relume payload with ${relumePageCount} pages.`);
  console.log(`Wrote ${join(outDir, "relume-payload.html")}`);
  if (args.copy) {
    commandCopy({ payload: join(outDir, "relume-payload.html") });
  }
}

function commandValidate(args) {
  if (!args.payload) throw new Error("validate requires --payload");
  const html = readFileSync(absPath(args.payload), "utf8");
  const result = validatePayloadHtml(html);
  console.log(`Valid Relume payload: root="${result.rootName}", pages=${result.count}`);
}

function commandCopy(args) {
  if (!args.payload) throw new Error("copy requires --payload");
  const payloadPath = absPath(args.payload);
  const platform = process.env.RELUME_SITEMAP_TEST_PLATFORM || process.platform;
  if (platform !== "darwin") {
    throw new Error(
      "copy currently requires macOS because it writes a text/html payload through osascript. Use copy-to-clipboard.html in a browser, or copy relume-payload.html from a macOS machine.",
    );
  }
  const jxaPath = join(toolRoot, "scripts/copy-relume-payload.jxa");
  const result = spawnSync("osascript", ["-l", "JavaScript", jxaPath, payloadPath], {
    encoding: "utf8",
  });
  if (result.error) {
    throw new Error(`osascript failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "osascript failed");
  }
  if (result.stdout.trim()) {
    process.stdout.write(result.stdout);
  } else {
    console.log(`Copied Relume HTML payload to clipboard: ${payloadPath}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || args.help || command === "--help" || command === "-h") {
    help();
    return;
  }
  if (command === "inspect") return commandInspect(args);
  if (command === "discover") return commandDiscover(args);
  if (command === "crawl") return commandCrawl(args);
  if (command === "analyze-cms") return commandAnalyzeCms(args);
  if (command === "build") return commandBuild(args);
  if (command === "copy") return commandCopy(args);
  if (command === "validate") return commandValidate(args);
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
