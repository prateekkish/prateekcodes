# Prateek Codes

Personal tech blog at [prateekcodes.com](https://prateekcodes.com) covering backend engineering — Ruby on Rails, PostgreSQL, and scaling distributed systems. Each post is a standalone Markdown file compiled by Jekyll into a static site and deployed automatically to AWS Amplify on every push to `main`.

Apply these instructions to the repository root.

## Tech Stack

- **Language:** Ruby 3.2.2 (pinned via `.ruby-version`)
- **Framework:** Jekyll 4 (static site generator)
- **Templating:** Liquid + kramdown-parser-gfm
- **Styling:** SCSS (`_sass/mediumish.scss` → compiled to `assets/css/main.scss`)
- **Search:** lunr.js (client-side full-text search, index built at compile time)
- **Comments:** Giscus (GitHub Discussions — requires `CATEGORY_ID` env var in production)
- **CI/CD:** AWS Amplify (auto-deploys on push to `main` via `amplify.yml`)

## Commands

| Action | Command |
|---|---|
| Install dependencies | `bundle install` |
| Dev server | `bundle exec jekyll serve --watch` → http://localhost:4000 |
| Dev server (Docker) | `docker-compose up` → http://localhost:4000 |
| Production build | `JEKYLL_ENV=production bundle exec jekyll b` |
| Smoke test (no server needed) | `bundle exec jekyll build && ls _site/index.html` |

## Directory Map

| Directory | Purpose |
|---|---|
| `_posts/` | Blog posts as `YYYY-MM-DD-slug.md`. One file per post. See `_posts/AGENTS.md` for writing style and workflow. |
| `_layouts/` | Page shell templates. `default.html` (428 lines) is the base; `post.html`, `page.html`, `archive.html` extend it. |
| `_includes/` | Reusable HTML fragments: SEO tags, comments (Giscus), newsletter, search, related posts, social sharing. |
| `_sass/` | SCSS source. Main styles in `mediumish.scss`. |
| `_pages/` | Static pages (about, search, tags, categories). |
| `_plugins/` | Jekyll hooks. `seo_enhancements.rb` auto-generates `description`, `keywords`, and `reading_time` for every post at pre-render time. |
| `_data/` | YAML data files: `nav_pages.yml` (navigation), `newsletter.yml` (CTA config). |
| `assets/` | Static assets. `assets/js/lunr.js` and `jquery.min.js` are vendored — do not edit. `lunrsearchengine.js` and `mediumish.js` are custom. |
| `_site/` | Build output — gitignored. Never edit directly. |

## Conventions

- **Post naming:** `YYYY-MM-DD-slug-with-hyphens.md` in `_posts/`. The date in the filename sets the post date.
- **Required front-matter:** `layout: post`, `title`, `author: prateek`, `categories`, `tags`, `excerpt`
- **Optional front-matter:** `description` (auto-generated from `excerpt` if absent), `keywords` (auto-generated from `tags`+`categories` if absent), `image`
- **Permalink:** `/:title/` — the date is not part of the URL.
- **`future: true`** — posts with future dates publish immediately; this is intentional.
- **Always use `bundle exec`** — prefix Jekyll commands with `bundle exec`, never bare `jekyll`.

## Deployment

Production deploys run inside AWS Amplify (`amplify.yml`). The GitHub Actions workflow (`.github/workflows/ci-cd.yml`) triggers the Amplify job — it does not build or ship the site itself. Two-step mechanism: GitHub → Amplify.

Required GitHub Secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AMPLIFY_APP_ID`.

## Agent Permission Boundaries

| Action | Allowed without approval |
|---|---|
| Add or edit a post in `_posts/` | Yes |
| Edit `_layouts/`, `_includes/`, `_sass/` | Yes — run `bundle exec jekyll build` after to verify |
| Edit `_config.yml` | No — changes affect all pages |
| Edit `_plugins/seo_enhancements.rb` | No — silently mutates post data at render time |
| Trigger production deploy or modify CI | No — requires human approval |
| Edit vendored JS (`lunr.js`, `jquery.min.js`, `lazyload.js`) | No — treat as read-only |
