import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import * as d3 from "d3";

// ---------------------------------------------------------------------------
// Subreddit registry — each dataset is fetched at runtime (not bundled), so
// switching subreddits is just a re-fetch, no rebuild. viewModes lists which
// clustering axes this dataset supports; "quarter" and "emotion" are both
// universal per-post pipelines (created_utc and classify_emotion.py
// respectively, run per-subreddit against its own DuckDB file), so once a
// subreddit's data has been through them, "emotion" belongs in its
// viewModes too. "category"/"move" require compute_metrics.py's LLM/
// lexicon classification and are currently only
// meaningful for r/returnToIndia.
// ---------------------------------------------------------------------------
const SUBREDDITS = [
  {
    id: "returntoindia", label: "r/returnToIndia",
    dataPath: "data/returntoindia/posts_viz.json",
    threadsPath: "data/returntoindia/threads",
    viewModes: ["category", "move", "quarter", "emotion"],
  },
  {
    id: "h1b", label: "r/h1b",
    dataPath: "data/h1b/posts_viz.json",
    threadsPath: "data/h1b/threads",
    viewModes: ["quarter", "emotion"],
  },
  {
    id: "usvisascheduling", label: "r/usvisascheduling",
    dataPath: "data/usvisascheduling/posts_viz.json",
    threadsPath: "data/usvisascheduling/threads",
    viewModes: ["quarter", "emotion"],
  },
];

const VIEW_MODE_LABELS = { category: "By Category", move: "By Move Stage", quarter: "By Quarter", emotion: "By Emotion" };

const CATEGORIES = [
  "career","finances","logistics","relationships",
  "culture","other","legal","housing",
  "education","healthcare","family",
];

const CATEGORY_COLORS = {
  career:        "#8B7BA8",
  finances:      "#7B9E87",
  logistics:     "#C4956A",
  relationships: "#B8896E",
  culture:       "#9B8EA8",
  other:         "#A8A49E",
  legal:         "#7A9BAF",
  housing:       "#C4845A",
  education:     "#8FAF8F",
  healthcare:    "#7EA8BE",
  family:        "#8DA08D",
};

const CATEGORY_LABELS = {
  career:"Career", finances:"Finances", logistics:"Logistics",
  relationships:"Relationships", culture:"Culture", other:"Other",
  legal:"Legal", housing:"Housing", education:"Education",
  healthcare:"Healthcare", family:"Family",
};

// ---------------------------------------------------------------------------
// Emotion "slice of the cake" — GoEmotions' full 28-label taxonomy (27
// emotions + neutral), used as-is with no collapsing: classify_emotion.py
// writes the model's raw top-scoring label straight to threads.emotion (an
// earlier version collapsed rare labels into a per-family "nearest
// representative," but that produced bad fits for broad families — e.g.
// r/h1b's 12-member "joy" family folding amusement into gratitude just
// because gratitude was more frequent, not because they're similar — so
// it was retired). Unlike CATEGORIES, which is one fixed canonical set
// (normalize_categories.py), which labels actually appear is still
// corpus-dependent (not every subreddit's posts hit all 28), so the active
// bucket list is derived live from the loaded data (see the `emotions`
// memo), the same way `quarters` already is; these tables just cover every
// possible label so whichever subset appears still renders consistently.
// Colors are grouped by GoEmotions' own Ekman family so related emotions
// read as visually related — reds for anger, blues for sadness, greens
// for joy, etc.
// ---------------------------------------------------------------------------
const EMOTION_COLORS = {
  // anger family — reds
  anger:          "#BB5A56",
  annoyance:      "#C97874",
  disapproval:    "#D6928F",
  // disgust family — olive/brown
  disgust:        "#8A7B4F",
  // fear family — purples
  fear:           "#8B7BA8",
  nervousness:    "#A896C4",
  // joy family — greens
  joy:            "#6B9E78",
  amusement:      "#82AC8A",
  approval:       "#99BA9C",
  excitement:     "#5C9468",
  admiration:     "#7FB07A",
  caring:         "#93BD8E",
  desire:         "#A6C79E",
  optimism:       "#71A87F",
  pride:          "#5E8F6C",
  relief:         "#86AD8C",
  gratitude:      "#4F8760",
  love:           "#9AC4A0",
  // sadness family — blues
  sadness:        "#7EA8BE",
  disappointment: "#6B96AC",
  embarrassment:  "#95BBD0",
  grief:          "#587F92",
  remorse:        "#AACBDC",
  // surprise family — oranges
  surprise:       "#C4956A",
  realization:    "#D6A97E",
  confusion:      "#B37F4E",
  curiosity:      "#E0BC98",
  // neutral — same muted gray as category's "other"
  neutral:        "#A8A49E",
};

const EMOTION_LABELS = {
  admiration:"Admiration", amusement:"Amusement", anger:"Anger",
  annoyance:"Annoyance", approval:"Approval", caring:"Caring",
  confusion:"Confusion", curiosity:"Curiosity", desire:"Desire",
  disappointment:"Disappointment", disapproval:"Disapproval", disgust:"Disgust",
  embarrassment:"Embarrassment", excitement:"Excitement", fear:"Fear",
  gratitude:"Gratitude", grief:"Grief", joy:"Joy", love:"Love",
  nervousness:"Nervousness", optimism:"Optimism", pride:"Pride",
  realization:"Realization", relief:"Relief", remorse:"Remorse",
  sadness:"Sadness", surprise:"Surprise", neutral:"Neutral",
};

// curiosity and neutral are the expected baseline for a help-seeking
// subreddit (most posts are literally someone asking a neutral question out
// of curiosity), so they're uninformative as a "dominant emotion" summary.
// Excluded ONLY from the quarter bars' top-2 badge (computeQuarterHistogram)
// — everywhere else (By Emotion view/legend, dump breakdown) they're shown
// like any other emotion, since a single post's own curiosity/neutral label
// is still real, specific information about that post, just not an
// interesting aggregate signal for "what stood out this quarter."
const IGNORED_EMOTIONS = new Set(["curiosity", "neutral"]);

// ---------------------------------------------------------------------------
// Second "slice of the cake": posts positioned by move_stage (pre/ambiguous/
// post, left-to-right) and color-coded by post_type within each cluster.
// ---------------------------------------------------------------------------
const MOVE_STAGES = ["pre", "ambiguous", "post"];

const MOVE_STAGE_LABELS = {
  pre: "Pre-Move", ambiguous: "Ambiguous", post: "Post-Move",
};

const POST_TYPES = ["question", "rant", "other"];

const POST_TYPE_COLORS = {
  question: "#7A9BAF",
  rant:     "#B8896E",
  other:    "#A8A49E",
};

const POST_TYPE_LABELS = { question: "Question", rant: "Rant", other: "Other" };

// Quarter-timeline coloring: post-covid is a flat accent color; covid-window
// posts (Jan 2020 - May 2023) blend toward a "severity" color, strongest at
// the window's midpoint (no specific peak date was given, so this defaults
// to the center of the range and tapers smoothly toward both edges) and
// fading back to the post-covid color at the boundaries. Classification is
// per-post (from created_utc), not per-quarter-bucket, since some quarters
// straddle the boundary (e.g. 2023-Q2 spans Apr-Jun, only Apr-May are
// in-window). Anything outside the window, including anything before it,
// counts as post-covid.
const QUARTER_COLOR = "#7B9E87"; // post-covid / default
const COVID_PEAK_COLOR = "#B85450"; // strongest color at peak severity

const COVID_START = Date.UTC(2020, 0, 1) / 1000;           // Jan 1, 2020
const COVID_END   = Date.UTC(2023, 4, 31, 23, 59, 59) / 1000; // May 31, 2023
const COVID_PEAK   = (COVID_START + COVID_END) / 2;         // range midpoint, ~Sep 2021

const covidColorScale = d3.interpolateRgb(QUARTER_COLOR, COVID_PEAK_COLOR);

// Returns 0-1, 0 outside the covid window (or exactly at its edges), 1 at
// the peak, smoothly tapering in between (raised-cosine / Hann window).
function covidIntensity(createdUtc) {
  if (!createdUtc || createdUtc < COVID_START || createdUtc > COVID_END) return 0;
  const halfSpan = (COVID_END - COVID_START) / 2;
  const distFromPeak = Math.abs(createdUtc - COVID_PEAK);
  const t = Math.min(1, distFromPeak / halfSpan);
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

function quarterPostColor(post) {
  return covidColorScale(covidIntensity(post.created_utc));
}

// ---------------------------------------------------------------------------
// Keyword matching — scope is either 'post' (title + selftext only)
// or 'thread' (title + full flattened thread text, including comments)
// ---------------------------------------------------------------------------
function matchesSearch(post, keywords, scope, mode) {
  if (!keywords.length) return true;
  const haystack = scope === "post"
    ? `${post.title} ${post.selftext || ""}`.toLowerCase()
    : `${post.title} ${post.thread}`.toLowerCase();
  return mode === "any"
    ? keywords.some(kw => haystack.includes(kw))
    : keywords.every(kw => haystack.includes(kw));
}

// ---------------------------------------------------------------------------
// Pack layout — static, computed once. Generic over which field groups
// posts into bubbles (category view passes CATEGORIES/'category'; emotion
// view passes a dynamically-derived group list/'emotion', since unlike
// CATEGORIES not every subreddit's posts hit all 28 possible emotions).
// ---------------------------------------------------------------------------
function computeLayout(posts, outerR, groups, groupField) {
  // Same empty-children pitfall as below, but at the root: with zero posts
  // (e.g. the async fetch hasn't resolved yet) every group is
  // simultaneously empty, so root.children itself would be [], and
  // d3.hierarchy() would misread the whole root as a leaf with no parent —
  // "leaf.parent.data" then throws on null. Short-circuit before ever
  // building that tree.
  if (!posts.length || !groups.length) return { clusters: {}, centroids: {} };

  const byGroup = {};
  groups.forEach(g => { byGroup[g] = []; });
  posts.forEach(p => { if (byGroup[p[groupField]]) byGroup[p[groupField]].push(p); });

  // d3.hierarchy() treats a node whose children accessor returns an empty
  // array as a childless leaf (it never assigns `.children`), not as a
  // pruned branch — so a group with 0 posts left after filtering must be
  // left out of the tree entirely, or its "leaf" gets misread as a post.
  const root = {
    children: groups
      .filter(g => byGroup[g].length > 0)
      .map(g => ({
        group: g,
        children: byGroup[g].map(p => ({ post: p, r: p.radius, value: p.radius * p.radius })),
      })),
  };

  const pack = d3.pack()
    .size([outerR * 2, outerR * 2])
    .padding(2);

  const hierarchy = d3.hierarchy(root)
    .sum(d => d.value || 0)
    .sort((a, b) => b.value - a.value);

  pack(hierarchy);

  const offsetX = outerR;
  const offsetY = outerR;

  const clusters = {};
  groups.forEach(g => { clusters[g] = []; });

  hierarchy.leaves().forEach(leaf => {
    const g = leaf.parent.data.group;
    clusters[g].push({
      x: leaf.x - offsetX,
      y: leaf.y - offsetY,
      r: leaf.r,
      post: leaf.data.post,
    });
  });

  const centroids = {};
  Object.entries(clusters).forEach(([g, circles]) => {
    if (!circles.length) return;
    centroids[g] = {
      x: circles.reduce((s, c) => s + c.x, 0) / circles.length,
      y: circles.reduce((s, c) => s + c.y, 0) / circles.length,
    };
  });

  return { clusters, centroids };
}

// ---------------------------------------------------------------------------
// Generic "N fixed circles side by side" pack layout — one independent pack
// per bucket, each confined to its own fixed-radius circle, rather than one
// shared pack. That's what gives buckets their fixed left-to-right ordering,
// instead of leaving placement up to the pack algorithm. Used for both the
// move-stage view (3 buckets, sub-nested by post_type) and the quarter
// timeline (N buckets, flat) — the only difference is whether a sub-field
// is provided for a second nesting level.
// ---------------------------------------------------------------------------
function computeBucketLayout(posts, buckets, bucketField, bucketR, subField, subTypes) {
  const byBucket = {};
  buckets.forEach(b => { byBucket[b] = []; });
  posts.forEach(p => { if (byBucket[p[bucketField]]) byBucket[p[bucketField]].push(p); });

  const clusters = {};
  buckets.forEach(bucket => {
    const bucketPosts = byBucket[bucket];
    if (!bucketPosts.length) { clusters[bucket] = []; return; }

    let root;
    if (subField && subTypes) {
      const bySub = {};
      subTypes.forEach(s => { bySub[s] = []; });
      bucketPosts.forEach(p => { if (bySub[p[subField]]) bySub[p[subField]].push(p); });

      // Same empty-children pitfall as computeLayout(): a sub-type with 0
      // posts in this bucket must be left out of the tree entirely, or
      // d3.hierarchy() misreads its childless node as a post leaf.
      root = {
        children: subTypes
          .filter(s => bySub[s].length > 0)
          .map(s => ({
            sub: s,
            children: bySub[s].map(p => ({ post: p, r: p.radius, value: p.radius * p.radius })),
          })),
      };
    } else {
      root = {
        children: bucketPosts.map(p => ({ post: p, r: p.radius, value: p.radius * p.radius })),
      };
    }

    const pack = d3.pack().size([bucketR * 2, bucketR * 2]).padding(1.5);
    const hierarchy = d3.hierarchy(root)
      .sum(d => d.value || 0)
      .sort((a, b) => b.value - a.value);
    pack(hierarchy);

    clusters[bucket] = hierarchy.leaves().map(leaf => ({
      x: leaf.x - bucketR,
      y: leaf.y - bucketR,
      r: leaf.r,
      post: leaf.data.post,
    }));
  });

  return clusters;
}

// ---------------------------------------------------------------------------
// Quarter timeline as a dot-histogram — a Wilkinson-style plot, not a
// circle pack: each quarter is a narrow fixed-width column, and posts (as
// circles) settle onto a shared baseline via a d3-force simulation
// (downward pull + collision), stacking like balls dropped into a thin
// beaker. Column height reads as post volume for that quarter, and the
// "bar" is literally made of the individual posts, not a drawn rectangle.
// Deliberately not a circle pack: pack fills a fixed bounding shape
// regardless of count, which can't represent "how much" the way a
// variable-height stack can.
// ---------------------------------------------------------------------------
// Async + chunked one quarter at a time, yielding to the browser after each
// so (a) the main thread isn't blocked solid for the whole computation and
// (b) onProgress can drive a visible progress bar rather than the UI just
// freezing until it's all done. isStale() is checked between quarters so a
// superseded call (e.g. the slider moved again before this one finished)
// can bail out instead of racing a newer request to set state.
// Circle radius here must NOT be the dataset-wide engagement radius (8-44px,
// scaled for the much roomier category/move-stage packs) — reusing it would
// let a quarter's few outlier high-engagement posts blow past the grid's
// ~12px row assumption and inflate that bar's height independent of its
// post count, which is exactly the "900 posts shorter than 889" bug this
// fixes. Instead each quarter recalibrates its own posts' radii to this
// small fixed range (still ranked by relative engagement within that
// quarter), so bar height is governed by count alone.
const QUARTER_ROW_SIZE = 12;
const QUARTER_MIN_R = 2.4;
const QUARTER_MAX_R = 5.2; // leaves room for the collide force's +0.6 padding within a 12px row

async function computeQuarterHistogram(posts, quarters, centerX, columnWidth, floorY, onProgress, isStale) {
  const byQuarter = {};
  quarters.forEach(q => { byQuarter[q] = []; });
  posts.forEach(p => { if (byQuarter[p.quarter]) byQuarter[p.quarter].push(p); });

  const clusters = {};
  const counts = {};
  const topEmotions = {};
  const halfWidth = columnWidth / 2;
  const totalPosts = posts.length;
  let processedPosts = 0;

  for (const q of quarters) {
    if (isStale && isStale()) return null;
    const qPosts = byQuarter[q];
    counts[q] = qPosts.length;

    // Top 2 emotions for this quarter's badge overlay — cheap (one pass,
    // independent of the physics sim below), so compute it unconditionally
    // even for an empty/no-emotion-data quarter (topEmotions[q] just ends
    // up []). Posts with no emotion classification (p.emotion null) are
    // skipped rather than counted under a fake bucket, and curiosity/
    // neutral are excluded as the uninformative baseline for a
    // help-seeking subreddit (see IGNORED_EMOTIONS).
    const emotionTally = {};
    qPosts.forEach(p => {
      if (p.emotion && !IGNORED_EMOTIONS.has(p.emotion)) emotionTally[p.emotion] = (emotionTally[p.emotion]||0) + 1;
    });
    topEmotions[q] = Object.entries(emotionTally)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([emotion, count]) => ({ emotion, count, pct: qPosts.length ? count / qPosts.length : 0 }));

    if (!qPosts.length) {
      clusters[q] = [];
      onProgress && onProgress(totalPosts ? processedPosts / totalPosts : 1);
      continue;
    }

    const cx = centerX[q];

    // Recalibrate this quarter's radii to the fixed small range the grid
    // expects — still ranked by each post's relative engagement within
    // this quarter (its most-engaged post gets QUARTER_MAX_R, its least
    // gets QUARTER_MIN_R), just decoupled from the dataset-wide 8-44px
    // scale so it can't distort this bar's height.
    const engagementMin = Math.min(...qPosts.map(p => p.radius));
    const engagementMax = Math.max(...qPosts.map(p => p.radius));
    const engagementSpan = engagementMax - engagementMin || 1;
    const barRadius = (p) =>
      QUARTER_MIN_R + (QUARTER_MAX_R - QUARTER_MIN_R) * (p.radius - engagementMin) / engagementSpan;

    // Deterministic initial layout (rows stacked upward from the floor,
    // spread evenly across the column) rather than random jitter, so the
    // simulation converges quickly and consistently from a sane starting
    // point instead of untangling from noise.
    const perRow = Math.max(1, Math.floor(columnWidth / QUARTER_ROW_SIZE));
    const nodes = qPosts.map((p, i) => ({
      post: p,
      r: barRadius(p),
      x: cx + ((i % perRow) - (perRow - 1) / 2) * (columnWidth / perRow),
      y: floorY - Math.floor(i / perRow) * QUARTER_ROW_SIZE - 10,
    }));

    // alphaDecay is cranked well above d3's default (0.0228, tuned for
    // random-start layouts that need ~300 ticks to untangle) since these
    // nodes start from an already-organized grid — cooling fast just means
    // "stop once it's stopped moving" instead of always spending a fixed
    // 200 ticks whether or not the layout has settled.
    const sim = d3.forceSimulation(nodes)
      .force("x", d3.forceX(cx).strength(0.06))
      .force("y", d3.forceY(floorY).strength(0.2))
      .force("collide", d3.forceCollide(d => d.r + 0.6).iterations(2))
      .alphaDecay(0.08)
      .stop();

    const MAX_TICKS = 200; // safety cap; alpha threshold below exits earlier in practice
    for (let i = 0; i < MAX_TICKS; i++) {
      sim.tick();
      // Hard walls: the simulation's forces are soft (spring-like) and can
      // overshoot, so clamp back inside the beaker and above the floor
      // after every tick rather than trusting the forces alone to respect
      // boundaries they don't actually know about.
      nodes.forEach(n => {
        n.x = Math.max(cx - halfWidth + n.r, Math.min(cx + halfWidth - n.r, n.x));
        n.y = Math.min(floorY - n.r, n.y);
      });
      if (sim.alpha() < sim.alphaMin()) break;
    }

    clusters[q] = nodes.map(n => ({ x: n.x, y: n.y, r: n.r, post: n.post }));
    processedPosts += qPosts.length;
    onProgress && onProgress(totalPosts ? processedPosts / totalPosts : 1);

    // Yield to the browser between quarters so a paint (the progress bar,
    // or anything else) can actually happen instead of the whole timeline
    // computing in one uninterrupted synchronous block.
    await new Promise(resolve => requestAnimationFrame(resolve));
  }

  return { clusters, counts, topEmotions };
}

// ---------------------------------------------------------------------------
// Search bar
// ---------------------------------------------------------------------------
function SearchBar({ value, onChange, matchCount, searching, scope, onScopeChange, matchMode, onMatchModeChange, multiKeyword }) {
  return (
    <div style={{
      position:"fixed", top:14, left:"50%",
      transform:"translateX(-50%)",
      zIndex:50,
      display:"flex", alignItems:"center", gap:8,
    }}>
      <div style={{
        display:"flex", alignItems:"center",
        background:"#FAFAF8", border:"1px solid #E0DDD8",
        borderRadius:7, padding:"5px 12px",
        boxShadow:"0 2px 10px rgba(0,0,0,0.05)",
        gap:7,
      }}>
        <span style={{ fontSize:12, color:"#CCC", lineHeight:1 }}>⌕</span>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="keyword one, keyword two, ..."
          style={{
            border:"none", outline:"none",
            background:"transparent",
            fontSize:12, color:"#1A1A1A",
            fontFamily:"Inter,sans-serif",
            width:200,
          }}
        />
        {value && (
          <button
            onClick={() => onChange("")}
            style={{
              background:"none", border:"none", cursor:"pointer",
              fontSize:12, color:"#CCC", padding:0, lineHeight:1,
            }}
          >✕</button>
        )}
      </div>

      {/* Scope toggle: search post body only, or the full thread incl. comments */}
      <div style={{
        display:"flex", background:"#FAFAF8", border:"1px solid #E0DDD8",
        borderRadius:7, overflow:"hidden",
        boxShadow:"0 2px 10px rgba(0,0,0,0.05)",
        fontFamily:"Inter,sans-serif",
      }}>
        {["post", "thread"].map(s => (
          <button
            key={s}
            onClick={() => onScopeChange(s)}
            style={{
              padding:"5px 11px", fontSize:11, cursor:"pointer",
              border:"none",
              background: scope === s ? "#1A1A1A" : "transparent",
              color: scope === s ? "#FAFAF8" : "#AAA",
              fontWeight: scope === s ? 600 : 400,
              transition:"all 0.15s",
            }}
          >
            {s === "post" ? "Post Only" : "Full Thread"}
          </button>
        ))}
      </div>

      {/* ANY/ALL toggle: only meaningful with 2+ comma-separated keywords */}
      {multiKeyword && (
        <div style={{
          display:"flex", background:"#FAFAF8", border:"1px solid #E0DDD8",
          borderRadius:7, overflow:"hidden",
          boxShadow:"0 2px 10px rgba(0,0,0,0.05)",
          fontFamily:"Inter,sans-serif",
        }}>
          {["any", "all"].map(m => (
            <button
              key={m}
              onClick={() => onMatchModeChange(m)}
              style={{
                padding:"5px 11px", fontSize:11, cursor:"pointer",
                border:"none",
                background: matchMode === m ? "#1A1A1A" : "transparent",
                color: matchMode === m ? "#FAFAF8" : "#AAA",
                fontWeight: matchMode === m ? 600 : 400,
                transition:"all 0.15s",
              }}
            >
              {m === "any" ? "Any" : "All"}
            </button>
          ))}
        </div>
      )}

      {searching && (
        <span style={{
          fontSize:11, color:"#AAA",
          fontFamily:"Inter,sans-serif",
          background:"#FAFAF8",
          border:"1px solid #E0DDD8",
          borderRadius:6, padding:"5px 10px",
          boxShadow:"0 2px 10px rgba(0,0,0,0.05)",
          whiteSpace:"nowrap",
        }}>
          {matchCount} match{matchCount !== 1 ? "es" : ""}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// In-memory cache so re-opening an already-viewed thread doesn't re-fetch.
// Keyed by post ID alone (fine across subreddits too — real Reddit post IDs
// are globally unique).
// ---------------------------------------------------------------------------
const threadCache = new Map();

async function fetchThreadData(postId, threadsPath) {
  if (threadCache.has(postId)) return threadCache.get(postId);
  const res = await fetch(`${import.meta.env.BASE_URL}${threadsPath}/${postId}.json`);
  if (!res.ok) throw new Error(`Failed to load thread ${postId} (${res.status})`);
  const data = await res.json();
  threadCache.set(postId, data);
  return data;
}

// ---------------------------------------------------------------------------
// Markdown dump — full threads of whatever's currently highlighted, ordered
// by score, with a header describing exactly which filters produced the set.
// ---------------------------------------------------------------------------
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function mdEscapeHeading(text) {
  return (text || "").replace(/\n/g, " ").trim();
}

function renderCommentMd(node, depth) {
  const indent = "  ".repeat(depth);
  const author = node.author_hash ? node.author_hash.slice(0, 8) : "unknown";
  const bodyText = node.removed ? "*[deleted/removed]*" : (node.body || "").trim() || "*[empty]*";
  const bodyIndented = bodyText.split("\n").join(`\n${indent}  `);
  let out = `${indent}- **${author}** (↑${node.score}): ${bodyIndented}\n`;
  (node.children || []).forEach(child => { out += renderCommentMd(child, depth + 1); });
  return out;
}

function renderPostMd(index, post, threadData) {
  const lines = [];
  lines.push(`## ${index}. ${mdEscapeHeading(post.title)}`);
  lines.push("");
  lines.push(`- **Score:** ${post.score.toLocaleString()}  |  **Comments:** ${post.comments.toLocaleString()}`);
  lines.push(`- **Category:** ${CATEGORY_LABELS[post.category] || post.category}  |  **Move stage:** ${MOVE_STAGE_LABELS[post.move_stage] || post.move_stage}  |  **Post type:** ${POST_TYPE_LABELS[post.post_type] || post.post_type}  |  **Quarter:** ${post.quarter}`);
  lines.push(`- **Post ID:** ${post.id}`);
  lines.push("");

  const selftext = threadData?.post?.selftext;
  if (selftext && selftext.trim()) {
    lines.push(selftext.trim());
    lines.push("");
  }

  const stats = threadData?.stats;
  if (stats) {
    lines.push(
      `**Thread stats:** ${stats.unique_pairs} pairs · ` +
      `${stats.bucket_counts?.single_shot || 0} single-shot · ` +
      `${stats.bucket_counts?.repeat_single_thread || 0} repeat · ` +
      `mean reciprocity ${stats.mean_reciprocity?.toFixed?.(2) ?? stats.mean_reciprocity} · ` +
      `${stats.fully_reciprocal_count} fully reciprocal`
    );
    lines.push("");
  }

  const comments = threadData?.comments || [];
  if (!comments.length) {
    lines.push("*No comments on this post.*");
  } else {
    lines.push("### Comments");
    lines.push("");
    comments.forEach(c => { lines.push(renderCommentMd(c, 0)); });
  }

  lines.push("\n---\n");
  return lines.join("\n");
}

function renderDumpHeader({ posts, subredditLabel, viewMode, availableModes, keywords, searchScope, matchMode, minScore, activeCategories, activePostTypes, activeEmotions }) {
  const lines = [];
  lines.push(`# ${subredditLabel} — Thread Dump`);
  lines.push("");
  lines.push(`- **Posts included:** ${posts.length.toLocaleString()}`);
  lines.push(`- **Ordered by:** score (descending)`);
  lines.push(`- **Classification view:** ${VIEW_MODE_LABELS[viewMode] || viewMode}`);

  lines.push(keywords.length
    ? `- **Keyword search:** {${keywords.join(", ")}} — match ${matchMode.toUpperCase()}, scope: ${searchScope === "post" ? "Post Only" : "Full Thread"}`
    : `- **Keyword search:** none`);
  lines.push(`- **Min upvotes:** ${minScore.toLocaleString()}+`);

  if (viewMode === "category" && availableModes.includes("category")) {
    const active = CATEGORIES.filter(c => activeCategories.has(c));
    lines.push(`- **Active categories:** ${active.length === CATEGORIES.length ? "all" : active.map(c => CATEGORY_LABELS[c]).join(", ") || "none"}`);
  } else if (viewMode === "move" && availableModes.includes("move")) {
    const active = POST_TYPES.filter(t => activePostTypes.has(t));
    lines.push(`- **Active post types:** ${active.length === POST_TYPES.length ? "all" : active.map(t => POST_TYPE_LABELS[t]).join(", ") || "none"}`);
  } else if (viewMode === "emotion" && availableModes.includes("emotion")) {
    const present = [...new Set(posts.map(p => p.emotion).filter(Boolean))];
    const active = present.filter(e => activeEmotions.has(e));
    lines.push(`- **Active emotions:** ${active.length === present.length ? "all" : active.map(e => EMOTION_LABELS[e] || e).join(", ") || "none"}`);
  }

  const catCounts = {}, stageCounts = {}, typeCounts = {}, quarterCounts = {}, emoCounts = {};
  posts.forEach(p => {
    catCounts[p.category]     = (catCounts[p.category]||0) + 1;
    stageCounts[p.move_stage] = (stageCounts[p.move_stage]||0) + 1;
    typeCounts[p.post_type]   = (typeCounts[p.post_type]||0) + 1;
    quarterCounts[p.quarter]  = (quarterCounts[p.quarter]||0) + 1;
    if (p.emotion) emoCounts[p.emotion] = (emoCounts[p.emotion]||0) + 1;
  });

  lines.push("");
  if (availableModes.includes("category")) {
    lines.push(`**Category breakdown:** ` + Object.entries(catCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${CATEGORY_LABELS[k] || k}: ${v}`)
      .join(", "));
  }
  if (availableModes.includes("move")) {
    lines.push(`**Move-stage breakdown:** ` + MOVE_STAGES.map(s => `${MOVE_STAGE_LABELS[s]}: ${stageCounts[s]||0}`).join(", "));
    lines.push(`**Post-type breakdown:** ` + POST_TYPES.map(t => `${POST_TYPE_LABELS[t]}: ${typeCounts[t]||0}`).join(", "));
  }
  if (availableModes.includes("emotion")) {
    lines.push(`**Emotion breakdown:** ` + Object.entries(emoCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${EMOTION_LABELS[k] || k}: ${v}`)
      .join(", "));
  }
  lines.push(`**Quarter breakdown:** ` + Object.entries(quarterCounts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}: ${v}`)
    .join(", "));
  lines.push("");
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

async function buildDumpMarkdown({ posts, subredditLabel, threadsPath, viewMode, availableModes, keywords, searchScope, matchMode, minScore, activeCategories, activePostTypes, activeEmotions, onProgress }) {
  const sorted = [...posts].sort((a, b) => b.score - a.score);
  const header = renderDumpHeader({ posts: sorted, subredditLabel, viewMode, availableModes, keywords, searchScope, matchMode, minScore, activeCategories, activePostTypes, activeEmotions });

  let done = 0;
  const total = sorted.length;
  onProgress?.(0, total);

  const threadDataList = await mapWithConcurrency(sorted, 10, async (post) => {
    const data = await fetchThreadData(post.id, threadsPath);
    done += 1;
    onProgress?.(done, total);
    return data;
  });

  const body = sorted.map((post, i) => renderPostMd(i + 1, post, threadDataList[i])).join("\n");
  return header + body;
}

function downloadMarkdown(content, filename) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Stats bar — localized reciprocity/bucket summary for this thread
// ---------------------------------------------------------------------------
function Stat({ label, value }) {
  return (
    <div style={{ display:"flex", flexDirection:"column" }}>
      <span style={{ fontSize:8, textTransform:"uppercase", letterSpacing:"0.08em", color:"#CCC" }}>{label}</span>
      <span style={{ fontSize:13, fontWeight:600, color:"#1A1A1A" }}>{value}</span>
    </div>
  );
}

function ThreadStats({ stats }) {
  if (!stats) return (
    <p style={{ fontSize:11, color:"#CCC", fontFamily:"Inter,sans-serif", margin:"0 0 14px" }}>
      No user-to-user reply pairs in this thread.
    </p>
  );
  return (
    <div style={{
      display:"flex", flexWrap:"wrap", gap:"10px 18px",
      padding:"10px 0 14px", borderBottom:"1px solid #EDEBE6", marginBottom:16,
    }}>
      <Stat label="Pairs" value={stats.unique_pairs} />
      <Stat label="Single-shot" value={stats.bucket_counts?.single_shot || 0} />
      <Stat label="Repeat" value={stats.bucket_counts?.repeat_single_thread || 0} />
      <Stat label="Mean reciprocity" value={stats.mean_reciprocity?.toFixed(2)} />
      <Stat label="Fully reciprocal" value={stats.fully_reciprocal_count} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recursive nested comment renderer
// ---------------------------------------------------------------------------
function CommentNode({ node, depth, color, highlight }) {
  return (
    <div style={{ marginLeft: depth * 16, marginBottom: 12 }}>
      <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:3 }}>
        <span style={{ fontSize:10, fontFamily:"monospace", color:"#999" }}>
          {node.author_hash ? node.author_hash.slice(0, 8) : "unknown"}
        </span>
        <span style={{ fontSize:10, color:"#BBB" }}>↑{node.score}</span>
      </div>
      <p style={{ margin:"0 0 4px", fontSize:13, fontFamily:"Georgia,serif", color: node.removed ? "#CCC" : "#2C2C2C", lineHeight:1.6, fontStyle: node.removed ? "italic" : "normal" }}>
        {node.removed ? "[deleted/removed]" : highlight(node.body || "")}
      </p>
      {node.children?.map(child => (
        <CommentNode key={child.id} node={child} depth={depth + 1} color={color} highlight={highlight} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thread panel — fetches the full nested thread + stats for the selected post
// ---------------------------------------------------------------------------
function ThreadPanel({ post, threadsPath, keywords, onClose }) {
  const [threadData, setThreadData] = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const color = CATEGORY_COLORS[post.category] || CATEGORY_COLORS.other;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setThreadData(null);

    fetchThreadData(post.id, threadsPath)
      .then(data => {
        if (cancelled) return;
        setThreadData(data);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [post.id, threadsPath]);

  function highlight(text) {
    if (!keywords.length) return text;
    const pattern = new RegExp(`(${keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join("|")})`, "gi");
    const parts = text.split(pattern);
    return parts.map((part, i) =>
      pattern.test(part)
        ? <mark key={i} style={{ background:"#FFF3B0", borderRadius:2, padding:"0 1px" }}>{part}</mark>
        : part
    );
  }

  return (
    <div style={{
      position:"fixed", top:0, right:0,
      width:"min(520px, 92vw)", height:"100vh",
      background:"#FAFAF8", borderLeft:"1px solid #E0DDD8",
      display:"flex", flexDirection:"column",
      zIndex:100, fontFamily:"Inter,sans-serif",
      boxShadow:"-4px 0 24px rgba(0,0,0,0.07)",
    }}>
      <div style={{ padding:"18px 22px 0", borderBottom:"1px solid #EDEBE6", flexShrink:0 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:7 }}>
          <span style={{ fontSize:9, fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase", color }}>
            {CATEGORY_LABELS[post.category] || post.category}
          </span>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", fontSize:15, color:"#CCC", padding:0 }}>✕</button>
        </div>
        <h2 style={{ margin:"0 0 9px", fontSize:15, fontWeight:600, color:"#1A1A1A", lineHeight:1.4, fontFamily:"Georgia,serif" }}>
          {highlight(post.title)}
        </h2>
        <div style={{ display:"flex", gap:14, fontSize:11, color:"#BBB", marginBottom:13 }}>
          <span>↑ {post.score.toLocaleString()}</span>
          <span>💬 {post.comments.toLocaleString()}</span>
        </div>
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"18px 22px" }}>
        {loading && (
          <p style={{ fontSize:12, color:"#CCC", fontFamily:"Inter,sans-serif" }}>Loading thread...</p>
        )}
        {error && (
          <p style={{ fontSize:12, color:"#C4645A", fontFamily:"Inter,sans-serif" }}>
            Couldn't load this thread: {error}
          </p>
        )}
        {threadData && (
          <>
            {threadData.post?.selftext && threadData.post.selftext.trim() && (
              <div style={{ marginBottom:18, paddingBottom:16, borderBottom:"1px solid #EDEBE6" }}>
                {threadData.post.selftext.split("\n").map((line, i) => (
                  line.trim()
                    ? <p key={i} style={{ margin:"0 0 6px", fontSize:13, fontFamily:"Georgia,serif", color:"#2C2C2C", lineHeight:1.7 }}>{highlight(line)}</p>
                    : null
                ))}
              </div>
            )}
            <ThreadStats stats={threadData.stats} />
            {threadData.comments.length === 0 && (
              <p style={{ fontSize:12, color:"#CCC" }}>No comments on this post.</p>
            )}
            {threadData.comments.map(node => (
              <CommentNode key={node.id} node={node} depth={0} color={color} highlight={highlight} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------
// hasCategoryData = whether the active subreddit has real category
// classification at all (r/returnToIndia does; h1b/usvisascheduling don't,
// so their posts' category is always the meaningless "other" fallback
// compute_metrics.py writes when threads.category is empty). Driven off
// activeSubreddit.viewModes rather than post.category itself, since
// "other" is ALSO a legitimate real category for r/returnToIndia and the
// two cases aren't distinguishable from the string value alone.
function Tooltip({ post, x, y, hasCategoryData }) {
  const categoryColor = CATEGORY_COLORS[post.category] || CATEGORY_COLORS.other;
  const categoryLabel = CATEGORY_LABELS[post.category] || post.category;
  const emotionLabel  = post.emotion ? (EMOTION_LABELS[post.emotion] || post.emotion) : null;
  const emotionColor  = EMOTION_COLORS[post.emotion] || EMOTION_COLORS.neutral;

  return (
    <div style={{
      position:"fixed",
      left: Math.min(x+14, window.innerWidth-290),
      top:  Math.max(y-10, 10),
      background:"#FAFAF8", border:"1px solid #E0DDD8",
      borderRadius:7, padding:"9px 13px", maxWidth:270,
      pointerEvents:"none", zIndex:200,
      boxShadow:"0 4px 16px rgba(0,0,0,0.08)",
      fontFamily:"Inter,sans-serif",
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:4 }}>
        {/* Real category (or its absence) always takes the primary slot;
            emotion rides alongside it as a second tag when both exist, or
            stands in alone when this subreddit has no category data. */}
        {hasCategoryData && (
          <span style={{ fontSize:9, fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase", color:categoryColor }}>
            {categoryLabel}
          </span>
        )}
        {hasCategoryData && emotionLabel && (
          <span style={{ fontSize:9, color:"#DDD" }}>·</span>
        )}
        {emotionLabel && (
          <span style={{ fontSize:9, fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase", color:emotionColor }}>
            {emotionLabel}
          </span>
        )}
      </div>
      <p style={{ margin:"0 0 6px", fontSize:12, color:"#1A1A1A", lineHeight:1.4, fontFamily:"Georgia,serif" }}>
        {post.title}
      </p>
      <div style={{ display:"flex", gap:12, fontSize:10, color:"#BBB" }}>
        <span>↑ {post.score.toLocaleString()}</span>
        <span>💬 {post.comments.toLocaleString()}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Score slider — filters out posts below a minimum upvote count, independent
// of category toggles and keyword search
// ---------------------------------------------------------------------------
function ScoreSlider({ sliderPos, onChange, minScore, visibleCount, totalCount }) {
  return (
    <div style={{
      position:"fixed", bottom:24, right:24,
      background:"#FAFAF8", border:"1px solid #E0DDD8",
      borderRadius:8, padding:"12px 14px",
      fontFamily:"Inter,sans-serif", zIndex:50,
      minWidth:200,
      boxShadow:"0 2px 10px rgba(0,0,0,0.05)",
    }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
        <p style={{ margin:0, fontSize:9, fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase", color:"#CCC" }}>
          Min Upvotes
        </p>
        <span style={{ fontSize:11, color:"#2C2C2C", fontWeight:600 }}>
          {minScore.toLocaleString()}+
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={sliderPos}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width:"100%", accentColor:"#1A1A1A", cursor:"pointer" }}
      />
      <p style={{ margin:"8px 0 0", fontSize:10, color:"#CCC" }}>
        {visibleCount.toLocaleString()} / {totalCount.toLocaleString()} posts
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legend — collapsible. Generic over "items" so it can drive either the
// category toggles or the post-type toggles depending on view mode.
// ---------------------------------------------------------------------------
function Legend({ title, items, activeKeys, onToggle }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div style={{
      background:"#FAFAF8", border:"1px solid #E0DDD8",
      borderRadius:8, padding:"12px 14px",
      fontFamily:"Inter,sans-serif",
      minWidth:168,
      boxShadow:"0 2px 10px rgba(0,0,0,0.05)",
      transition:"all 0.2s ease",
    }}>
      <div
        onClick={() => setExpanded(prev => !prev)}
        style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          cursor:"pointer", marginBottom: expanded ? 9 : 0,
        }}
      >
        <p style={{ margin:0, fontSize:9, fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase", color:"#CCC" }}>
          {title}
        </p>
        <span style={{ fontSize:10, color:"#CCC", marginLeft:10, lineHeight:1 }}>
          {expanded ? "▾" : "▸"}
        </span>
      </div>

      {expanded && (
        <>
          {/* Scrolls rather than growing unbounded — the full 27+neutral
              GoEmotions taxonomy (no collapsing) can mean 20+ rows for a
              single subreddit, easily taller than the viewport. */}
          <div style={{ maxHeight:"38vh", overflowY: items.length > 14 ? "auto" : "visible" }}>
            {items.map(item => {
              const active = activeKeys.has(item.key);
              return (
                <div key={item.key} onClick={() => onToggle(item.key)} style={{
                  display:"flex", alignItems:"center", justifyContent:"space-between",
                  gap:7, marginBottom:5, cursor:"pointer",
                  opacity: active ? 1 : 0.28, transition:"opacity 0.15s",
                }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ width:6, height:6, borderRadius:"50%", background:item.color, flexShrink:0 }}/>
                    <span style={{ fontSize:11, color:"#2C2C2C" }}>{item.label}</span>
                  </div>
                  <span style={{ fontSize:10, color:"#CCC" }}>{item.count||0}</span>
                </div>
              );
            })}
          </div>
          <p style={{ margin:"9px 0 0", fontSize:15, color:"#000000", lineHeight:1.4 }}>Click to filter</p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SimulationLoadingOverlay — reassures the user the quarter timeline's
// force simulation is still settling rather than the app having hung,
// since it's the one view whose layout isn't instant.
// ---------------------------------------------------------------------------
function SimulationLoadingOverlay({ progress }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div style={{
      position:"fixed", top:"50%", left:"50%", transform:"translate(-50%,-50%)",
      background:"#FAFAF8", border:"1px solid #E0DDD8", borderRadius:10,
      padding:"18px 22px", zIndex:80, minWidth:220,
      fontFamily:"Inter,sans-serif",
      boxShadow:"0 4px 20px rgba(0,0,0,0.08)",
    }}>
      <p style={{ margin:"0 0 10px", fontSize:12, color:"#2C2C2C", textAlign:"center" }}>
        Settling layout…
      </p>
      <div style={{ width:"100%", height:6, background:"#E0DDD8", borderRadius:3, overflow:"hidden" }}>
        <div style={{
          width:`${pct}%`, height:"100%", background:"#1A1A1A", borderRadius:3,
          transition:"width 0.12s linear",
        }}/>
      </div>
      <p style={{ margin:"8px 0 0", fontSize:10, color:"#CCC", textAlign:"center" }}>
        {pct}%
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CovidLegend — explains the covid/post-covid gradient in quarter view.
// ---------------------------------------------------------------------------
function CovidLegend() {
  const [expanded, setExpanded] = useState(true);

  return (
    <div style={{
      background:"#FAFAF8", border:"1px solid #E0DDD8",
      borderRadius:8, padding:"12px 14px",
      fontFamily:"Inter,sans-serif",
      minWidth:168,
      boxShadow:"0 2px 10px rgba(0,0,0,0.05)",
      transition:"all 0.2s ease",
    }}>
      <div
        onClick={() => setExpanded(prev => !prev)}
        style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          cursor:"pointer", marginBottom: expanded ? 9 : 0,
        }}
      >
        <p style={{ margin:0, fontSize:9, fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase", color:"#CCC" }}>
          Coloring
        </p>
        <span style={{ fontSize:10, color:"#CCC", marginLeft:10, lineHeight:1 }}>
          {expanded ? "▾" : "▸"}
        </span>
      </div>

      {expanded && (
        <>
          <div style={{
            height:8, borderRadius:4, marginBottom:6,
            background: `linear-gradient(to right, ${QUARTER_COLOR}, ${COVID_PEAK_COLOR}, ${QUARTER_COLOR})`,
          }}/>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#AAA", marginBottom:8 }}>
            <span>Jan 2020</span>
            <span>peak</span>
            <span>May 2023</span>
          </div>
          <p style={{ margin:0, fontSize:11, color:"#2C2C2C", lineHeight:1.4 }}>
            Posts are colored by closeness to peak covid severity (~Sep 2021). Posts outside Jan 2020 – May 2023 stay the default color.
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// View mode toggle — switches between whichever clustering axes the active
// subreddit supports (category / move stage / quarter)
// ---------------------------------------------------------------------------
function ViewModeToggle({ mode, modes, onChange }) {
  return (
    <div style={{
      display:"flex", background:"#FAFAF8", border:"1px solid #E0DDD8",
      borderRadius:7, overflow:"hidden",
      boxShadow:"0 2px 10px rgba(0,0,0,0.05)",
      fontFamily:"Inter,sans-serif",
    }}>
      {modes.map(m => (
        <button
          key={m}
          onClick={() => onChange(m)}
          style={{
            padding:"5px 11px", fontSize:11, cursor:"pointer",
            border:"none",
            background: mode === m ? "#1A1A1A" : "transparent",
            color: mode === m ? "#FAFAF8" : "#AAA",
            fontWeight: mode === m ? 600 : 400,
            transition:"all 0.15s",
          }}
        >
          {VIEW_MODE_LABELS[m] || m}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subreddit switcher — click the title to open a dropdown of every dataset
// ---------------------------------------------------------------------------
function SubredditSwitcher({ subreddits, activeId, onChange }) {
  const [open, setOpen] = useState(false);
  const active = subreddits.find(s => s.id === activeId);

  return (
    <div style={{ position:"relative", pointerEvents:"auto" }}>
      <h1
        onClick={() => setOpen(o => !o)}
        style={{
          margin:0, fontSize:13, fontWeight:600, color:"#1A1A1A",
          fontFamily:"Inter,sans-serif", letterSpacing:"-0.01em",
          cursor:"pointer", display:"flex", alignItems:"center", gap:5,
          userSelect:"none",
        }}
      >
        {active?.label || "Select subreddit"}
        <span style={{ fontSize:9, color:"#CCC" }}>{open ? "▾" : "▸"}</span>
      </h1>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position:"fixed", inset:0, zIndex:59 }}
          />
          <div style={{
            position:"absolute", top:"calc(100% + 6px)", left:0, zIndex:60,
            background:"#FAFAF8", border:"1px solid #E0DDD8", borderRadius:7,
            boxShadow:"0 4px 16px rgba(0,0,0,0.1)", overflow:"hidden", minWidth:190,
          }}>
            {subreddits.map(s => (
              <div
                key={s.id}
                onClick={() => { onChange(s.id); setOpen(false); }}
                style={{
                  padding:"8px 13px", fontSize:12, cursor:"pointer",
                  fontFamily:"Inter,sans-serif",
                  background: s.id === activeId ? "#F0EEE9" : "transparent",
                  color:"#1A1A1A", fontWeight: s.id === activeId ? 600 : 400,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "#F0EEE9"; }}
                onMouseLeave={e => { e.currentTarget.style.background = s.id === activeId ? "#F0EEE9" : "transparent"; }}
              >
                {s.label}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dump button — exports full threads of whatever's currently highlighted as
// markdown. Two-step: pressing it asks for confirmation (dumps can mean
// fetching thousands of thread files) before actually running.
// ---------------------------------------------------------------------------
function DumpButton({ status, visibleCount, progress, error, onStart, onConfirm, onCancel }) {
  const baseBtnStyle = {
    background:"none", border:"1px solid #E0DDD8",
    borderRadius:6, padding:"5px 12px",
    fontSize:11, color:"#AAA", cursor:"pointer",
    fontFamily:"Inter,sans-serif",
    transition:"border-color 0.15s, color 0.15s",
  };
  const wrapStyle = {
    position:"fixed", top:52, right:28, zIndex:50,
    fontFamily:"Inter,sans-serif",
  };

  if (status === "confirm") {
    return (
      <div style={{
        ...wrapStyle,
        display:"flex", alignItems:"center", gap:6,
        background:"#FAFAF8", border:"1px solid #E0DDD8",
        borderRadius:7, padding:"6px 10px",
        boxShadow:"0 2px 10px rgba(0,0,0,0.05)",
      }}>
        <span style={{ fontSize:11, color:"#2C2C2C" }}>
          Export {visibleCount.toLocaleString()} thread{visibleCount !== 1 ? "s" : ""}?
        </span>
        <button onClick={onConfirm} style={{ ...baseBtnStyle, color:"#1A1A1A", fontWeight:600 }}>Confirm</button>
        <button onClick={onCancel} style={baseBtnStyle}>Cancel</button>
      </div>
    );
  }

  if (status === "running") {
    return (
      <div style={{
        ...wrapStyle,
        background:"#FAFAF8", border:"1px solid #E0DDD8",
        borderRadius:7, padding:"6px 12px",
        boxShadow:"0 2px 10px rgba(0,0,0,0.05)",
        fontSize:11, color:"#AAA",
      }}>
        Fetching threads… {progress.done}/{progress.total}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div style={{
        ...wrapStyle,
        display:"flex", alignItems:"center", gap:6,
        background:"#FAFAF8", border:"1px solid #C4645A",
        borderRadius:7, padding:"6px 10px",
        fontSize:11, color:"#C4645A",
      }}>
        <span>Dump failed: {error}</span>
        <button onClick={onCancel} style={baseBtnStyle}>Dismiss</button>
      </div>
    );
  }

  return (
    <button
      onClick={onStart}
      disabled={visibleCount === 0}
      style={{
        ...wrapStyle, ...baseBtnStyle,
        opacity: visibleCount === 0 ? 0.4 : 1,
        cursor: visibleCount === 0 ? "default" : "pointer",
      }}
      onMouseEnter={e => { if (visibleCount) { e.currentTarget.style.color="#1A1A1A"; e.currentTarget.style.borderColor="#BBB"; } }}
      onMouseLeave={e => { e.currentTarget.style.color="#AAA"; e.currentTarget.style.borderColor="#E0DDD8"; }}
    >
      {status === "done" ? "Downloaded ✓" : `Dump ${visibleCount.toLocaleString()} thread${visibleCount !== 1 ? "s" : ""}`}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function Explorer() {
  const [subredditId, setSubredditId] = useState(SUBREDDITS[0].id);
  const activeSubreddit = useMemo(
    () => SUBREDDITS.find(s => s.id === subredditId) || SUBREDDITS[0],
    [subredditId]
  );

  // Data is fetched at runtime per subreddit, not bundled at build time —
  // switching subreddits is just a re-fetch of a different static JSON path.
  const [rawPosts, setRawPosts]         = useState(null);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsErrorMsg, setPostsErrorMsg] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setPostsLoading(true);
    setPostsErrorMsg(null);
    setRawPosts(null);

    fetch(`${import.meta.env.BASE_URL}${activeSubreddit.dataPath}`)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load ${activeSubreddit.dataPath} (${res.status})`);
        return res.json();
      })
      .then(data => {
        if (cancelled) return;
        setRawPosts(data);
        setPostsLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setPostsErrorMsg(err.message);
        setPostsLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeSubreddit.dataPath]);

  const allPosts = useMemo(() => {
    if (!rawPosts || !rawPosts.length) return [];
    const engs = rawPosts.map(p => p.engagement);
    const eMin = Math.min(...engs);
    const eMax = Math.max(...engs);
    const span = eMax - eMin || 1;
    return rawPosts.map(p => ({
      ...p,
      radius: 2.5 + 7 * (p.engagement - eMin) / span,
    }));
  }, [rawPosts]);

  const [selectedPost, setSelectedPost]         = useState(null);
  const [tooltip, setTooltip]                   = useState(null);
  const [activeCategories, setActiveCategories] = useState(new Set(CATEGORIES));
  const [activePostTypes, setActivePostTypes]   = useState(new Set(POST_TYPES));
  // Unlike activeCategories/activePostTypes (seeded from fixed constants),
  // the emotion bucket set is corpus-dependent (see EMOTION_COLORS' comment
  // above), so it starts empty and is populated by the effect below once
  // the `emotions` memo knows what's actually in the loaded dataset.
  const [activeEmotions, setActiveEmotions]     = useState(new Set());
  const [viewMode, setViewMode]                 = useState(activeSubreddit.viewModes[0]);
  const [searchQuery, setSearchQuery]           = useState("");
  const [searchScope, setSearchScope]           = useState("thread"); // 'post' | 'thread'
  const [matchMode, setMatchMode]               = useState("any"); // 'any' | 'all', for 2+ keywords
  const [scoreSliderPos, setScoreSliderPos]     = useState(0); // 0-100, mapped to a score threshold below
  const [dumpStatus, setDumpStatus]             = useState("idle"); // 'idle' | 'confirm' | 'running' | 'done' | 'error'
  const [dumpProgress, setDumpProgress]         = useState({ done: 0, total: 0 });
  const [dumpError, setDumpError]               = useState(null);

  // Switching datasets resets everything that's dataset-scoped — a search
  // string, filter selection, or open thread from one subreddit isn't
  // meaningful applied to another.
  const changeSubreddit = (id) => {
    const next = SUBREDDITS.find(s => s.id === id);
    if (!next) return;
    setSubredditId(id);
    setViewMode(next.viewModes[0]);
    setActiveCategories(new Set(CATEGORIES));
    setActivePostTypes(new Set(POST_TYPES));
    setActiveEmotions(new Set());
    setSearchQuery("");
    setScoreSliderPos(0);
    setDebouncedSliderPos(0);
    setSelectedPost(null);
    setTooltip(null);
    setDumpStatus("idle");
  };

  // Slider position is mapped through a power curve (not linear) so that
  // most of the slider's range gives fine control over the low/typical
  // scores, since upvote counts are heavily right-skewed.
  const maxScore = useMemo(
    () => (allPosts.length ? Math.max(...allPosts.map(p => p.score)) : 0),
    [allPosts]
  );
  const sliderPosToScore = useCallback((pos) => {
    if (pos <= 0) return 0;
    const t = pos / 100;
    return Math.round(Math.expm1(t * Math.log1p(maxScore)));
  }, [maxScore]);

  // The readout label tracks the raw slider position instantly. The value
  // that actually drives filtering/layout is debounced — dragging the
  // slider re-triggers computeLayout/computeBucketLayout/
  // computeQuarterHistogram (the latter a 200-tick force simulation per
  // quarter), which is too expensive to redo on every intermediate tick.
  const displayMinScore = useMemo(() => sliderPosToScore(scoreSliderPos), [scoreSliderPos, sliderPosToScore]);

  const [debouncedSliderPos, setDebouncedSliderPos] = useState(scoreSliderPos);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSliderPos(scoreSliderPos), 120);
    return () => clearTimeout(id);
  }, [scoreSliderPos]);

  const minScore = useMemo(() => sliderPosToScore(debouncedSliderPos), [debouncedSliderPos, sliderPosToScore]);

  // Base filter applied before anything else — every downstream toggle,
  // search, and layout operates only on posts that clear this bar, so the
  // slider works the same whether or not any other filter is active.
  const posts = useMemo(
    () => allPosts.filter(p => p.score >= minScore),
    [allPosts, minScore]
  );

  const svgRef  = useRef(null);
  const gRef    = useRef(null);
  const zoomRef = useRef(null);

  // Full-corpus counts for the category legend — derived from the loaded
  // dataset rather than hardcoded, so they can never drift out of sync with
  // whatever posts_viz.json currently contains (previously a hand-copied
  // CORPUS_COUNTS constant that silently went stale on every re-export).
  // "Unfiltered" semantics: not affected by the score slider or search.
  const categoryCounts = useMemo(() => {
    const c = {};
    allPosts.forEach(p => { c[p.category] = (c[p.category]||0)+1; });
    return c;
  }, [allPosts]);

  const sortedCats = useMemo(() =>
    [...CATEGORIES].sort((a,b) => (categoryCounts[b]||0) - (categoryCounts[a]||0)),
  [categoryCounts]);

  // Full-corpus counts for the post-type legend, same "unfiltered" semantics
  // as categoryCounts above (not affected by the score slider or search).
  const postTypeCounts = useMemo(() => {
    const c = {};
    allPosts.forEach(p => { c[p.post_type] = (c[p.post_type]||0)+1; });
    return c;
  }, [allPosts]);

  // Full-corpus counts for the emotion legend, same "unfiltered" semantics.
  // Posts with no emotion data (subreddit not yet run through
  // classify_emotion.py) have p.emotion === null and are excluded, not
  // counted under some fake bucket.
  const emotionCounts = useMemo(() => {
    const c = {};
    allPosts.forEach(p => { if (p.emotion) c[p.emotion] = (c[p.emotion]||0)+1; });
    return c;
  }, [allPosts]);

  // Emotion buckets present in this dataset, sorted by descending count.
  // Unlike CATEGORIES (one fixed canonical set), this must be derived live
  // — see EMOTION_COLORS' comment for why the surviving label set is
  // corpus-dependent. Empty for a subreddit with no emotion data yet.
  const emotions = useMemo(
    () => Object.keys(emotionCounts)
      .sort((a,b) => emotionCounts[b] - emotionCounts[a]),
    [emotionCounts]
  );

  // activeEmotions can't be seeded synchronously like activeCategories
  // (new Set(CATEGORIES)) since the bucket list isn't known until
  // `emotions` above has been computed from the loaded dataset.
  useEffect(() => {
    setActiveEmotions(new Set(emotions));
  }, [emotions]);

  // Quarters present in the full (unfiltered) corpus — a stable list, so
  // buckets don't appear/disappear as the score slider moves. "unknown"
  // (missing created_utc) is dropped rather than shown as a fake bucket.
  const quarters = useMemo(() => {
    const set = new Set(allPosts.map(p => p.quarter).filter(q => q && q !== "unknown"));
    return [...set].sort();
  }, [allPosts]);

  // Parse search query into independent keyword-phrases.
  // Accepts either "{burnt out, exhausted, overwhelmed}" or plain
  // "burnt out, exhausted, overwhelmed" — braces are optional.
  // Each comma-separated entry is kept intact as its own phrase (not
  // split further on spaces), so multi-word terms match as whole units.
  const keywords = useMemo(() => {
    let raw = searchQuery.trim();
    if (raw.startsWith("{") && raw.endsWith("}")) {
      raw = raw.slice(1, -1);
    }
    return raw
      .split(",")
      .map(k => k.trim().toLowerCase())
      .filter(Boolean);
  }, [searchQuery]);

  const searching = keywords.length > 0;

  // Set of matching post IDs when searching
  const matchingIds = useMemo(() => {
    if (!searching) return null;
    const ids = new Set();
    posts.forEach(p => { if (matchesSearch(p, keywords, searchScope, matchMode)) ids.add(p.id); });
    return ids;
  }, [posts, keywords, searching, searchScope, matchMode]);

  const matchCount = matchingIds ? matchingIds.size : 0;

  // "Currently highlighted" = whatever's drawn at full/matched opacity right
  // now: passes the score floor, its category/post-type/emotion is toggled
  // on (quarter mode has no primary toggleable group, but the emotion
  // legend still dims by emotion there too, with a pass-through for posts
  // with no emotion data at all, matching the quarter render block), and
  // (if searching) it's in the match set. This is what Dump exports.
  const visiblePosts = useMemo(() => {
    return posts.filter(p => {
      const groupActive =
        viewMode === "category" ? activeCategories.has(p.category) :
        viewMode === "move"     ? activePostTypes.has(p.post_type) :
        viewMode === "emotion"  ? activeEmotions.has(p.emotion) :
        viewMode === "quarter"  ? (!p.emotion || activeEmotions.has(p.emotion)) :
        true;
      if (!groupActive) return false;
      if (searching && !matchingIds.has(p.id)) return false;
      return true;
    });
  }, [posts, viewMode, activeCategories, activePostTypes, activeEmotions, searching, matchingIds]);

  const startDump = () => setDumpStatus("confirm");
  const cancelDump = () => { setDumpStatus("idle"); setDumpError(null); };

  const confirmDump = async () => {
    setDumpStatus("running");
    setDumpProgress({ done: 0, total: visiblePosts.length });
    try {
      const markdown = await buildDumpMarkdown({
        posts: visiblePosts,
        subredditLabel: activeSubreddit.label,
        threadsPath: activeSubreddit.threadsPath,
        viewMode, availableModes: activeSubreddit.viewModes,
        keywords, searchScope, matchMode, minScore,
        activeCategories, activePostTypes, activeEmotions,
        onProgress: (done, total) => setDumpProgress({ done, total }),
      });
      const slug = activeSubreddit.id;
      downloadMarkdown(markdown, `${slug}-dump-${visiblePosts.length}-posts.md`);
      setDumpStatus("done");
      setTimeout(() => setDumpStatus(s => s === "done" ? "idle" : s), 2500);
    } catch (err) {
      setDumpError(err.message);
      setDumpStatus("error");
    }
  };

  const toggleCategory = (cat) => {
    setActiveCategories(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  const togglePostType = (ptype) => {
    setActivePostTypes(prev => {
      const next = new Set(prev);
      next.has(ptype) ? next.delete(ptype) : next.add(ptype);
      return next;
    });
  };

  const toggleEmotion = (emo) => {
    setActiveEmotions(prev => {
      const next = new Set(prev);
      next.has(emo) ? next.delete(emo) : next.add(emo);
      return next;
    });
  };

  const VW = window.innerWidth;
  const VH = window.innerHeight;
  const outerR = Math.min(VW, VH) * 0.44;
  const cx = VW / 2;
  const cy = VH / 2;

  const { clusters, centroids } = useMemo(() => {
    if (viewMode !== "category") return { clusters: {}, centroids: {} };
    return computeLayout(posts, outerR, CATEGORIES, "category");
  }, [posts, outerR, viewMode]);

  const { clusters: emotionClusters, centroids: emotionCentroids } = useMemo(() => {
    if (viewMode !== "emotion") return { clusters: {}, centroids: {} };
    return computeLayout(posts, outerR, emotions, "emotion");
  }, [posts, outerR, viewMode, emotions]);

  // Three fixed-position circles, left-to-right, one per move stage. Sized
  // to fill the viewport since there are always exactly 3.
  const stageR = Math.min(VW / 6, VH * 0.42) * 0.88;
  const stageCenters = useMemo(() => {
    const c = {};
    MOVE_STAGES.forEach((stage, i) => { c[stage] = { x: VW * (i + 0.5) / 3, y: cy }; });
    return c;
  }, [VW, cy]);

  const moveStageClusters = useMemo(() => {
    if (viewMode !== "move") return {};
    return computeBucketLayout(posts, MOVE_STAGES, "move_stage", stageR, "post_type", POST_TYPES);
  }, [posts, stageR, viewMode]);

  // Quarter timeline as a dot-histogram: narrow fixed-width columns (not
  // sized by count, real bars don't get wider with more data, only
  // taller), laid out left to right across a canvas that grows wider as
  // quarter count grows, relying on the existing zoom/pan for navigation.
  // Posts settle onto a shared floor via computeQuarterHistogram's force
  // simulation rather than a circle pack, so column height reads as
  // volume for that quarter.
  const columnWidth = 60;
  const columnGap   = 26;
  const floorY = VH * 0.66;

  const quarterCenters = useMemo(() => {
    const c = {};
    quarters.forEach((q, i) => { c[q] = (i + 0.5) * (columnWidth + columnGap); });
    return c;
  }, [quarters]);

  // computeQuarterHistogram is async (it yields between quarters so the
  // main thread isn't blocked and a progress bar can actually update), so
  // it's driven from an effect + state rather than a plain useMemo.
  // quarterLayoutReqRef guards against a superseded run (slider moved
  // again, or the user left quarter view) clobbering a newer one's result.
  const [quarterLayout, setQuarterLayout]                 = useState({ clusters: {}, counts: {}, topEmotions: {} });
  const [quarterLayoutProgress, setQuarterLayoutProgress] = useState(0);
  const [quarterLayoutBusy, setQuarterLayoutBusy]         = useState(false);
  const quarterLayoutReqRef = useRef(0);

  useEffect(() => {
    if (viewMode !== "quarter") return undefined;

    const reqId = ++quarterLayoutReqRef.current;
    // Delay showing the overlay briefly so a fast recompute (small filtered
    // set, or a dataset with few quarters) doesn't flash it for no reason.
    const showTimer = setTimeout(() => {
      if (quarterLayoutReqRef.current === reqId) setQuarterLayoutBusy(true);
    }, 150);
    setQuarterLayoutProgress(0);

    computeQuarterHistogram(
      posts, quarters, quarterCenters, columnWidth, floorY,
      (p) => { if (quarterLayoutReqRef.current === reqId) setQuarterLayoutProgress(p); },
      () => quarterLayoutReqRef.current !== reqId,
    ).then(result => {
      if (quarterLayoutReqRef.current !== reqId || !result) return;
      clearTimeout(showTimer);
      setQuarterLayout(result);
      setQuarterLayoutBusy(false);
    });

    return () => {
      clearTimeout(showTimer);
      quarterLayoutReqRef.current++; // invalidate this run's in-flight computation
    };
  }, [viewMode, posts, quarters, quarterCenters, floorY]);

  const quarterClusters    = quarterLayout.clusters;
  const quarterCounts      = quarterLayout.counts;
  const quarterTopEmotions = quarterLayout.topEmotions;

  // ---------------------------------------------------------------------------
  // D3 zoom — scaleExtent goes wider than [0.4,10] on the low end so a
  // many-quarter timeline can still be zoomed out to fit entirely.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;
    const svg = d3.select(svgRef.current);
    const g   = d3.select(gRef.current);
    const zoom = d3.zoom()
      .scaleExtent([0.05, 10])
      .on("zoom", (event) => { g.attr("transform", event.transform); });
    svg.call(zoom);
    zoomRef.current = zoom;
    return () => svg.on(".zoom", null);
  }, []);

  const zoomToBounds = useCallback((x0, x1, y0, y1, padding = 30) => {
    if (!svgRef.current || !zoomRef.current) return;
    x0 -= padding; x1 += padding; y0 -= padding; y1 += padding;
    const scale = Math.min(10, Math.max(0.05, 0.88 / Math.max((x1-x0)/VW, (y1-y0)/VH)));
    const tx = VW/2 - scale*(x0+x1)/2;
    const ty = VH/2 - scale*(y0+y1)/2;
    d3.select(svgRef.current).transition().duration(600)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx,ty).scale(scale));
  }, [VW, VH]);

  const zoomToPoint = useCallback((centerX, centerY, radius, padding = 30) => {
    zoomToBounds(centerX - radius, centerX + radius, centerY - radius, centerY + radius, padding);
  }, [zoomToBounds]);

  const zoomToCategory = useCallback((cat) => {
    const catCircles = clusters[cat];
    if (!catCircles?.length) return;
    const xs = catCircles.map(c => cx + c.x);
    const ys = catCircles.map(c => cy + c.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    zoomToPoint((x0+x1)/2, (y0+y1)/2, Math.max(x1-x0, y1-y0)/2, 50);
  }, [clusters, cx, cy, zoomToPoint]);

  const zoomToEmotion = useCallback((emo) => {
    const emoCircles = emotionClusters[emo];
    if (!emoCircles?.length) return;
    const xs = emoCircles.map(c => cx + c.x);
    const ys = emoCircles.map(c => cy + c.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    zoomToPoint((x0+x1)/2, (y0+y1)/2, Math.max(x1-x0, y1-y0)/2, 50);
  }, [emotionClusters, cx, cy, zoomToPoint]);

  const zoomToStage = useCallback((stage) => {
    const center = stageCenters[stage];
    if (!center) return;
    zoomToPoint(center.x, center.y, stageR);
  }, [stageCenters, stageR, zoomToPoint]);

  // Quarter columns are tall and narrow, not square, so these use the
  // actual stack extents (from the settled circle positions) rather than
  // a fixed radius around a center point the way category/move-stage do.
  const zoomToQuarter = useCallback((q) => {
    const cx0 = quarterCenters[q];
    if (cx0 === undefined) return;
    const circles = quarterClusters[q] || [];
    const halfWidth = columnWidth / 2;
    const top = circles.length ? Math.min(...circles.map(c => c.y - c.r)) : floorY - 20;
    zoomToBounds(cx0 - halfWidth, cx0 + halfWidth, top, floorY, 30);
  }, [quarterCenters, quarterClusters, floorY, zoomToBounds]);

  const zoomToFitQuarters = useCallback(() => {
    if (!quarters.length) return;
    const halfWidth = columnWidth / 2;
    const xs = quarters.map(q => quarterCenters[q]);
    let top = floorY;
    quarters.forEach(q => {
      (quarterClusters[q] || []).forEach(c => { top = Math.min(top, c.y - c.r); });
    });
    zoomToBounds(Math.min(...xs) - halfWidth, Math.max(...xs) + halfWidth, top, floorY, 40);
  }, [quarters, quarterCenters, quarterClusters, floorY, zoomToBounds]);

  const resetZoom = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(400)
      .call(zoomRef.current.transform, d3.zoomIdentity);
  }, []);

  // Different view modes (and different subreddits) use unrelated
  // coordinate layouts — carrying a zoom transform over from one to
  // another would land on an empty area. Quarter mode fits the whole
  // timeline instead of a hard reset, since a many-quarter dataset at
  // zoomIdentity would only show its leftmost slice. Refs hold the latest
  // callbacks without making them effect dependencies, so this only fires
  // on an actual mode/dataset switch, not on every data recompute (e.g.
  // moving the score slider recomputes quarterCenters too).
  const zoomToFitQuartersRef = useRef(zoomToFitQuarters);
  zoomToFitQuartersRef.current = zoomToFitQuarters;
  const resetZoomRef = useRef(resetZoom);
  resetZoomRef.current = resetZoom;

  useEffect(() => {
    if (viewMode === "quarter") {
      zoomToFitQuartersRef.current();
    } else {
      resetZoomRef.current();
    }
  }, [viewMode, subredditId]);

  // ---------------------------------------------------------------------------
  // Circle appearance helpers — isActive is whatever group (category or
  // post type) this circle belongs to, resolved by the caller
  // ---------------------------------------------------------------------------
  function getCircleOpacity(isActive, postId) {
    if (!isActive)  return { fill: 0.08, stroke: 0 };
    if (!searching) return { fill: 0.7,  stroke: 0.3 };
    const matches = matchingIds.has(postId);
    return matches
      ? { fill: 0.88, stroke: 0.6 }
      : { fill: 0.06, stroke: 0 };
  }

  const showViewModeToggle = activeSubreddit.viewModes.length > 1;
  const showLegend = viewMode === "category" || viewMode === "move" || viewMode === "emotion";
  const showCovidLegend = viewMode === "quarter";

  return (
    <div style={{ width:"100vw", height:"100vh", background:"#F7F6F3", overflow:"hidden", position:"relative" }}>

      {/* Header */}
      <div style={{
        position:"fixed", top:0, left:0, right:0,
        padding:"16px 28px", display:"flex", alignItems:"baseline", gap:12,
        zIndex:50, pointerEvents:"none",
      }}>
        <SubredditSwitcher subreddits={SUBREDDITS} activeId={subredditId} onChange={changeSubreddit} />
        <span style={{ fontSize:11, color:"#CCC", fontFamily:"Inter,sans-serif" }}>
          {postsLoading ? "Loading…" : `${posts.length.toLocaleString()} posts · circle size = engagement`}
        </span>
      </div>

      {postsErrorMsg && (
        <div style={{
          position:"fixed", top:"50%", left:"50%", transform:"translate(-50%,-50%)",
          fontFamily:"Inter,sans-serif", fontSize:13, color:"#C4645A",
          background:"#FAFAF8", border:"1px solid #E0DDD8", borderRadius:8,
          padding:"14px 18px", zIndex:80,
        }}>
          Couldn't load {activeSubreddit.label}: {postsErrorMsg}
        </div>
      )}

      {viewMode === "quarter" && quarterLayoutBusy && (
        <SimulationLoadingOverlay progress={quarterLayoutProgress} />
      )}

      {/* Search bar — centered at top */}
      <SearchBar
        value={searchQuery}
        onChange={setSearchQuery}
        matchCount={matchCount}
        searching={searching}
        scope={searchScope}
        onScopeChange={setSearchScope}
        matchMode={matchMode}
        onMatchModeChange={setMatchMode}
        multiKeyword={keywords.length > 1}
      />

      {/* Reset view button */}
      <button
        onClick={() => (viewMode === "quarter" ? zoomToFitQuarters() : resetZoom())}
        style={{
          position:"fixed", top:16, right:28,
          background:"none", border:"1px solid #E0DDD8",
          borderRadius:6, padding:"5px 12px",
          fontSize:11, color:"#AAA", cursor:"pointer",
          fontFamily:"Inter,sans-serif", zIndex:50,
          transition:"border-color 0.15s, color 0.15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.color="#1A1A1A"; e.currentTarget.style.borderColor="#BBB"; }}
        onMouseLeave={e => { e.currentTarget.style.color="#AAA"; e.currentTarget.style.borderColor="#E0DDD8"; }}
      >
        Reset view
      </button>

      {/* Dump button — exports full threads of currently highlighted posts */}
      <DumpButton
        status={dumpStatus}
        visibleCount={visiblePosts.length}
        progress={dumpProgress}
        error={dumpError}
        onStart={startDump}
        onConfirm={confirmDump}
        onCancel={cancelDump}
      />

      {/* SVG map */}
      <svg
        ref={svgRef}
        width={VW} height={VH}
        style={{ display:"block", cursor:"grab" }}
        onClick={e => { if (e.target.tagName === "svg") setSelectedPost(null); }}
      >
        <g ref={gRef}>
          {viewMode === "category" && (
            <>
              {/* Outer boundary circle */}
              <circle cx={cx} cy={cy} r={outerR} fill="none" stroke="#E0DDD8" strokeWidth={1}/>

              {/* Category clusters */}
              {CATEGORIES.map(cat => {
                const color    = CATEGORY_COLORS[cat] || CATEGORY_COLORS.other;
                const circles  = clusters[cat] || [];
                const centroid = centroids[cat];
                const catActive = activeCategories.has(cat);
                if (!circles.length) return null;

                return (
                  <g key={cat} transform={`translate(${cx}, ${cy})`}>
                    {/* Invisible click target for "zoom to category," painted
                        before the circles so any circle overlapping it wins
                        the hit-test (circle click priority); this element
                        only catches clicks that land in gaps between posts. */}
                    {centroid && (
                      <text
                        x={centroid.x} y={centroid.y}
                        textAnchor="middle" dominantBaseline="central"
                        fill="transparent"
                        fontSize={9} fontWeight={600} letterSpacing="0.1em"
                        pointerEvents="all"
                        style={{ cursor:"zoom-in" }}
                        onClick={e => { e.stopPropagation(); zoomToCategory(cat); }}
                      >
                        {CATEGORY_LABELS[cat].toUpperCase()}
                      </text>
                    )}

                    {circles.map((c, i) => {
                      const { fill, stroke } = getCircleOpacity(catActive, c.post.id);
                      const isMatch = searching && matchingIds.has(c.post.id) && catActive;

                      return (
                        <g key={i}>
                          <circle
                            cx={c.x} cy={c.y} r={c.r}
                            fill={color} fillOpacity={fill}
                            stroke={color} strokeWidth={0.5} strokeOpacity={stroke}
                            style={{ cursor: catActive ? "pointer" : "default" }}
                            onMouseEnter={e => {
                              if (!catActive) return;
                              e.target.setAttribute("fill-opacity", "0.95");
                              setTooltip({ post: c.post, x: e.clientX, y: e.clientY });
                            }}
                            onMouseMove={e => setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                            onMouseLeave={e => {
                              e.target.setAttribute("fill-opacity", String(fill));
                              setTooltip(null);
                            }}
                            onClick={e => {
                              if (!catActive) return;
                              e.stopPropagation();
                              setSelectedPost(c.post);
                              setTooltip(null);
                            }}
                          />
                          {/* Match ring */}
                          {isMatch && (
                            <circle
                              cx={c.x} cy={c.y} r={c.r + 1.5}
                              fill="none"
                              stroke={color} strokeWidth={1.5} strokeOpacity={0.9}
                              pointerEvents="none"
                            />
                          )}
                        </g>
                      );
                    })}

                    {/* Category label — visually on top (legible over the
                        circles), but pointer-events none so it never
                        intercepts clicks; the invisible copy above it in
                        paint order handles zoom-to-category clicks. */}
                    {centroid && (
                      <text
                        x={centroid.x} y={centroid.y}
                        textAnchor="middle" dominantBaseline="central"
                        fill="#000000"
                        fillOpacity={catActive ? 0.8 : 0.1}
                        fontSize={9} fontFamily="Inter,sans-serif"
                        fontWeight={600} letterSpacing="0.1em"
                        pointerEvents="none"
                      >
                        {CATEGORY_LABELS[cat].toUpperCase()}
                      </text>
                    )}
                  </g>
                );
              })}
            </>
          )}

          {viewMode === "emotion" && (
            <>
              {/* Outer boundary circle */}
              <circle cx={cx} cy={cy} r={outerR} fill="none" stroke="#E0DDD8" strokeWidth={1}/>

              {/* Emotion clusters — bucket list is corpus-derived (see
                  EMOTION_COLORS' comment), not a fixed constant like
                  CATEGORIES, so iterate `emotions` rather than a static list. */}
              {emotions.map(emo => {
                const color     = EMOTION_COLORS[emo] || EMOTION_COLORS.neutral;
                const circles   = emotionClusters[emo] || [];
                const centroid  = emotionCentroids[emo];
                const emoActive = activeEmotions.has(emo);
                if (!circles.length) return null;

                return (
                  <g key={emo} transform={`translate(${cx}, ${cy})`}>
                    {/* Invisible click target for "zoom to emotion," painted
                        before the circles so any circle overlapping it wins
                        the hit-test (circle click priority); this element
                        only catches clicks that land in gaps between posts. */}
                    {centroid && (
                      <text
                        x={centroid.x} y={centroid.y}
                        textAnchor="middle" dominantBaseline="central"
                        fill="transparent"
                        fontSize={9} fontWeight={600} letterSpacing="0.1em"
                        pointerEvents="all"
                        style={{ cursor:"zoom-in" }}
                        onClick={e => { e.stopPropagation(); zoomToEmotion(emo); }}
                      >
                        {(EMOTION_LABELS[emo] || emo).toUpperCase()}
                      </text>
                    )}

                    {circles.map((c, i) => {
                      const { fill, stroke } = getCircleOpacity(emoActive, c.post.id);
                      const isMatch = searching && matchingIds.has(c.post.id) && emoActive;

                      return (
                        <g key={i}>
                          <circle
                            cx={c.x} cy={c.y} r={c.r}
                            fill={color} fillOpacity={fill}
                            stroke={color} strokeWidth={0.5} strokeOpacity={stroke}
                            style={{ cursor: emoActive ? "pointer" : "default" }}
                            onMouseEnter={e => {
                              if (!emoActive) return;
                              e.target.setAttribute("fill-opacity", "0.95");
                              setTooltip({ post: c.post, x: e.clientX, y: e.clientY });
                            }}
                            onMouseMove={e => setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                            onMouseLeave={e => {
                              e.target.setAttribute("fill-opacity", String(fill));
                              setTooltip(null);
                            }}
                            onClick={e => {
                              if (!emoActive) return;
                              e.stopPropagation();
                              setSelectedPost(c.post);
                              setTooltip(null);
                            }}
                          />
                          {/* Match ring */}
                          {isMatch && (
                            <circle
                              cx={c.x} cy={c.y} r={c.r + 1.5}
                              fill="none"
                              stroke={color} strokeWidth={1.5} strokeOpacity={0.9}
                              pointerEvents="none"
                            />
                          )}
                        </g>
                      );
                    })}

                    {/* Emotion label — visually on top (legible over the
                        circles), but pointer-events none so it never
                        intercepts clicks; the invisible copy above it in
                        paint order handles zoom-to-emotion clicks. */}
                    {centroid && (
                      <text
                        x={centroid.x} y={centroid.y}
                        textAnchor="middle" dominantBaseline="central"
                        fill="#000000"
                        fillOpacity={emoActive ? 0.8 : 0.1}
                        fontSize={9} fontFamily="Inter,sans-serif"
                        fontWeight={600} letterSpacing="0.1em"
                        pointerEvents="none"
                      >
                        {(EMOTION_LABELS[emo] || emo).toUpperCase()}
                      </text>
                    )}
                  </g>
                );
              })}
            </>
          )}

          {viewMode === "move" && (
            <>
              {/* Move-stage clusters: pre (left), ambiguous (center), post (right) */}
              {MOVE_STAGES.map(stage => {
                const center  = stageCenters[stage];
                const circles = moveStageClusters[stage] || [];

                return (
                  <g key={stage}>
                    <circle cx={center.x} cy={center.y} r={stageR} fill="none" stroke="#E0DDD8" strokeWidth={1}/>

                    <g transform={`translate(${center.x}, ${center.y})`}>
                      {circles.map((c, i) => {
                        const ptype    = c.post.post_type;
                        const color    = POST_TYPE_COLORS[ptype] || POST_TYPE_COLORS.other;
                        const ptActive = activePostTypes.has(ptype);
                        const { fill, stroke } = getCircleOpacity(ptActive, c.post.id);
                        const isMatch = searching && matchingIds.has(c.post.id) && ptActive;

                        return (
                          <g key={i}>
                            <circle
                              cx={c.x} cy={c.y} r={c.r}
                              fill={color} fillOpacity={fill}
                              stroke={color} strokeWidth={0.5} strokeOpacity={stroke}
                              style={{ cursor: ptActive ? "pointer" : "default" }}
                              onMouseEnter={e => {
                                if (!ptActive) return;
                                e.target.setAttribute("fill-opacity", "0.95");
                                setTooltip({ post: c.post, x: e.clientX, y: e.clientY });
                              }}
                              onMouseMove={e => setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                              onMouseLeave={e => {
                                e.target.setAttribute("fill-opacity", String(fill));
                                setTooltip(null);
                              }}
                              onClick={e => {
                                if (!ptActive) return;
                                e.stopPropagation();
                                setSelectedPost(c.post);
                                setTooltip(null);
                              }}
                            />
                            {/* Match ring */}
                            {isMatch && (
                              <circle
                                cx={c.x} cy={c.y} r={c.r + 1.5}
                                fill="none"
                                stroke={color} strokeWidth={1.5} strokeOpacity={0.9}
                                pointerEvents="none"
                              />
                            )}
                          </g>
                        );
                      })}
                    </g>

                    {/* Stage label */}
                    <text
                      x={center.x} y={center.y - stageR - 14}
                      textAnchor="middle" dominantBaseline="central"
                      fill="#000000" fillOpacity={0.8}
                      fontSize={9} fontFamily="Inter,sans-serif"
                      fontWeight={600} letterSpacing="0.1em"
                      pointerEvents="all"
                      style={{ cursor:"zoom-in" }}
                      onClick={e => { e.stopPropagation(); zoomToStage(stage); }}
                    >
                      {MOVE_STAGE_LABELS[stage].toUpperCase()}
                    </text>
                  </g>
                );
              })}
            </>
          )}

          {viewMode === "quarter" && (
            <>
              {/* Time histogram: a shared baseline is the only fixed
                  geometry — each quarter's "bar" is just its posts
                  settled into a column above it, no drawn rectangle. */}
              {quarters.length > 0 && (
                <line
                  x1={quarterCenters[quarters[0]] - columnWidth}
                  x2={quarterCenters[quarters[quarters.length - 1]] + columnWidth}
                  y1={floorY} y2={floorY}
                  stroke="#E0DDD8" strokeWidth={1}
                />
              )}

              {quarters.map(q => {
                const qcx     = quarterCenters[q];
                const circles = quarterClusters[q] || [];
                const top     = circles.length ? Math.min(...circles.map(c => c.y - c.r)) : floorY;

                return (
                  <g key={q}>
                    {circles.map((c, i) => {
                      // Posts with no emotion data always show at full
                      // opacity: the emotion legend's filter only applies
                      // to posts it actually has an opinion about.
                      const postEmotion = c.post.emotion;
                      const emoActive = !postEmotion || activeEmotions.has(postEmotion);
                      const { fill, stroke } = getCircleOpacity(emoActive, c.post.id);
                      const isMatch = searching && matchingIds.has(c.post.id) && emoActive;
                      const color = quarterPostColor(c.post);

                      return (
                        <g key={i}>
                          <circle
                            cx={c.x} cy={c.y} r={c.r}
                            fill={color} fillOpacity={fill}
                            stroke={color} strokeWidth={0.5} strokeOpacity={stroke}
                            style={{ cursor: emoActive ? "pointer" : "default" }}
                            onMouseEnter={e => {
                              if (!emoActive) return;
                              e.target.setAttribute("fill-opacity", "0.95");
                              setTooltip({ post: c.post, x: e.clientX, y: e.clientY });
                            }}
                            onMouseMove={e => setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                            onMouseLeave={e => {
                              e.target.setAttribute("fill-opacity", String(fill));
                              setTooltip(null);
                            }}
                            onClick={e => {
                              if (!emoActive) return;
                              e.stopPropagation();
                              setSelectedPost(c.post);
                              setTooltip(null);
                            }}
                          />
                          {/* Match ring */}
                          {isMatch && (
                            <circle
                              cx={c.x} cy={c.y} r={c.r + 1.5}
                              fill="none"
                              stroke={color} strokeWidth={1.5} strokeOpacity={0.9}
                              pointerEvents="none"
                            />
                          )}
                        </g>
                      );
                    })}

                    {/* Top-2-emotion tags — plain black text, "Name XX%",
                        most dominant closest to the quarter label. Renders
                        nothing if this subreddit has no emotion data yet
                        (topEmotions[q] is simply empty in that case, not a
                        fake entry). */}
                    {(quarterTopEmotions[q] || []).map((e, i) => (
                      <text
                        key={e.emotion}
                        x={qcx} y={top - 24 - i * 10}
                        textAnchor="middle" dominantBaseline="central"
                        fill="#000000" fillOpacity={0.55}
                        fontSize={8} fontFamily="Inter,sans-serif"
                        fontWeight={500}
                      >
                        {`${EMOTION_LABELS[e.emotion] || e.emotion} ${Math.round(e.pct * 100)}%`}
                      </text>
                    ))}

                    {/* Quarter label + post count */}
                    <text
                      x={qcx} y={top - 14}
                      textAnchor="middle" dominantBaseline="central"
                      fill="#000000" fillOpacity={0.8}
                      fontSize={9} fontFamily="Inter,sans-serif"
                      fontWeight={600} letterSpacing="0.05em"
                      pointerEvents="all"
                      style={{ cursor:"zoom-in" }}
                      onClick={e => { e.stopPropagation(); zoomToQuarter(q); }}
                    >
                      {q} · {(quarterCounts[q] || 0).toLocaleString()}
                    </text>
                  </g>
                );
              })}
            </>
          )}
        </g>
      </svg>

      {/* Bottom-left stack: the view mode toggle sits on top of whatever
          legend-like panel is showing below it (column layout, toggle
          first in DOM order), so it never has to guess a fixed pixel
          offset that only works for one panel's height. Quarter mode has
          no toggleable group of its own, so it gets the covid-coloring
          explainer plus the Emotions legend (the quarter bars already
          surface top emotions per bar, so the full legend belongs here
          too) instead of leaving that slot empty. */}
      <div style={{
        position:"fixed", bottom:24, left:24, zIndex:50,
        display:"flex", flexDirection:"column", gap:8, alignItems:"flex-start",
      }}>
        {showViewModeToggle && (
          <ViewModeToggle mode={viewMode} modes={activeSubreddit.viewModes} onChange={setViewMode} />
        )}

        {showLegend && (viewMode === "category" ? (
          <Legend
            title="Categories"
            items={sortedCats.map(cat => ({
              key: cat, label: CATEGORY_LABELS[cat], color: CATEGORY_COLORS[cat], count: categoryCounts[cat],
            }))}
            activeKeys={activeCategories}
            onToggle={toggleCategory}
          />
        ) : viewMode === "emotion" ? (
          <Legend
            title="Emotions"
            items={emotions.map(emo => ({
              key: emo, label: EMOTION_LABELS[emo] || emo, color: EMOTION_COLORS[emo] || EMOTION_COLORS.neutral, count: emotionCounts[emo],
            }))}
            activeKeys={activeEmotions}
            onToggle={toggleEmotion}
          />
        ) : (
          <Legend
            title="Post Type"
            items={POST_TYPES.map(pt => ({
              key: pt, label: POST_TYPE_LABELS[pt], color: POST_TYPE_COLORS[pt], count: postTypeCounts[pt],
            }))}
            activeKeys={activePostTypes}
            onToggle={togglePostType}
          />
        ))}

        {showCovidLegend && (
          <>
            <CovidLegend />
            {emotions.length > 0 && (
              <Legend
                title="Emotions"
                items={emotions.map(emo => ({
                  key: emo, label: EMOTION_LABELS[emo] || emo, color: EMOTION_COLORS[emo] || EMOTION_COLORS.neutral, count: emotionCounts[emo],
                }))}
                activeKeys={activeEmotions}
                onToggle={toggleEmotion}
              />
            )}
          </>
        )}
      </div>

      {/* Score slider */}
      <ScoreSlider
        sliderPos={scoreSliderPos}
        onChange={setScoreSliderPos}
        minScore={displayMinScore}
        visibleCount={posts.length}
        totalCount={allPosts.length}
      />

      {/* Tooltip */}
      {tooltip && (
        <Tooltip
          post={tooltip.post} x={tooltip.x} y={tooltip.y}
          hasCategoryData={activeSubreddit.viewModes.includes("category")}
        />
      )}

      {/* Thread panel — passes keywords for highlighting */}
      {selectedPost && (
        <ThreadPanel
          post={selectedPost}
          threadsPath={activeSubreddit.threadsPath}
          keywords={keywords}
          onClose={() => setSelectedPost(null)}
        />
      )}
    </div>
  );
}
