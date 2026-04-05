# _plugins/

Contains one Jekyll plugin: `seo_enhancements.rb`.

## What It Does

Runs two hooks at build time before any post is rendered:

1. **`description`** — if absent from front-matter, truncates `excerpt` to 160 characters and sets it.
2. **`keywords`** — if absent, combines `tags` + `categories` + `['Ruby on Rails', 'PostgreSQL', 'Ruby']`.
3. **`reading_time`** — always computed from word count (≈185 wpm) and set on every post.

## Key Rule

Do not set `description` or `keywords` in front-matter unless you want to override the auto-generated value. The plugin checks `.nil?`, so an explicit front-matter value wins.

## Gotcha

`reading_time` is **always overwritten** — the generator does not check `.nil?`. If a post sets it manually, the plugin silently replaces it.
