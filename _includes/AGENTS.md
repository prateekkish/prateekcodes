# _includes/

Reusable HTML fragments injected by layouts via `{% include %}`.

## Include Map

| File | Purpose | External service |
|---|---|---|
| `seo-meta.html` | `<meta>` tags for SEO, Open Graph, Twitter Card | — |
| `structured-data.html` | JSON-LD schema.org markup for posts | — |
| `giscus.html` | GitHub Discussions comment widget | Giscus — needs `CATEGORY_ID` env var (set in Amplify console) |
| `newsletter-minimal.html` | Inline newsletter CTA | Substack (URL hardcoded in file) |
| `newsletter-popup.html` | Timed newsletter popup | Substack (URL hardcoded in file) |
| `search.html` | Client-side search UI + lunr index builder | — |
| `pagination.html` | Page nav for post list | — |
| `post-card.html` | Post preview card used in lists | — |
| `related-posts.html` | Related posts section at bottom of post | — |
| `share.html` | Social sharing buttons | Twitter/X, LinkedIn |

## How Search Works

`search.html` builds a lunr.js index at compile time by iterating all posts in Liquid. The index is embedded in the page HTML. `assets/js/lunrsearchengine.js` handles client-side queries against that index. Do not change the Liquid loop in `search.html` without also checking `lunrsearchengine.js`.

## Gotchas

- `giscus.html` reads `CATEGORY_ID` from `site.env` via the `jekyll-environment-variables` gem. The value is set in the Amplify console, not in any committed file. Local builds will render comments without a valid category ID.
- Newsletter Substack URLs are hardcoded in both newsletter includes — update both files if the URL changes.
