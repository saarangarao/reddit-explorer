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
// Pack layout — static, computed once
// ---------------------------------------------------------------------------
function computeLayout(posts, outerR) {
  const byCategory = {};
  CATEGORIES.forEach(cat => { byCategory[cat] = []; });
  posts.forEach(p => { if (byCategory[p.category]) byCategory[p.category].push(p); });

  const root = {
    children: CATEGORIES.map(cat => ({
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
// Thread panel
// ---------------------------------------------------------------------------
function ThreadPanel({ post, onClose }) {
  const [tab, setTab] = useState("thread");
  const color = CATEGORY_COLORS[post.category] || CATEGORY_COLORS.other;

  const threadBlocks = post.thread.split("\n---\n").map((block, i, arr) => (
    <div key={i} style={{ marginBottom:14, paddingBottom:14, borderBottom: i < arr.length-1 ? "1px solid #EDEBE6" : "none" }}>
      {block.split("\n").map((line, j) => {
        if (!line.trim()) return <br key={j}/>;
        const isH = /^(POST TITLE:|POST BODY:|COMMENTS|\[Comment \d+\])/.test(line.trim());
        return (
          <p key={j} style={{
            margin:"2px 0", lineHeight:1.7,
            fontSize: isH ? 10 : 13,
            fontWeight: isH ? 600 : 400,
            color: isH ? "#CCC" : "#2C2C2C",
            fontFamily: isH ? "Inter,sans-serif" : "Georgia,serif",
            letterSpacing: isH ? "0.08em" : 0,
            textTransform: isH ? "uppercase" : "none",
          }}>{line}</p>
        );
      })}
    </div>
  ));

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
          {post.title}
        </h2>
        <div style={{ display:"flex", gap:14, fontSize:11, color:"#BBB", marginBottom:13 }}>
          <span>↑ {post.score.toLocaleString()}</span>
          <span>💬 {post.comments.toLocaleString()}</span>
        </div>
        <div style={{ display:"flex" }}>
          {["thread","summary"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex:1, padding:"8px 0",
              background:"none", border:"none",
              borderBottom: tab===t ? `2px solid ${color}` : "2px solid transparent",
              cursor:"pointer", fontSize:11,
              fontWeight: tab===t ? 600 : 400,
              color: tab===t ? "#1A1A1A" : "#BBB",
              transition:"all 0.15s", textTransform:"capitalize",
            }}>{t}</button>
          ))}
        </div>
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"18px 22px" }}>
        {tab === "thread" ? (
          <div>{threadBlocks}</div>
        ) : (
          <div>
            {post.post_asks?.length > 0 && (
              <div style={{ marginBottom:24 }}>
                <p style={{ fontSize:9, fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase", color:"#CCC", margin:"0 0 10px" }}>Post Asks</p>
                {post.post_asks.map((ask, i) => (
                  <div key={i} style={{ display:"flex", gap:9, marginBottom:10, alignItems:"flex-start" }}>
                    <span style={{ width:4, height:4, borderRadius:"50%", background:color, flexShrink:0, marginTop:8 }}/>
                    <p style={{ margin:0, fontSize:13, color:"#2C2C2C", lineHeight:1.65, fontFamily:"Georgia,serif" }}>{ask}</p>
                  </div>
                ))}
              </div>
            )}
            {post.post_responses?.length > 0 && (
              <div>
                <p style={{ fontSize:9, fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase", color:"#CCC", margin:"0 0 10px" }}>Responses & Advice</p>
                {post.post_responses.map((res, i) => (
                  <div key={i} style={{ display:"flex", gap:9, marginBottom:10, alignItems:"flex-start" }}>
                    <span style={{ width:4, height:4, borderRadius:"50%", background:color, flexShrink:0, marginTop:8 }}/>
                    <p style={{ margin:0, fontSize:13, color:"#2C2C2C", lineHeight:1.65, fontFamily:"Georgia,serif" }}>{res}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
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
// Legend — collapsible
// ---------------------------------------------------------------------------
function Legend({ sortedCats, counts, activeCategories, onToggle }) {
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
      {/* Header row — always visible */}
      <div
        onClick={() => setExpanded(prev => !prev)}
        style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          cursor:"pointer", marginBottom: expanded ? 9 : 0,
        }}
      >
        <p style={{ margin:0, fontSize:9, fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase", color:"#CCC" }}>
          Categories
        </p>
        <span style={{ fontSize:10, color:"#CCC", marginLeft:10, lineHeight:1 }}>
          {expanded ? "▾" : "▸"}
        </span>
      </div>

      {/* Collapsible body */}
      {expanded && (
        <>
          {sortedCats.map(cat => {
            const active = activeCategories.has(cat);
            return (
              <div key={cat} onClick={() => onToggle(cat)} style={{
                display:"flex", alignItems:"center", justifyContent:"space-between",
                gap:7, marginBottom:5, cursor:"pointer",
                opacity: active ? 1 : 0.28, transition:"opacity 0.15s",
              }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ width:6, height:6, borderRadius:"50%", background:CATEGORY_COLORS[cat], flexShrink:0 }}/>
                  <span style={{ fontSize:11, color:"#2C2C2C" }}>{CATEGORY_LABELS[cat]}</span>
                </div>
                <span style={{ fontSize:10, color:"#CCC" }}>{counts[cat]||0}</span>
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
// Main
// ---------------------------------------------------------------------------
export default function Explorer() {
  const posts = useMemo(() => {
    const engs = postsData.map(p => p.engagement);
    const eMin = Math.min(...engs);
    const eMax = Math.max(...engs);
    const span = eMax - eMin || 1;
    return postsData.map(p => ({
      ...p,
      radius: 2.5 + 7 * (p.engagement - eMin) / span,
    }));
  }, []);

  const [selectedPost, setSelectedPost] = useState(null);
  const [tooltip, setTooltip]           = useState(null);
  const [activeCategories, setActiveCategories] = useState(new Set(CATEGORIES));

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

  const toggleCategory = (cat) => {
    setActiveCategories(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
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

  // ---------------------------------------------------------------------------
  // D3 zoom — set up once after mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;

    const svg = d3.select(svgRef.current);
    const g   = d3.select(gRef.current);

    const zoom = d3.zoom()
      .scaleExtent([0.4, 10])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);
    zoomRef.current = zoom;

    return () => svg.on(".zoom", null);
  }, []);

  // ---------------------------------------------------------------------------
  // Zoom to category
  // ---------------------------------------------------------------------------
  const zoomToCategory = useCallback((cat) => {
    if (!svgRef.current || !zoomRef.current) return;
    const catCircles = clusters[cat];
    if (!catCircles?.length) return;

    const xs = catCircles.map(c => cx + c.x);
    const ys = catCircles.map(c => cy + c.y);
    const x0 = Math.min(...xs) - 50;
    const x1 = Math.max(...xs) + 50;
    const y0 = Math.min(...ys) - 50;
    const y1 = Math.max(...ys) + 50;

    const scale = Math.min(10, 0.88 / Math.max((x1 - x0) / VW, (y1 - y0) / VH));
    const tx    = VW / 2 - scale * (x0 + x1) / 2;
    const ty    = VH / 2 - scale * (y0 + y1) / 2;

    d3.select(svgRef.current)
      .transition().duration(600)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }, [clusters, cx, cy, VW, VH]);

  // ---------------------------------------------------------------------------
  // Reset zoom
  // ---------------------------------------------------------------------------
  const resetZoom = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current)
      .transition().duration(400)
      .call(zoomRef.current.transform, d3.zoomIdentity);
  }, []);

  return (
    <div style={{
      width:"100vw", height:"100vh",
      background:"#F7F6F3",
      overflow:"hidden", position:"relative",
    }}>

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

      {/* SVG map */}
      <svg
        ref={svgRef}
        width={VW} height={VH}
        style={{ display:"block", cursor:"grab" }}
        onClick={e => { if (e.target.tagName === "svg") setSelectedPost(null); }}
      >
        {/* Zoomable group */}
        <g ref={gRef}>

          {/* Outer boundary circle */}
          <circle
            cx={cx} cy={cy} r={outerR}
            fill="none" stroke="#E0DDD8" strokeWidth={1}
          />

          {/* Category clusters */}
          {CATEGORIES.map(cat => {
            const color    = CATEGORY_COLORS[cat] || CATEGORY_COLORS.other;
            const circles  = clusters[cat] || [];
            const centroid = centroids[cat];
            if (!circles.length) return null;

            return (
              <g key={cat} transform={`translate(${cx}, ${cy})`}>
                {circles.map((c, i) => (
                  <circle
                    key={i}
                    cx={c.x} cy={c.y} r={c.r}
                    fill={color}
                    fillOpacity={activeCategories.has(cat) ? 0.7 : 0.08}
                    stroke={color}
                    strokeWidth={0.5}
                    strokeOpacity={activeCategories.has(cat) ? 0.3 : 0}
                    style={{ cursor: activeCategories.has(cat) ? "pointer" : "default" }}
                    onMouseEnter={e => {
                      if (!activeCategories.has(cat)) return;
                      e.target.setAttribute("fill-opacity", "0.92");
                      setTooltip({ post: c.post, x: e.clientX, y: e.clientY });
                    }}
                    onMouseMove={e => setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                    onMouseLeave={e => {
                      e.target.setAttribute("fill-opacity", activeCategories.has(cat) ? "0.7" : "0.08");
                      setTooltip(null);
                    }}
                    onClick={e => {
                      if (!activeCategories.has(cat)) return;
                      e.stopPropagation();
                      setSelectedPost(c.post);
                      setTooltip(null);
                    }}
                  />
                ))}
                {centroid && (
                  <text
                    x={centroid.x} y={centroid.y}
                    textAnchor="middle" dominantBaseline="central"
                    fill="#000000"
                    fillOpacity={activeCategories.has(cat) ? 0.8 : 0.1}
                    fontSize={9} fontFamily="Inter,sans-serif"
                    fontWeight={600} letterSpacing="0.1em"
                    pointerEvents="all"
                    style={{ cursor:"zoom-in" }}
                    onClick={e => {
                      e.stopPropagation();
                      zoomToCategory(cat);
                    }}
                  >
                    {CATEGORY_LABELS[cat].toUpperCase()}
                  </text>
                )}
              </g>
            );
          })}

        </g>
      </svg>

      {/* Legend */}
      <Legend
        sortedCats={sortedCats}
        counts={counts}
        activeCategories={activeCategories}
        onToggle={toggleCategory}
      />

      {/* Tooltip */}
      {tooltip && <Tooltip post={tooltip.post} x={tooltip.x} y={tooltip.y} />}

      {/* Thread panel */}
      {selectedPost && (
        <ThreadPanel post={selectedPost} onClose={() => setSelectedPost(null)} />
      )}
    </div>
  );
}
