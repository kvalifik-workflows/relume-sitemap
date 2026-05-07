---
name: relume-sitemap
description: Generate Relume-ready visual sitemap clipboard payloads by crawling XML sitemaps or live pages with the relume-sitemap CLI.
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
3. Ask whether the Relume sitemap should include page sections or only page nodes.
4. Crawl pages from the selected source sitemap/path scope.
5. Build the visual sitemap tree from `crawl.json` using the actual URL/folder structure.
6. Validate the generated Relume payload.
7. Copy the HTML payload to the clipboard when the environment supports it.
8. Tell the user to paste into Relume's sitemap canvas.

## Commands

```bash
relume-sitemap inspect --sitemap https://www.example.com/sitemap.xml
relume-sitemap discover --url https://www.example.com --out ./work/example
relume-sitemap crawl --sitemap https://www.example.com/sitemap.xml --include / --exclude /da,/de --out ./work/example-en
relume-sitemap build --crawl ./work/example-en/crawl.json --out ./work/example-en --sections include --copy
relume-sitemap validate --payload ./work/example-en/relume-payload.html
```

## Quality Checks

- Crawl status counts should be mostly or entirely `200`.
- Payload validation must pass.
- Review `sitemap.md` for hierarchy sanity.
- Multilingual sites should be scoped to one language/path unless all languages were explicitly requested.
- Section mode must match the user's choice.
