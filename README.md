# r/returnToIndia Explorer

Interactive React and D3 map of ~4,200 posts from r/returnToIndia. Every
post is a circle sized by engagement (a log-scaled mix of score, comment
count, and upvote ratio); the app packs them into clusters using d3.pack and
lets you search, filter, and drill into full comment threads without ever
hitting a server. It is a static site: all data ships as JSON files built
ahead of time by `compute_metrics.py` in the parent pipeline, and it deploys
automatically to GitHub Pages on push to `main`.

Live data lives in `src/posts_viz.json` (one entry per post) and
`public/threads/<post_id>.json` (one file per post with the full nested
comment tree). Regenerate both from `../compute_metrics.py`; see the root
README for the full pipeline.

---

## Running locally

```bash
npm install
npm run dev
```

```bash
npm run build     # production build to dist/
npm run preview   # preview the production build locally
npm run lint       # eslint
```

---

## Features

### Two ways to slice the data

A toggle in the top-left switches between two independent layouts, both
drawing from the same filtered post set:

- **By Category**: posts clustered into 11 topic categories (career,
  finances, logistics, relationships, culture, other, legal, housing,
  education, healthcare, family), packed together with d3.pack and colored
  per category.
- **By Move Stage**: posts split into three fixed, independently packed
  circles ordered left to right: pre-move, ambiguous, post-move. Within
  each circle, posts are nested a level deeper by post type (question,
  rant, other) so same-type posts naturally pack next to each other, and
  colored accordingly. Move stage and post type are classified by
  `compute_metrics.py`, not by hand.

Each mode has its own collapsible legend for toggling groups on and off,
and clicking a cluster or stage label zooms the view to it.

### Search

A search bar at the top matches posts against comma-separated keywords,
optionally wrapped in curly braces (`{keyword one, keyword two}`). Two
independent toggles control how it works:

- **Post Only vs Full Thread**: search just the post title and body, or the
  title plus the entire flattened thread including comments.
- **Any vs All** (shown once you have 2+ keywords, defaults to Any): match
  posts containing at least one keyword, or require every keyword to
  appear.

Matching posts get a highlighted ring; non-matching posts fade out. This
works the same regardless of which view mode is active.

### Upvote slider

A slider in the bottom-right filters out posts below a minimum upvote
count. Because the corpus is heavily right-skewed (median score around 3,
max over 1,200), the slider position maps to a threshold through a power
curve rather than linearly, so most of the slider's range gives fine
control over the common low-score posts while still reaching the top. This
filter is applied before anything else, so it composes with category
toggles, move-stage/post-type toggles, and search, in either view mode.

### Thread detail panel

Clicking any post circle opens a full thread panel: the post body, localized
reciprocity and tie-bucket stats for that thread, and the entire nested
comment tree (no top-50 cap). Threads are cached in memory after first load,
so re-opening one is instant.

### Markdown dump

The "Dump" button in the top-right exports full threads of whatever is
currently highlighted, ordered by score, as a single markdown file:

- With no filters active, that means every post in the corpus.
- With keywords, an upvote threshold, or category/post-type toggles
  applied, only the posts currently drawn at full opacity are included,
  i.e. exactly what you see highlighted on screen.

Pressing it asks for confirmation first (dumping the full corpus means
fetching thousands of per-post thread files), then shows fetch progress.
The generated markdown opens with a header stating the post count, which
view mode was active, and every filter that was applied, followed by a
breakdown by category, move stage, and post type, before the threads
themselves.

---

## Data model

Each entry in `posts_viz.json` looks roughly like:

```json
{
  "id": "abc123",
  "title": "...",
  "selftext": "...",
  "score": 1234,
  "comments": 56,
  "category": "career",
  "move_stage": "pre",
  "post_type": "question",
  "thread": "...",
  "engagement": 4.21,
  "radius": 0
}
```

`thread` is the flattened title-plus-comments text used for Full Thread
search scope; `radius` is recomputed client-side from `engagement` rather
than trusted from the file, so it can be rescaled independently of whatever
range the pipeline used at generation time.

Each `public/threads/<post_id>.json` file looks like:

```json
{
  "post": { "id": "abc123", "title": "...", "score": 1234, "selftext": "..." },
  "comments": [ { "id": "...", "author_hash": "...", "score": 3, "body": "...", "removed": false, "children": [...] } ],
  "stats": { "unique_pairs": 12, "bucket_counts": {...}, "mean_reciprocity": 0.42, "fully_reciprocal_count": 3 }
}
```

---

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the
site with Vite and publishes `dist/` to GitHub Pages. `vite.config.js` sets
`base: '/reddit-explorer/'` to match the Pages URL path, so a local
`npm run preview` after `npm run build` needs that same base path to
resolve assets correctly.

---

## Stack

React 19, D3 7 (pack layout and zoom/pan only, no direct DOM manipulation
outside the zoom behavior), Vite 8. No backend, no database access from the
browser: everything is pre-baked JSON served as static files.
