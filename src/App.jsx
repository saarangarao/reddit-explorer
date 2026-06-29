import { useState, useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";

import postsData from "./posts_viz.json";


const CATEGORIES = [
  "career", "finances", "logistics", "relationships",
  "culture", "other", "legal", "housing",
  "education", "healthcare", "family",
];

const CATEGORY_COLORS = {
  career:        "#8B7BA8",  // muted violet
  finances:      "#7B9E87",  // sage green
  logistics:     "#C4956A",  // warm tan
  relationships: "#B8896E",  // adobe
  culture:       "#9B8EA8",  // mauve
  other:         "#A8A49E",  // warm grey
  legal:         "#7A9BAF",  // steel blue
  housing:       "#C4845A",  // terracotta
  education:     "#8FAF8F",  // moss
  healthcare:    "#7EA8BE",  // slate blue
  family:        "#8DA08D",  // eucalyptus
};

const CATEGORY_LABELS = {
  career:        "Career",
  finances:      "Finances",
  logistics:     "Logistics",
  relationships: "Relationships",
  culture:       "Culture",
  other:         "Other",
  legal:         "Legal",
  housing:       "Housing",
  education:     "Education",
  healthcare:    "Healthcare",
  family:        "Family",
};

// ---------------------------------------------------------------------------
// Thread panel
// ---------------------------------------------------------------------------

function ThreadPanel({ post, onClose }) {
  const [tab, setTab] = useState("thread");
  const color = CATEGORY_COLORS[post.category] || CATEGORY_COLORS.other;

  const threadBlocks = post.thread.split("\n---\n").map((block, i, arr) => (
    <div key={i} style={{
      marginBottom: 16,
      paddingBottom: 16,
      borderBottom: i < arr.length - 1 ? "1px solid #EDEBE6" : "none",
    }}>
      {block.split("\n").map((line, j) => {
        const isHeader = /^(POST TITLE:|POST BODY:|COMMENTS|^\[Comment \d+\]$)/.test(line.trim());
        return line.trim() ? (
          <p key={j} style={{
            margin: "2px 0",
            fontSize: isHeader ? 10 : 14,
            fontWeight: isHeader ? 600 : 400,
            color: isHeader ? "#AAA" : "#2C2C2C",
            fontFamily: isHeader ? "Inter, sans-serif" : "Georgia, serif",
            letterSpacing: isHeader ? "0.08em" : 0,
            textTransform: isHeader ? "uppercase" : "none",
            lineHeight: 1.7,
          }}>{line}</p>
        ) : <br key={j} />;
      })}
    </div>
  ));

  return (
    <div style={{
      position: "fixed",
      top: 0, right: 0,
      width: "min(540px, 92vw)",
      height: "100vh",
      background: "#FAFAF8",
      borderLeft: "1px solid #E0DDD8",
      display: "flex",
      flexDirection: "column",
      zIndex: 100,
      fontFamily: "Inter, sans-serif",
      boxShadow: "-4px 0 24px rgba(0,0,0,0.06)",
    }}>
      {/* Header */}
      <div style={{ padding: "20px 24px 0", borderBottom: "1px solid #EDEBE6", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <span style={{
            fontSize: 10, fontWeight: 600,
            letterSpacing: "0.1em", textTransform: "uppercase",
            color: color,
          }}>
            {CATEGORY_LABELS[post.category] || post.category}
          </span>
          <button onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 16, color: "#BBB", lineHeight: 1, padding: "0 0 0 16px",
          }}>✕</button>
        </div>

        <h2 style={{
          margin: "0 0 10px",
          fontSize: 16, fontWeight: 600, color: "#1A1A1A",
          lineHeight: 1.4, fontFamily: "Georgia, serif",
        }}>
          {post.title}
        </h2>

        <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#AAA", marginBottom: 14 }}>
          <span>↑ {post.score.toLocaleString()}</span>
          <span>💬 {post.comments.toLocaleString()}</span>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0 }}>
          {["thread", "summary"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: "9px 0",
              background: "none", border: "none",
              borderBottom: tab === t ? `2px solid ${color}` : "2px solid transparent",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: tab === t ? 600 : 400,
              color: tab === t ? "#1A1A1A" : "#AAA",
              fontFamily: "Inter, sans-serif",
              transition: "all 0.15s",
              textTransform: "capitalize",
            }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {tab === "thread" ? (
          <div>{threadBlocks}</div>
        ) : (
          <div>
            {/* Post asks */}
            {post.post_asks?.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <p style={{
                  fontSize: 10, fontWeight: 600,
                  letterSpacing: "0.1em", textTransform: "uppercase",
                  color: "#AAA", margin: "0 0 12px",
                }}>Post Asks</p>
                {post.post_asks.map((ask, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "flex-start" }}>
                    <span style={{
                      width: 5, height: 5, borderRadius: "50%",
                      background: color, flexShrink: 0, marginTop: 7,
                    }}/>
                    <p style={{
                      margin: 0, fontSize: 14, color: "#2C2C2C",
                      lineHeight: 1.65, fontFamily: "Georgia, serif",
                    }}>{ask}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Post responses */}
            {post.post_responses?.length > 0 && (
              <div>
                <p style={{
                  fontSize: 10, fontWeight: 600,
                  letterSpacing: "0.1em", textTransform: "uppercase",
                  color: "#AAA", margin: "0 0 12px",
                }}>Responses & Advice</p>
                {post.post_responses.map((res, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "flex-start" }}>
                    <span style={{
                      width: 5, height: 5, borderRadius: "50%",
                      background: color, flexShrink: 0, marginTop: 7,
                    }}/>
                    <p style={{
                      margin: 0, fontSize: 14, color: "#2C2C2C",
                      lineHeight: 1.65, fontFamily: "Georgia, serif",
                    }}>{res}</p>
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
      position: "fixed",
      left: Math.min(x + 14, window.innerWidth - 290),
      top: Math.max(y - 10, 10),
      background: "#FAFAF8",
      border: "1px solid #E0DDD8",
      borderRadius: 7,
      padding: "10px 14px",
      maxWidth: 280,
      pointerEvents: "none",
      zIndex: 200,
      fontFamily: "Inter, sans-serif",
      boxShadow: "0 4px 20px rgba(0,0,0,0.09)",
    }}>
      <span style={{
        fontSize: 9, fontWeight: 600,
        letterSpacing: "0.1em", textTransform: "uppercase",
        color, display: "block", marginBottom: 5,
      }}>
        {CATEGORY_LABELS[post.category] || post.category}
      </span>
      <p style={{
        margin: "0 0 7px", fontSize: 13,
        color: "#1A1A1A", lineHeight: 1.4,
        fontFamily: "Georgia, serif",
      }}>
        {post.title}
      </p>
      <div style={{ display: "flex", gap: 14, fontSize: 11, color: "#AAA" }}>
        <span>↑ {post.score.toLocaleString()}</span>
        <span>💬 {post.comments.toLocaleString()}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function Legend({ categories, counts, activeCategories, onToggle }) {
  return (
    <div style={{
      position: "fixed",
      bottom: 28, left: 28,
      background: "#FAFAF8",
      border: "1px solid #E0DDD8",
      borderRadius: 8,
      padding: "14px 16px",
      fontFamily: "Inter, sans-serif",
      zIndex: 50,
      maxWidth: 190,
      boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
    }}>
      <p style={{
        margin: "0 0 10px", fontSize: 9, fontWeight: 600,
        letterSpacing: "0.1em", textTransform: "uppercase", color: "#BBB",
      }}>Categories</p>
      {categories.map(cat => {
        const active = activeCategories.has(cat);
        return (
          <div key={cat} onClick={() => onToggle(cat)} style={{
            display: "flex", alignItems: "center",
            justifyContent: "space-between",
            gap: 8, marginBottom: 6,
            cursor: "pointer",
            opacity: active ? 1 : 0.3,
            transition: "opacity 0.15s",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{
                width: 7, height: 7, borderRadius: "50%",
                background: CATEGORY_COLORS[cat] || CATEGORY_COLORS.other,
                flexShrink: 0,
              }}/>
              <span style={{ fontSize: 12, color: "#2C2C2C" }}>
                {CATEGORY_LABELS[cat] || cat}
              </span>
            </div>
            <span style={{ fontSize: 10, color: "#BBB" }}>
              {counts[cat] || 0}
            </span>
          </div>
        );
      })}
      <p style={{ margin: "10px 0 0", fontSize: 10, color: "#CCC", lineHeight: 1.4 }}>
        Click to filter
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main explorer
// ---------------------------------------------------------------------------

export default function Explorer() {
  const svgRef        = useRef(null);
  const simRef        = useRef(null);
  const nodesRef      = useRef([]);

const [posts]         = useState(postsData);
  const [selectedPost, setSelectedPost]       = useState(null);
  const [tooltip, setTooltip]                 = useState(null);
  const [activeCategories, setActiveCategories] = useState(
    new Set(CATEGORIES)
  );

  // Count per category
  const counts = {};
  posts.forEach(p => { counts[p.category] = (counts[p.category] || 0) + 1; });

  // Categories sorted by count descending (matches your real distribution)
  const sortedCats = [...CATEGORIES].sort((a, b) => (counts[b] || 0) - (counts[a] || 0));

  const toggleCategory = useCallback((cat) => {
    setActiveCategories(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // D3 force simulation
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!svgRef.current || !posts.length) return;

    const W = svgRef.current.clientWidth  || 900;
    const H = svgRef.current.clientHeight || 620;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg.append("g");

    // Proportional centroids based on post count
    // Larger categories get more horizontal space
    const totalPosts = posts.length;
    const rowHeight  = H / 3;

    // Arrange in 3 rows, distributing categories proportionally
    const rows = [
      sortedCats.slice(0, 4),
      sortedCats.slice(4, 8),
      sortedCats.slice(8),
    ];

    const centroids = {};
    rows.forEach((row, rowIdx) => {
      const rowTotal = row.reduce((s, c) => s + (counts[c] || 1), 0);
      let x = 0;
      row.forEach(cat => {
        const weight = (counts[cat] || 1) / rowTotal;
        const cx = (x + weight / 2) * W;
        const cy = (rowIdx + 0.5) * rowHeight;
        centroids[cat] = { x: cx, y: cy };
        x += weight;
      });
    });

    // Category labels
    Object.entries(centroids).forEach(([cat, { x, y }]) => {
      g.append("text")
        .attr("x", x)
        .attr("y", y - 55)
        .attr("text-anchor", "middle")
        .attr("fill", CATEGORY_COLORS[cat] || CATEGORY_COLORS.other)
        .attr("fill-opacity", 0.7)
        .attr("font-size", 9)
        .attr("font-family", "Inter, sans-serif")
        .attr("font-weight", 600)
        .attr("letter-spacing", "0.12em")
        .text((CATEGORY_LABELS[cat] || cat).toUpperCase());
    });

    // Nodes
    const nodes = posts.map(p => ({
      ...p,
      x: (centroids[p.category]?.x || W / 2) + (Math.random() - 0.5) * 60,
      y: (centroids[p.category]?.y || H / 2) + (Math.random() - 0.5) * 60,
    }));
    nodesRef.current = nodes;

    const circles = g.selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", d => d.radius)
      .attr("fill", d => CATEGORY_COLORS[d.category] || CATEGORY_COLORS.other)
      .attr("fill-opacity", d => activeCategories.has(d.category) ? 0.72 : 0.12)
      .attr("stroke", d => CATEGORY_COLORS[d.category] || CATEGORY_COLORS.other)
      .attr("stroke-width", 1)
      .attr("stroke-opacity", d => activeCategories.has(d.category) ? 0.35 : 0.08)
      .style("cursor", d => activeCategories.has(d.category) ? "pointer" : "default")
      .on("mouseenter", function (event, d) {
        if (!activeCategories.has(d.category)) return;
        d3.select(this)
          .raise()
          .transition().duration(120)
          .attr("fill-opacity", 0.92)
          .attr("r", d.radius * 1.1);
        setTooltip({ post: d, x: event.clientX, y: event.clientY });
      })
      .on("mousemove", function (event) {
        setTooltip(prev => prev ? { ...prev, x: event.clientX, y: event.clientY } : null);
      })
      .on("mouseleave", function (event, d) {
        d3.select(this)
          .transition().duration(120)
          .attr("fill-opacity", activeCategories.has(d.category) ? 0.72 : 0.12)
          .attr("r", d.radius);
        setTooltip(null);
      })
      .on("click", function (event, d) {
        if (!activeCategories.has(d.category)) return;
        setSelectedPost(d);
        setTooltip(null);
      });

    const simulation = d3.forceSimulation(nodes)
      .force("x", d3.forceX(d => centroids[d.category]?.x || W / 2).strength(0.07))
      .force("y", d3.forceY(d => centroids[d.category]?.y || H / 2).strength(0.07))
      .force("collide", d3.forceCollide(d => d.radius + 1.5).strength(0.9))
      .force("charge", d3.forceManyBody().strength(-6))
      .alphaDecay(0.025)
      .on("tick", () => {
        circles
          .attr("cx", d => Math.max(d.radius + 4, Math.min(W - d.radius - 4, d.x)))
          .attr("cy", d => Math.max(d.radius + 4, Math.min(H - d.radius - 4, d.y)));
      });

    simRef.current = simulation;
    return () => simulation.stop();
  }, [posts]);

  // Update opacity on category filter change without rerunning simulation
  useEffect(() => {
    if (!svgRef.current) return;
    d3.select(svgRef.current).selectAll("circle")
      .attr("fill-opacity", d => d && activeCategories.has(d.category) ? 0.72 : 0.12)
      .attr("stroke-opacity", d => d && activeCategories.has(d.category) ? 0.35 : 0.08)
      .style("cursor", d => d && activeCategories.has(d.category) ? "pointer" : "default");
  }, [activeCategories]);

  return (
    <div style={{
      width: "100vw", height: "100vh",
      background: "#F7F6F3",
      position: "relative", overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0,
        padding: "18px 32px",
        display: "flex", alignItems: "baseline", gap: 14,
        zIndex: 50, pointerEvents: "none",
      }}>
        <h1 style={{
          margin: 0, fontSize: 14, fontWeight: 600,
          color: "#1A1A1A", fontFamily: "Inter, sans-serif",
          letterSpacing: "-0.01em",
        }}>
          r/returnToIndia
        </h1>
        <span style={{ fontSize: 12, color: "#BBB", fontFamily: "Inter, sans-serif" }}>
          {posts.length.toLocaleString()} posts · circle size = community engagement
        </span>
      </div>

      {/* Radius legend */}
      <div style={{
        position: "fixed", bottom: 28, right: 28,
        fontFamily: "Inter, sans-serif",
        zIndex: 50,
        display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6,
      }}>
        <p style={{ margin: 0, fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#CCC" }}>
          Engagement
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {[8, 18, 32].map(r => (
            <div key={r} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{
                width: r * 2, height: r * 2, borderRadius: "50%",
                background: "#C4C0BA", opacity: 0.6,
              }}/>
              <span style={{ fontSize: 9, color: "#CCC" }}>
                {r === 8 ? "low" : r === 18 ? "mid" : "high"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Map */}
      <svg ref={svgRef} width="100%" height="100%" style={{ display: "block" }} />

      {/* Legend */}
      <Legend
        categories={sortedCats}
        counts={counts}
        activeCategories={activeCategories}
        onToggle={toggleCategory}
      />

      {/* Tooltip */}
      {tooltip && <Tooltip post={tooltip.post} x={tooltip.x} y={tooltip.y} />}

      {/* Thread panel */}
      {selectedPost && (
        <ThreadPanel
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
        />
      )}
    </div>
  );
}
