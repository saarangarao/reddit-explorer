import { useState, useMemo, useRef } from "react";
import * as d3 from "d3";

// ---------------------------------------------------------------------------
// DATA — swap comment when real data is ready
// import postsData from "./posts_viz.json";
// ---------------------------------------------------------------------------

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

// Real distribution from your corpus
const CORPUS_COUNTS = {
  career:1195, finances:1155, logistics:332, relationships:221,
  culture:211, other:151, legal:141, housing:123,
  education:103, healthcare:88, family:83,
};

// ---------------------------------------------------------------------------
// Proportional sampling: scale to [30, 200] preserving relative weight
// ---------------------------------------------------------------------------
function computeSampleCounts(corpusCounts, minSample=30, maxSample=200) {
  const vals = Object.values(corpusCounts);
  const cMin = Math.min(...vals);
  const cMax = Math.max(...vals);
  const span = cMax - cMin;
  const result = {};
  Object.entries(corpusCounts).forEach(([cat, n]) => {
    result[cat] = Math.round(minSample + (maxSample - minSample) * (n - cMin) / span);
  });
  return result;
}

const SAMPLE_COUNTS = computeSampleCounts(CORPUS_COUNTS);

// ---------------------------------------------------------------------------
// Generate sample posts (replace with real data slice from posts_viz.json)
// ---------------------------------------------------------------------------
function generateSamplePosts() {
  const TITLES = {
    career:["Job offer in Bangalore vs staying in US","Salary expectations after R2I","Tech jobs in Hyderabad — realistic?","WFH for US company while in India","Finding a job before moving back","Career switch after returning","Startup ecosystem comparison","Notice period negotiation","Remote work from India","Job market reality check 2024"],
    finances:["401k after moving to India","Tax implications of R2I","NRE vs NRO account guide","Transferring savings — best way?","DTAA and double taxation","Investment options after returning","ESPP and brokerage accounts as NRI","Roth IRA after returning","Credit score implications","Portfolio rebalancing before leaving"],
    logistics:["OCI card process timeline","Moving pets to India","Shipping household goods","Indian driving license for returnees","Pre-departure checklist","Customs and import duties","Health insurance transition","Phone plan after returning","Packers and movers experience","Air freight vs sea freight"],
    relationships:["Moving back for aging parents","Spouse reluctant to return","Kids adjustment after moving","Long distance while planning R2I","Making friends as a returnee","Social life after returning","Partner visa for non-Indian spouse","Dating after returning","Friend circle rebuild","In-laws and family dynamics"],
    culture:["Reverse culture shock is real","Work culture differences","Missing US lifestyle","Indian cities vs US suburbs","Adjusting to Indian pace","Food and daily life","Traffic and commute reality","Noise levels adjustment","Power cuts and infrastructure","Shopping habits change"],
    other:["General question for returnees","Random observation","Off topic discussion","Miscellaneous advice","Community meta post","AMA — returned 3 years ago","Weekly discussion thread","Poll — best city for returnees","Satire post","Rant about planning"],
    legal:["FEMA compliance after returning","Property purchase as OCI","Bribery and corruption","Double taxation legal side","Legal documents to prepare","RBI regulations for returnees","Will and estate planning","Business registration after returning","Intellectual property concerns","Employment contract review"],
    housing:["Buying vs renting in Bangalore","Best areas in Pune","Apartment hunting remotely","Gated communities worth it?","Housing costs reality check","Builder reputation research","Interior design after moving","Property registration process","Vastu and layout preferences","Neighbourhood comparison"],
    education:["International schools in Hyderabad","Kids curriculum transition","CBSE vs ICSE vs IB","College admissions for returnees","Homeschooling options","University application process","School fees reality","Extracurriculars availability","Language barrier for kids","Sports and activities"],
    healthcare:["Health insurance options","Air quality concerns in Delhi","Finding good doctors in Bangalore","Mental health support in India","Specialist availability","Medical records transfer","Vaccination requirements","Gym and fitness options","Dental care costs","Prescription medication access"],
    family:["Moving back to support parents","Family of 4 returning","Kids born in US — OCI process","Split family arrangement","Elderly parent care","Joint family dynamics","Childcare options","School admission for young kids","Family finances planning","Grandparent relationship building"],
  };
  const posts = [];
  Object.entries(SAMPLE_COUNTS).forEach(([cat, count]) => {
    const titles = TITLES[cat] || ["Post about " + cat];
    for (let i = 0; i < count; i++) {
      const score    = Math.floor(Math.random() * 800) + 5;
      const comments = Math.floor(Math.random() * 150) + 2;
      const eng      = Math.log(1 + score) * Math.log(1 + comments);
      posts.push({
        id: `${cat}_${i}`,
        title: titles[i % titles.length],
        score, comments, category: cat, engagement: eng,
        post_asks: [
          "How should I approach this situation when returning to India?",
          "Has anyone navigated this successfully and what did you learn?",
        ],
        post_responses: [
          "Consult a CA who specialises in NRI matters before making any financial moves.",
          "Use the RNOR status window — it gives you a meaningful tax advantage in the first 2-3 years.",
          "Retain your US accounts for 6-12 months to keep flexibility during the transition.",
        ],
        thread: `POST TITLE:\n${titles[i % titles.length]}\n\nPOST BODY:\nThe original poster shares their background and situation, asking the r/returnToIndia community for advice based on their experiences.\n\nCOMMENTS (sorted by score, highest first):\n[Comment 1]\nA detailed response from a community member with direct experience sharing practical advice.\n---\n[Comment 2]\nAnother perspective noting that individual circumstances vary and recommending professional guidance for specific situations.`,
      });
    }
  });
  // Normalize radii within [3, 14]
  const engs = posts.map(p => p.engagement);
  const eMin = Math.min(...engs), eMax = Math.max(...engs), span = eMax - eMin || 1;
  posts.forEach(p => { p.radius = 3 + 11 * (p.engagement - eMin) / span; });
  return posts;
}

// ---------------------------------------------------------------------------
// Pack layout — static, computed once
// ---------------------------------------------------------------------------
function computeLayout(posts, outerR) {
  const byCategory = {};
  CATEGORIES.forEach(cat => { byCategory[cat] = []; });
  posts.forEach(p => { if (byCategory[p.category]) byCategory[p.category].push(p); });

  // Pack each category cluster using d3.packSiblings
  const clusterNodes = CATEGORIES.map(cat => {
    const catPosts = byCategory[cat];
    const circles  = catPosts.map(p => ({ r: p.radius, post: p }));
    const packed   = d3.packSiblings(circles);
    // Enclosing circle for the cluster
    const enclosing = d3.packEnclose(packed);
    // Add padding
    const pad = 8;
    return {
      cat,
      circles: packed,
      r: enclosing.r + pad,
      x: 0, y: 0,
    };
  });

  // Pack clusters inside outer circle
  const outerNode = {
    children: clusterNodes.map(n => ({ r: n.r, data: n })),
    r: outerR,
  };

  const packed = d3.packSiblings(outerNode.children.map(n => ({ r: n.r, data: n.data })));
  const enclosing = d3.packEnclose(packed);
  const scale = outerR / (enclosing.r + 10);

  packed.forEach((node, i) => {
    clusterNodes[i].x = node.x * scale;
    clusterNodes[i].y = node.y * scale;
  });

  return clusterNodes;
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
// Legend
// ---------------------------------------------------------------------------
function Legend({ sortedCats, counts, activeCategories, onToggle }) {
  return (
    <div style={{
      position:"fixed", bottom:24, left:24,
      background:"#FAFAF8", border:"1px solid #E0DDD8",
      borderRadius:8, padding:"12px 14px",
      fontFamily:"Inter,sans-serif", zIndex:50, minWidth:168,
      boxShadow:"0 2px 10px rgba(0,0,0,0.05)",
    }}>
      <p style={{ margin:"0 0 9px", fontSize:9, fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase", color:"#CCC" }}>
        Categories
      </p>
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
      <p style={{ margin:"9px 0 0", fontSize:10, color:"#CCC", lineHeight:1.4 }}>Click to filter</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function Explorer() {
  const posts = useMemo(() => generateSamplePosts(), []);

  const [selectedPost, setSelectedPost] = useState(null);
  const [tooltip, setTooltip]           = useState(null);
  const [activeCategories, setActiveCategories] = useState(new Set(CATEGORIES));

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

  // Responsive outer radius — fits inside viewport with margin
  const VW = window.innerWidth;
  const VH = window.innerHeight;
  const outerR = Math.min(VW, VH) * 0.44;
  const cx = VW / 2;
  const cy = VH / 2;

  // Compute static layout once
  const clusters = useMemo(() => computeLayout(posts, outerR), [posts, outerR]);

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
          {posts.length.toLocaleString()} posts · proportional sample · circle size = engagement
        </span>
      </div>

      {/* SVG map */}
      <svg width={VW} height={VH} style={{ display:"block" }}
        onClick={e => { if (e.target.tagName === "svg" || e.target.tagName === "circle" && !e.target.__data__) setSelectedPost(null); }}
      >
        {/* Outer boundary circle */}
        <circle
          cx={cx} cy={cy} r={outerR}
          fill="none" stroke="#E0DDD8" strokeWidth={1}
        />

        {/* Category clusters */}
        {clusters.map(cluster => {
          if (!activeCategories.has(cluster.cat)) return null;
          const color = CATEGORY_COLORS[cluster.cat] || CATEGORY_COLORS.other;
          return (
            <g key={cluster.cat} transform={`translate(${cx + cluster.x}, ${cy + cluster.y})`}>
              {cluster.circles.map((c, i) => (
                <circle
                  key={i}
                  cx={c.x} cy={c.y} r={c.r}
                  fill={color} fillOpacity={0.7}
                  stroke={color} strokeWidth={0.5} strokeOpacity={0.3}
                  style={{ cursor:"pointer" }}
                  onMouseEnter={e => {
                    e.target.setAttribute("fill-opacity","0.92");
                    setTooltip({ post: c.post, x: e.clientX, y: e.clientY });
                  }}
                  onMouseMove={e => setTooltip(prev => prev ? { ...prev, x:e.clientX, y:e.clientY } : null)}
                  onMouseLeave={e => {
                    e.target.setAttribute("fill-opacity","0.7");
                    setTooltip(null);
                  }}
                  onClick={e => {
                    e.stopPropagation();
                    setSelectedPost(c.post);
                    setTooltip(null);
                  }}
                />
              ))}
              {/* Category label at cluster centroid */}
              <text
                x={0} y={0}
                textAnchor="middle" dominantBaseline="central"
                fill={color} fillOpacity={0.5}
                fontSize={9} fontFamily="Inter,sans-serif"
                fontWeight={600} letterSpacing="0.1em"
                pointerEvents="none"
              >
                {CATEGORY_LABELS[cluster.cat].toUpperCase()}
              </text>
            </g>
          );
        })}

        {/* Dimmed overlay for inactive categories */}
        {clusters.map(cluster => {
          if (activeCategories.has(cluster.cat)) return null;
          return (
            <g key={`dim-${cluster.cat}`} transform={`translate(${cx + cluster.x}, ${cy + cluster.y})`}>
              {cluster.circles.map((c, i) => (
                <circle
                  key={i}
                  cx={c.x} cy={c.y} r={c.r}
                  fill={CATEGORY_COLORS[cluster.cat]} fillOpacity={0.08}
                  stroke="none"
                />
              ))}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <Legend
        sortedCats={sortedCats}
        counts={SAMPLE_COUNTS}
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
