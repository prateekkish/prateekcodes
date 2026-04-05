# _layouts/

Page shell templates using Liquid + kramdown. All layouts ultimately extend `default.html`.

## Layout Map

| File | Used by | Notes |
|---|---|---|
| `default.html` | All pages (base shell) | 428 lines. Inline nav, head, analytics, newsletter bar, footer — no include-based composition. Scroll carefully before editing. |
| `post.html` | All blog posts | Adds structured data, Giscus comments, reading time, social share, related posts. |
| `page.html` | Static pages (`_pages/`) | Minimal wrapper. |
| `archive.html` / `categories.html` / `tags.html` | Category/tag index pages | Generated via `jekyll-archives`. |
| `projects.html` | Projects page | Standalone. |
| `soon.html` | Coming-soon placeholder | Standalone. |
| `mermaid.html` | Posts using Mermaid diagrams | Injects Mermaid JS; use `layout: mermaid` in post front-matter. |

## Conventions

- New page types should get their own layout rather than overloading an existing one.
- New conditional content in `post.html` (e.g., a new include) follows the existing `{% if %}` pattern there.

## Gotcha

`default.html` has no include-based composition — everything is inline with no section markers. When editing, verify the surrounding context before changing a block; it is easy to break nav or footer accidentally.
