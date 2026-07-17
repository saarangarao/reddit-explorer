import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import * as d3 from "d3";

import postsData from "./posts_viz.json";

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

const CORPUS_COUNTS = {
  career:1195, finances:1155, logistics:332, relationships:221,
  culture:211, other:151, legal:141, housing:123,
  education:103, healthcare:88, family:83,
};

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
// Pack layout — static, computed once
// ---------------------------------------------------------------------------
function computeLayout(posts, outerR) {
  const byCategory = {};
  CATEGORIES.forEach(cat => { byCategory[cat] = []; });
  posts.forEach(p => { if (byCategory[p.category]) byCategory[p.category].push(p); });

  // d3.hierarchy() treats a node whose children accessor returns an empty
  // array as a childless leaf (it never assigns `.children`), not as a
  // pruned branch — so a category with 0 posts left after filtering must be
  // left out of the tree entirely, or its "leaf" gets misread as a post.
  const root = {
    children: CATEGORIES
      .filter(cat => byCategory[cat].length > 0)
      .map(cat => ({
        cat,
        children: byCategory[cat].map(p => ({ post: p, r: p.radius, value: p.radius * p.radius })),
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
  CATEGORIES.forEach(cat => { clusters[cat] = []; });

  hierarchy.leaves().forEach(leaf => {
    const cat = leaf.parent.data.cat;
    clusters[cat].push({
      x: leaf.x - offsetX,
      y: leaf.y - offsetY,
      r: leaf.r,
      post: leaf.data.post,
    });
  });

  const centroids = {};
  Object.entries(clusters).forEach(([cat, circles]) => {
    if (!circles.length) return;
    centroids[cat] = {
      x: circles.reduce((s, c) => s + c.x, 0) / circles.length,
      y: circles.reduce((s, c) => s + c.y, 0) / circles.length,
    };
  });

  return { clusters, centroids };
}

// ---------------------------------------------------------------------------
// Pack layout for the move-stage view — three independent packs (one per
// stage), each confined to its own fixed-radius circle, rather than one
// shared pack. That's what gives pre/ambiguous/post their fixed left-to-
// right ordering, instead of leaving placement up to the pack algorithm.
//
// Within a stage, posts are nested one level deeper by post_type first —
// same two-level hierarchy trick computeLayout() uses for categories — so
// same-type posts pack next to each other instead of being scattered
// throughout the stage circle by size alone.
// ---------------------------------------------------------------------------
function computeMoveStageLayout(posts, stageR) {
  const byStage = {};
  MOVE_STAGES.forEach(s => { byStage[s] = []; });
  posts.forEach(p => { if (byStage[p.move_stage]) byStage[p.move_stage].push(p); });

  const clusters = {};
  MOVE_STAGES.forEach(stage => {
    const stagePosts = byStage[stage];
    if (!stagePosts.length) { clusters[stage] = []; return; }

    const byType = {};
    POST_TYPES.forEach(pt => { byType[pt] = []; });
    stagePosts.forEach(p => { if (byType[p.post_type]) byType[p.post_type].push(p); });

    // Same empty-children pitfall as computeLayout(): a post_type with 0
    // posts in this stage must be left out of the tree entirely, or
    // d3.hierarchy() misreads its childless node as a post leaf.
    const root = {
      children: POST_TYPES
        .filter(pt => byType[pt].length > 0)
        .map(pt => ({
          ptype: pt,
          children: byType[pt].map(p => ({ post: p, r: p.radius, value: p.radius * p.radius })),
        })),
    };

    const pack = d3.pack().size([stageR * 2, stageR * 2]).padding(1.5);
    const hierarchy = d3.hierarchy(root)
      .sum(d => d.value || 0)
      .sort((a, b) => b.value - a.value);
    pack(hierarchy);

    clusters[stage] = hierarchy.leaves().map(leaf => ({
      x: leaf.x - stageR,
      y: leaf.y - stageR,
      r: leaf.r,
      post: leaf.data.post,
    }));
  });

  return clusters;
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
// In-memory cache so re-opening an already-viewed thread doesn't re-fetch
// ---------------------------------------------------------------------------
const threadCache = new Map();

async function fetchThreadData(postId) {
  if (threadCache.has(postId)) return threadCache.get(postId);
  const res = await fetch(`${import.meta.env.BASE_URL}threads/${postId}.json`);
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
  lines.push(`- **Category:** ${CATEGORY_LABELS[post.category] || post.category}  |  **Move stage:** ${MOVE_STAGE_LABELS[post.move_stage] || post.move_stage}  |  **Post type:** ${POST_TYPE_LABELS[post.post_type] || post.post_type}`);
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

function renderDumpHeader({ posts, viewMode, keywords, searchScope, matchMode, minScore, activeCategories, activePostTypes }) {
  const lines = [];
  lines.push(`# r/returnToIndia — Thread Dump`);
  lines.push("");
  lines.push(`- **Posts included:** ${posts.length.toLocaleString()}`);
  lines.push(`- **Ordered by:** score (descending)`);
  lines.push(`- **Classification view:** ${viewMode === "category" ? "By Category" : "By Move Stage"}`);

  lines.push(keywords.length
    ? `- **Keyword search:** {${keywords.join(", ")}} — match ${matchMode.toUpperCase()}, scope: ${searchScope === "post" ? "Post Only" : "Full Thread"}`
    : `- **Keyword search:** none`);
  lines.push(`- **Min upvotes:** ${minScore.toLocaleString()}+`);

  if (viewMode === "category") {
    const active = CATEGORIES.filter(c => activeCategories.has(c));
    lines.push(`- **Active categories:** ${active.length === CATEGORIES.length ? "all" : active.map(c => CATEGORY_LABELS[c]).join(", ") || "none"}`);
  } else {
    const active = POST_TYPES.filter(t => activePostTypes.has(t));
    lines.push(`- **Active post types:** ${active.length === POST_TYPES.length ? "all" : active.map(t => POST_TYPE_LABELS[t]).join(", ") || "none"}`);
  }

  const catCounts = {}, stageCounts = {}, typeCounts = {};
  posts.forEach(p => {
    catCounts[p.category]     = (catCounts[p.category]||0) + 1;
    stageCounts[p.move_stage] = (stageCounts[p.move_stage]||0) + 1;
    typeCounts[p.post_type]   = (typeCounts[p.post_type]||0) + 1;
  });

  lines.push("");
  lines.push(`**Category breakdown:** ` + Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${CATEGORY_LABELS[k] || k}: ${v}`)
    .join(", "));
  lines.push(`**Move-stage breakdown:** ` + MOVE_STAGES.map(s => `${MOVE_STAGE_LABELS[s]}: ${stageCounts[s]||0}`).join(", "));
  lines.push(`**Post-type breakdown:** ` + POST_TYPES.map(t => `${POST_TYPE_LABELS[t]}: ${typeCounts[t]||0}`).join(", "));
  lines.push("");
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

async function buildDumpMarkdown({ posts, viewMode, keywords, searchScope, matchMode, minScore, activeCategories, activePostTypes, onProgress }) {
  const sorted = [...posts].sort((a, b) => b.score - a.score);
  const header = renderDumpHeader({ posts: sorted, viewMode, keywords, searchScope, matchMode, minScore, activeCategories, activePostTypes });

  let done = 0;
  const total = sorted.length;
  onProgress?.(0, total);

  const threadDataList = await mapWithConcurrency(sorted, 10, async (post) => {
    const data = await fetchThreadData(post.id);
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
function ThreadPanel({ post, keywords, onClose }) {
  const [threadData, setThreadData] = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const color = CATEGORY_COLORS[post.category] || CATEGORY_COLORS.other;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setThreadData(null);

    fetchThreadData(post.id)
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
  }, [post.id]);

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
function Tooltip({ post, x, y }) {
  const color = CATEGORY_COLORS[post.category] || CATEGORY_COLORS.other;
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
      <span style={{ fontSize:9, fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase", color, display:"block", marginBottom:4 }}>
        {CATEGORY_LABELS[post.category] || post.category}
      </span>
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
      position:"fixed", bottom:24, left:24,
      background:"#FAFAF8", border:"1px solid #E0DDD8",
      borderRadius:8, padding:"12px 14px",
      fontFamily:"Inter,sans-serif", zIndex:50,
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
          <p style={{ margin:"9px 0 0", fontSize:15, color:"#000000", lineHeight:1.4 }}>Click to filter</p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// View mode toggle — switches between the category clustering and the
// move-stage/post-type clustering
// ---------------------------------------------------------------------------
function ViewModeToggle({ mode, onChange }) {
  return (
    <div style={{
      position:"fixed", top:46, left:28,
      display:"flex", background:"#FAFAF8", border:"1px solid #E0DDD8",
      borderRadius:7, overflow:"hidden",
      boxShadow:"0 2px 10px rgba(0,0,0,0.05)",
      fontFamily:"Inter,sans-serif", zIndex:50,
    }}>
      {[["category", "By Category"], ["move", "By Move Stage"]].map(([m, label]) => (
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
          {label}
        </button>
      ))}
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
  const allPosts = useMemo(() => {
    const engs = postsData.map(p => p.engagement);
    const eMin = Math.min(...engs);
    const eMax = Math.max(...engs);
    const span = eMax - eMin || 1;
    return postsData.map(p => ({
      ...p,
      radius: 2.5 + 7 * (p.engagement - eMin) / span,
    }));
  }, []);

  const [selectedPost, setSelectedPost]         = useState(null);
  const [tooltip, setTooltip]                   = useState(null);
  const [activeCategories, setActiveCategories] = useState(new Set(CATEGORIES));
  const [activePostTypes, setActivePostTypes]   = useState(new Set(POST_TYPES));
  const [viewMode, setViewMode]                 = useState("category"); // 'category' | 'move'
  const [searchQuery, setSearchQuery]           = useState("");
  const [searchScope, setSearchScope]           = useState("thread"); // 'post' | 'thread'
  const [matchMode, setMatchMode]               = useState("any"); // 'any' | 'all', for 2+ keywords
  const [scoreSliderPos, setScoreSliderPos]     = useState(0); // 0-100, mapped to a score threshold below
  const [dumpStatus, setDumpStatus]             = useState("idle"); // 'idle' | 'confirm' | 'running' | 'done' | 'error'
  const [dumpProgress, setDumpProgress]         = useState({ done: 0, total: 0 });
  const [dumpError, setDumpError]               = useState(null);

  // Slider position is mapped through a power curve (not linear) so that
  // most of the slider's range gives fine control over the low/typical
  // scores, since upvote counts are heavily right-skewed.
  const maxScore = useMemo(() => Math.max(...allPosts.map(p => p.score)), [allPosts]);
  const minScore = useMemo(() => {
    if (scoreSliderPos <= 0) return 0;
    const t = scoreSliderPos / 100;
    return Math.round(Math.expm1(t * Math.log1p(maxScore)));
  }, [scoreSliderPos, maxScore]);

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

  const counts = useMemo(() => {
    const c = {};
    posts.forEach(p => { c[p.category] = (c[p.category]||0)+1; });
    return c;
  }, [posts]);

  const sortedCats = useMemo(() =>
    [...CATEGORIES].sort((a,b) => (CORPUS_COUNTS[b]||0) - (CORPUS_COUNTS[a]||0)),
  []);

  // Full-corpus counts for the post-type legend, same "unfiltered" semantics
  // as CORPUS_COUNTS above (not affected by the score slider or search).
  const postTypeCounts = useMemo(() => {
    const c = {};
    allPosts.forEach(p => { c[p.post_type] = (c[p.post_type]||0)+1; });
    return c;
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
  // now: passes the score floor, its category/post-type is toggled on, and
  // (if searching) it's in the match set. This is what Dump exports.
  const visiblePosts = useMemo(() => {
    return posts.filter(p => {
      const groupActive = viewMode === "category"
        ? activeCategories.has(p.category)
        : activePostTypes.has(p.post_type);
      if (!groupActive) return false;
      if (searching && !matchingIds.has(p.id)) return false;
      return true;
    });
  }, [posts, viewMode, activeCategories, activePostTypes, searching, matchingIds]);

  const startDump = () => setDumpStatus("confirm");
  const cancelDump = () => { setDumpStatus("idle"); setDumpError(null); };

  const confirmDump = async () => {
    setDumpStatus("running");
    setDumpProgress({ done: 0, total: visiblePosts.length });
    try {
      const markdown = await buildDumpMarkdown({
        posts: visiblePosts,
        viewMode, keywords, searchScope, matchMode, minScore,
        activeCategories, activePostTypes,
        onProgress: (done, total) => setDumpProgress({ done, total }),
      });
      downloadMarkdown(markdown, `returnToIndia-dump-${visiblePosts.length}-posts.md`);
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

  const VW = window.innerWidth;
  const VH = window.innerHeight;
  const outerR = Math.min(VW, VH) * 0.44;
  const cx = VW / 2;
  const cy = VH / 2;

  const { clusters, centroids } = useMemo(
    () => computeLayout(posts, outerR),
    [posts, outerR]
  );

  // Three fixed-position circles, left-to-right, one per move stage.
  const stageR = Math.min(VW / 6, VH * 0.42) * 0.88;
  const stageCenters = useMemo(() => {
    const c = {};
    MOVE_STAGES.forEach((stage, i) => { c[stage] = { x: VW * (i + 0.5) / 3, y: cy }; });
    return c;
  }, [VW, cy]);

  const moveStageClusters = useMemo(
    () => computeMoveStageLayout(posts, stageR),
    [posts, stageR]
  );

  // ---------------------------------------------------------------------------
  // D3 zoom
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;
    const svg = d3.select(svgRef.current);
    const g   = d3.select(gRef.current);
    const zoom = d3.zoom()
      .scaleExtent([0.4, 10])
      .on("zoom", (event) => { g.attr("transform", event.transform); });
    svg.call(zoom);
    zoomRef.current = zoom;
    return () => svg.on(".zoom", null);
  }, []);

  const zoomToCategory = useCallback((cat) => {
    if (!svgRef.current || !zoomRef.current) return;
    const catCircles = clusters[cat];
    if (!catCircles?.length) return;
    const xs = catCircles.map(c => cx + c.x);
    const ys = catCircles.map(c => cy + c.y);
    const x0 = Math.min(...xs) - 50, x1 = Math.max(...xs) + 50;
    const y0 = Math.min(...ys) - 50, y1 = Math.max(...ys) + 50;
    const scale = Math.min(10, 0.88 / Math.max((x1-x0)/VW, (y1-y0)/VH));
    const tx = VW/2 - scale*(x0+x1)/2;
    const ty = VH/2 - scale*(y0+y1)/2;
    d3.select(svgRef.current).transition().duration(600)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx,ty).scale(scale));
  }, [clusters, cx, cy, VW, VH]);

  const zoomToStage = useCallback((stage) => {
    if (!svgRef.current || !zoomRef.current) return;
    const center = stageCenters[stage];
    if (!center) return;
    const x0 = center.x - stageR - 30, x1 = center.x + stageR + 30;
    const y0 = center.y - stageR - 30, y1 = center.y + stageR + 30;
    const scale = Math.min(10, 0.88 / Math.max((x1-x0)/VW, (y1-y0)/VH));
    const tx = VW/2 - scale*(x0+x1)/2;
    const ty = VH/2 - scale*(y0+y1)/2;
    d3.select(svgRef.current).transition().duration(600)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx,ty).scale(scale));
  }, [stageCenters, stageR, VW, VH]);

  const resetZoom = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(400)
      .call(zoomRef.current.transform, d3.zoomIdentity);
  }, []);

  // The two view modes use unrelated coordinate layouts — carrying a zoom
  // transform over from one to the other would land on an empty area.
  useEffect(() => { resetZoom(); }, [viewMode, resetZoom]);

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

  return (
    <div style={{ width:"100vw", height:"100vh", background:"#F7F6F3", overflow:"hidden", position:"relative" }}>

      {/* Header */}
      <div style={{
        position:"fixed", top:0, left:0, right:0,
        padding:"16px 28px", display:"flex", alignItems:"baseline", gap:12,
        zIndex:50, pointerEvents:"none",
      }}>
        <h1 style={{ margin:0, fontSize:13, fontWeight:600, color:"#1A1A1A", fontFamily:"Inter,sans-serif", letterSpacing:"-0.01em" }}>
          r/returnToIndia
        </h1>
        <span style={{ fontSize:11, color:"#CCC", fontFamily:"Inter,sans-serif" }}>
          {posts.length.toLocaleString()} posts · circle size = engagement
        </span>
      </div>

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
        onClick={resetZoom}
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
          {viewMode === "category" ? (
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

                    {/* Category label */}
                    {centroid && (
                      <text
                        x={centroid.x} y={centroid.y}
                        textAnchor="middle" dominantBaseline="central"
                        fill="#000000"
                        fillOpacity={catActive ? 0.8 : 0.1}
                        fontSize={9} fontFamily="Inter,sans-serif"
                        fontWeight={600} letterSpacing="0.1em"
                        pointerEvents="all"
                        style={{ cursor:"zoom-in" }}
                        onClick={e => { e.stopPropagation(); zoomToCategory(cat); }}
                      >
                        {CATEGORY_LABELS[cat].toUpperCase()}
                      </text>
                    )}
                  </g>
                );
              })}
            </>
          ) : (
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
        </g>
      </svg>

      {/* Legend */}
      {viewMode === "category" ? (
        <Legend
          title="Categories"
          items={sortedCats.map(cat => ({
            key: cat, label: CATEGORY_LABELS[cat], color: CATEGORY_COLORS[cat], count: CORPUS_COUNTS[cat],
          }))}
          activeKeys={activeCategories}
          onToggle={toggleCategory}
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
      )}

      {/* View mode toggle */}
      <ViewModeToggle mode={viewMode} onChange={setViewMode} />

      {/* Score slider */}
      <ScoreSlider
        sliderPos={scoreSliderPos}
        onChange={setScoreSliderPos}
        minScore={minScore}
        visibleCount={posts.length}
        totalCount={allPosts.length}
      />

      {/* Tooltip */}
      {tooltip && <Tooltip post={tooltip.post} x={tooltip.x} y={tooltip.y} />}

      {/* Thread panel — passes keywords for highlighting */}
      {selectedPost && (
        <ThreadPanel
          post={selectedPost}
          keywords={keywords}
          onClose={() => setSelectedPost(null)}
        />
      )}
    </div>
  );
}