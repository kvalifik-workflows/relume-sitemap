# Relume Sitemap

Generate Relume-compatible visual sitemap clipboard payloads from XML sitemaps and crawled page HTML.

This is a CLI-first tool. It can be used directly by humans, or through Agent Skills in Codex, Claude, and other skills-compatible agents.

This project is not affiliated with, endorsed by, or sponsored by Relume.

## Install

Run without installing:

```bash
npx @kvalifik/relume-sitemap@latest --help
```

Or install globally:

```bash
npm install -g @kvalifik/relume-sitemap
```

## Workflow

Inspect the sitemap first:

```bash
relume-sitemap inspect --sitemap https://www.example.com/sitemap.xml
```

If multiple language or path scopes are reported, choose one scope before crawling. For example, English root pages while excluding Danish pages:

```bash
relume-sitemap crawl \
  --sitemap https://www.example.com/sitemap.xml \
  --include / \
  --exclude /da \
  --out ./work/example-en
```

Build a Relume payload with inferred page sections:

```bash
relume-sitemap build \
  --crawl ./work/example-en/crawl.json \
  --out ./work/example-en \
  --sections include \
  --copy
```

For cleaner agent-authored sections, write a `section-overrides.json` file from the crawled page evidence and build with:

```bash
relume-sitemap build \
  --crawl ./work/example-en/crawl.json \
  --out ./work/example-en \
  --sections ai \
  --section-overrides ./work/example-en/section-overrides.json \
  --copy
```

Then paste into Relume's sitemap canvas with `Cmd+V` on macOS.

## Commands

```bash
relume-sitemap inspect --sitemap <url-or-file>
relume-sitemap discover --url <url> --out <dir> [--max-pages 500] [--include /] [--exclude /da,/fr]
relume-sitemap crawl --sitemap <url-or-file> --include <path-prefix> --out <dir> [--exclude /da,/fr]
relume-sitemap analyze-cms --crawl <crawl.json> [--json]
relume-sitemap build --crawl <crawl.json> --out <dir> [--sections include|none|ai] [--section-overrides <json>] [--cms-mode expanded|templates] [--copy]
relume-sitemap validate --payload <relume-payload.html>
relume-sitemap copy --payload <relume-payload.html>
```

Use `discover` when a public XML sitemap is missing, sparse, or only contains the homepage. It writes `discovered-sitemap.xml`, which can then be passed to `crawl`.

Run `analyze-cms` after crawling to detect collection-like URL folders such as `/blog/*`, `/cases/*`, or `/events/*`. Use `--cms-mode expanded` to keep item URLs as pages, or `--cms-mode templates` to collapse likely collections into one template page per folder.

`--section-overrides` accepts either an object keyed by page path or a `pages` array:

```json
{
  "pages": [
    {
      "path": "/",
      "sections": [
        { "name": "Hero", "description": "" },
        { "name": "Featured Work", "description": "" }
      ]
    }
  ]
}
```

Section names are normalized so they do not end in `Section`, and empty descriptions are valid.

## Outputs

The `build` command writes:

- `crawl.json`
- `sitemap-tree.json`
- `relume-payload.json`
- `relume-payload.html`
- `sitemap.md`
- `section-overrides.json` when authored by the agent or user
- `copy-to-clipboard.html`

`relume-payload.html` is the clipboard fragment Relume reads. `sitemap.md` is the easiest review file.

## Agent Skills

The shared Agent Skill lives at:

```text
skills/relume-sitemap/SKILL.md
```

Codex and Claude Code wrapper plugins are included under:

```text
plugins/codex/relume-sitemap/
plugins/claude/relume-sitemap/
```

The wrappers intentionally stay thin. The CLI is the source of truth.

### Codex

Install the marketplace from GitHub:

```bash
codex plugin marketplace add kvalifik-workflows/relume-sitemap
```

Then open the Codex plugin directory, choose `Kvalifik Tools`, and install `Relume Sitemap`.

For local skill-only installation, use Codex's skill installer with:

```text
https://github.com/kvalifik-workflows/relume-sitemap/tree/main/skills/relume-sitemap
```

### Claude Code

Install the marketplace from GitHub:

```text
/plugin marketplace add kvalifik-workflows/relume-sitemap
/plugin install relume-sitemap@kvalifik-tools
```

The Claude plugin exposes the skill as `/relume-sitemap:relume-sitemap`.

### Claude.ai

Create a ZIP containing the `skills/relume-sitemap/` folder and upload it as a custom skill. The folder name must remain `relume-sitemap`.

## Development

```bash
npm test
```

The test suite uses a local crawl fixture, so it does not hit live websites.
