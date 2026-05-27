---
name: relume-sitemap
description: Generate Relume-ready visual sitemap clipboard payloads by crawling XML sitemaps or live pages with the relume-sitemap CLI. Use when an agent is asked to create, import, paste, reverse engineer, or stress-test Relume sitemaps, especially when working around Relume URL import limits, multilingual sitemap scopes, CMS-like collections, generated page hierarchies, agent-condensed page sections, or data-blocks-payload-v1 HTML clipboard fragments.
---

# Relume Sitemap

Use this skill when a user asks to create, import, paste, reverse engineer, or stress-test a Relume sitemap from a website.

The CLI is the source of truth. Prefer commands in this order:

1. `relume-sitemap` if it is already available on `PATH`.
2. `node ./bin/relume-sitemap.mjs` when working inside this repository.
3. `npx -y @kvalifik/relume-sitemap@latest` when the CLI is not installed.

Do not hand-author escaped Relume payload JSON unless patching the CLI itself.

## Workflow

1. Inspect the source sitemap or discovered URL list before crawling.
2. If multiple language/path scopes are present, ask which language/path to cover before building. Do not combine languages unless explicitly requested.
3. Ask whether sections should be no sections, extracted sections, or agent-condensed sections.
4. Crawl pages from the selected source sitemap/path scope.
5. Run `analyze-cms` on `crawl.json`. If likely or possible CMS collections are reported, ask whether to keep item pages expanded or collapse collections to template pages.
6. Build the visual sitemap tree from `crawl.json` using the actual URL/folder structure plus the user's CMS choice.
7. Validate the generated Relume payload.
8. Copy the HTML payload to the clipboard when the environment supports it.
9. Tell the user to paste into Relume's sitemap canvas.

## Commands

Inspect:

```bash
relume-sitemap inspect --sitemap https://www.example.com/sitemap.xml
```

Discover when the sitemap is missing or sparse:

```bash
relume-sitemap discover --url https://www.example.com --out ./work/example
```

Crawl one language/path scope:

```bash
relume-sitemap crawl \
  --sitemap https://www.example.com/sitemap.xml \
  --include / \
  --exclude /da,/de \
  --out ./work/example-en
```

Analyze CMS collections:

```bash
relume-sitemap analyze-cms --crawl ./work/example-en/crawl.json
```

Build with extracted sections:

```bash
relume-sitemap build \
  --crawl ./work/example-en/crawl.json \
  --out ./work/example-en \
  --sections include \
  --cms-mode expanded \
  --copy
```

Build with agent-condensed sections:

```bash
relume-sitemap build \
  --crawl ./work/example-en/crawl.json \
  --out ./work/example-en \
  --sections ai \
  --section-overrides ./work/example-en/section-overrides.json \
  --cms-mode templates \
  --copy
```

Build without sections:

```bash
relume-sitemap build \
  --crawl ./work/example-en/crawl.json \
  --out ./work/example-en \
  --sections none \
  --cms-mode expanded
```

Validate:

```bash
relume-sitemap validate --payload ./work/example-en/relume-payload.html
```

## Sections Rule

For agent-condensed sections, write `section-overrides.json` before building. Use the crawled title, metadata, headings, and text blocks to merge repeated concepts into concise section names.

Use this shape:

```json
{
  "pages": [
    {
      "path": "/",
      "sections": [
        { "name": "Hero", "description": "" },
        { "name": "Featured Services", "description": "" },
        { "name": "Selected Work", "description": "" },
        { "name": "CTA", "description": "" }
      ]
    }
  ]
}
```

Do not target a fixed number of sections. Use only sections supported by crawled evidence. Do not append `Section` to section names. Keep descriptions empty unless they add useful context beyond the section name; never emit boilerplate descriptions like `Page section focused on "...".`

## Quality Checks

- Crawl status counts should be mostly or entirely `200`.
- Payload validation must pass.
- The generated root and page count should match expectations.
- Review `sitemap.md` for hierarchy sanity.
- Multilingual sites should be scoped to one language/path unless all languages were explicitly requested.
- The tree should follow URL/folder structure unless the user explicitly asks for custom grouping.
- `analyze-cms` must be run after crawling. If CMS collections are detected, build with the user's chosen `--cms-mode`.
- Section mode must match the user's choice: `--sections ai`, `--sections include`, or `--sections none`.
- Agent-condensed builds must use `--section-overrides`; `sitemap.md` stats should include `sectionOverrides` and `aiSections.source` should be `section-overrides`.
- Section names should not end in `Section`, and descriptions should not contain `Page section focused on "...".`

## Outputs

The build command writes:

- `crawl.json`
- `sitemap-tree.json`
- `relume-payload.json`
- `relume-payload.html`
- `sitemap.md`
- `section-overrides.json` when agent-condensed sections are used
- `copy-to-clipboard.html`

Prefer showing `sitemap.md` for review and using `relume-payload.html` for Relume paste.
