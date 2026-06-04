import React, { useState, useRef, useEffect, useCallback } from "react";

// ─── STORAGE ──────────────────────────────────────────────────────────────────
const jLoad = async () => { try { const r = await window.storage.get("scc_j3"); return r ? JSON.parse(r) : []; } catch { return []; } };
const jSave = async (d) => { try { await window.storage.set("scc_j3", JSON.stringify(d)); } catch {} };
const wLoad = async () => { try { const r = localStorage.getItem("scc_wallet"); return r ? JSON.parse(r) : { initial: 500 }; } catch { return { initial: 500 }; } };
const wSave = async (d) => { try { localStorage.setItem("scc_wallet", JSON.stringify(d)); } catch {} };

// ─── STATIC COIN CONFIG ───────────────────────────────────────────────────────
const COIN_CFG = [
  { s:"BTC",  p:"BTCUSDT",  cgid:"bitcoin",     fallback:76952  },
  { s:"ETH",  p:"ETHUSDT",  cgid:"ethereum",    fallback:2128   },
  { s:"SOL",  p:"SOLUSDT",  cgid:"solana",      fallback:84.66  },
  { s:"HYPE", p:"HYPEUSDT", cgid:"hyperliquid", fallback:47.28  },
  { s:"ZEC",  p:"ZECUSDT",  cgid:"zcash",       fallback:42.15  },
];
const MACRO = "Fear & Greed: 28 · BTC.D High · Goldman dump SOL/XRP ETF · $672M liquidated";

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
const SYSTEM = `Kamu adalah AI trader profesional untuk scalping crypto di Bybit Perpetual. Bahasa Indonesia, tajam, actionable.
RULES: Entry LIMIT ONLY | RR min 1:2 | Confidence <8 → SKIP | Max 3 setup
NO TRADE: tidak ada BOS/CHOCH, tidak ada liquidity sweep, market choppy, high-impact news
ANALISIS: Struktur (BOS/CHOCH H4) + Liquidity sweep + Entry (OB/FVG) + RSI/MACD + Elliott + On-chain (BTC.D, OI, Funding)
CONFLICT: On-chain > Struktur > Indikator
FORMAT WAJIB:
---
## [PAIR] — [LONG/SHORT]
**Confidence:** X/10
**Setup:** [pattern]
**Alasan Utama:** [konkret]
**Entry:** $X.XX → [alasan]
**Stop Loss:** $X.XX (-X%) → [alasan]
**TP1:** $X.XX (+X%) | RR 1:X
**TP2:** $X.XX (+X%) | RR 1:X
**Checklist:** ✔/✘ Struktur | ✔/✘ Liquidity | ✔/✘ Entry | ✔/✘ RR | ✔/✘ Indicator | ✔/✘ Elliott | ✔/✘ BTC.D | ✔/✘ OI | ✔/✘ Funding
**Invalidasi:** [kondisi] | **Time Limit:** [batas]
---
Tidak ada setup valid → ⛔ NO VALID SETUP — [alasan]. WAIT sesi berikutnya.`;

// ─── PLAN PARSER ──────────────────────────────────────────────────────────────
function parseSetups(text) {
  if (!text) return [];
  const pairs = COIN_CFG.map(c => c.p);
  const sections = []; let cur = [];
  for (const ln of text.split("\n")) {
    if (/^#{1,3}\s/.test(ln) && cur.length) { sections.push(cur.join("\n")); cur = [ln]; } else cur.push(ln);
  }
  if (cur.length) sections.push(cur.join("\n"));
  const list = sections.length > 1 ? sections : [text];
  const results = []; const seen = new Set();
  for (const sec of list) {
    let pair = null; for (const p of pairs) { if (sec.toUpperCase().includes(p)) { pair = p; break; } }
    if (!pair) continue;
    const top = sec.split("\n").slice(0,5).join(" ").toUpperCase();
    const dir = top.includes("LONG") ? "Long" : top.includes("SHORT") ? "Short" : null; if (!dir) continue;
    const cm = sec.match(/[Cc]onfidence[^\d]*(\d+)/); if (!cm || parseInt(cm[1]) < 8) continue;
    const conf = parseInt(cm[1]); const key = pair+dir; if (seen.has(key)) continue; seen.add(key);
    const px = (...ps) => { for (const p of ps) { const m = sec.match(new RegExp(p+"[^\\n]{0,50}?\\$?\\s*([1-9][\\d,.]{1,10})","i")); if (m) return m[1].replace(/,/g,""); } return ""; };
    results.push({ pair, direction:dir, confidence:conf, confidenceStr:conf+"/10",
      setup:(sec.match(/\*\*Setup[^*]*:\*\*\s*([^\n]+)/i)||[])[1]?.trim()||"",
      entry:px("\\*\\*Entry","Entry\\s*:"), sl:px("\\*\\*Stop.?Loss","SL\\s*:"),
      tp1:px("\\*\\*TP1","TP1\\s*:"), tp2:px("\\*\\*TP2","TP2\\s*:"),
      timeLimit:(sec.match(/\*\*Time.?Limit[^*]*:\*\*\s*([^\n]+)/i)||[])[1]?.trim()||"" });
  }
  return results;
}

// ─── TRADING STATS + SPIDER METRICS ──────────────────────────────────────────
function calcMetrics(journal, riskAmt) {
  const closed = journal.filter(j=>j.result!=="Open");
  const n = closed.length;
  if (n === 0) return { accuracy:0, profitability:0, riskControl:5, discipline:5, consistency:5, execution:5 };
  const wins = closed.filter(j=>j.result==="Win");
  const losses = closed.filter(j=>j.result==="Loss");
  // Accuracy: win rate (exclude Open)
  const accuracy = (wins.length / n) * 10;
  // Profitability: profit factor scaled
  const wSum = wins.reduce((s,j)=>s+Math.abs(j.pnl||0),0);
  const lSum = losses.reduce((s,j)=>s+Math.abs(j.pnl||0),0);
  const pf = lSum > 0 ? wSum/lSum : (wSum>0?5:0);
  const profitability = Math.min(pf * 2.5, 10);
  // Risk Control: losses within 1.5x risk
  const oversized = losses.filter(j=>Math.abs(j.pnl||0)>riskAmt*1.5).length;
  const riskControl = Math.max(0, 10 - (losses.length>0 ? (oversized/losses.length)*10 : 0));
  // Discipline: avg confidence
  const confArr = journal.filter(j=>j.confidence).map(j=>parseInt(j.confidence)||8);
  const discipline = confArr.length>0 ? confArr.reduce((a,b)=>a+b,0)/confArr.length : 7;
  // Consistency: punish consecutive losses
  let maxCL=0, cl=0;
  for (const j of journal) { if(j.result==="Loss"){cl++;maxCL=Math.max(maxCL,cl);}else cl=0; }
  const consistency = Math.max(0, 10 - maxCL*2.5);
  // Execution: high-conf wins ratio
  const goodExec = journal.filter(j=>(parseInt(j.confidence)||0)>=8&&j.result==="Win").length;
  const withHighConf = journal.filter(j=>(parseInt(j.confidence)||0)>=8).length;
  const execution = withHighConf>0 ? (goodExec/withHighConf)*10 : 5;
  return { accuracy, profitability, riskControl, discipline, consistency, execution };
}

// ─── HEXAGON RADAR CHART ──────────────────────────────────────────────────────

// ─── SEED TRADES ─────────────────────────────────────────────────────────────
const SEED_TRADES = [
  // ── Session 1 (21–25 Mei 2026) ─────────────────────────────────────────────
  { pair:"HYPEUSDT",    direction:"Long",  timeframe:"15m", confidence:"8/10", entry:"47",       sl:"45.773",   tp1:"49.454",  tp2:"", result:"Win",  pnl: 3.3973,  notes:"",                                                         date:"21/5/2026" },
  { pair:"HYPEUSDT",    direction:"Long",  timeframe:"15m", confidence:"8/10", entry:"51.4",     sl:"50.8195",  tp1:"52.561",  tp2:"", result:"Win",  pnl: 2.1117,  notes:"Big Accumulation dan High Volume",                          date:"21/5/2026" },
  { pair:"BTCUSDT",     direction:"Short", timeframe:"15m", confidence:"8/10", entry:"77350",    sl:"77680",    tp1:"76690",   tp2:"", result:"Loss", pnl:-1.1582,  notes:"Volume sellernya kecil",                                   date:"21/5/2026" },
  { pair:"HYPEUSDT",    direction:"Long",  timeframe:"15m", confidence:"8/10", entry:"56.287",   sl:"54.729",   tp1:"59.403",  tp2:"", result:"Win",  pnl: 7.4749,  notes:"",                                                         date:"22/5/2026" },
  { pair:"SOLUSDT",     direction:"Long",  timeframe:"15m", confidence:"8/10", entry:"87.05",    sl:"86.32",    tp1:"88.51",   tp2:"", result:"Loss", pnl:-2.0893,  notes:"",                                                         date:"22/5/2026" },
  { pair:"HYPEUSDT",    direction:"Long",  timeframe:"15m", confidence:"8/10", entry:"59.289",   sl:"58.77",    tp1:"60.327",  tp2:"", result:"Loss", pnl:-0.8447,  notes:"",                                                         date:"22/5/2026" },
  { pair:"1000TAGUSDT", direction:"Long",  timeframe:"15m", confidence:"8/10", entry:"1.48",     sl:"1.45595",  tp1:"1.5281",  tp2:"", result:"Win",  pnl: 1.0980,  notes:"",                                                         date:"23/5/2026" },
  { pair:"HYPEUSDT",    direction:"Short", timeframe:"15m", confidence:"8/10", entry:"57.65",    sl:"58.3775",  tp1:"56.195",  tp2:"", result:"Win",  pnl: 1.8338,  notes:"",                                                         date:"23/5/2026" },
  { pair:"INUSDT",      direction:"Long",  timeframe:"15m", confidence:"8/10", entry:"0.0752",   sl:"0.073115", tp1:"0.07937", tp2:"", result:"Win",  pnl: 9.3615,  notes:"",                                                         date:"23/5/2026" },
  { pair:"INUSDT",      direction:"Long",  timeframe:"15m", confidence:"8/10", entry:"0.0896",   sl:"0.08781",  tp1:"0.09318", tp2:"", result:"Win",  pnl: 5.1280,  notes:"",                                                         date:"24/5/2026" },
  { pair:"BTCUSDT",     direction:"Long",  timeframe:"15m", confidence:"8/10", entry:"75380",    sl:"74839.6",  tp1:"76460.8", tp2:"", result:"Win",  pnl:10.2367,  notes:"",                                                         date:"24/5/2026" },
  { pair:"SOLUSDT",     direction:"Long",  timeframe:"15m", confidence:"8/10", entry:"85.7",     sl:"85.08",    tp1:"86.94",   tp2:"", result:"Loss", pnl:-4.1036,  notes:"",                                                         date:"24/5/2026" },
  { pair:"ZECUSDT",     direction:"Long",  timeframe:"15m", confidence:"8/10", entry:"656.89",   sl:"644.9",    tp1:"680.87",  tp2:"", result:"Loss", pnl:-4.0659,  notes:"",                                                         date:"25/5/2026" },
  { pair:"BTCUSDT",     direction:"Long",  timeframe:"15m", confidence:"8/10", entry:"76350",    sl:"75945.55", tp1:"77158.9", tp2:"", result:"Win",  pnl:12.7506,  notes:"",                                                         date:"25/5/2026" },
  { pair:"BTCUSDT",     direction:"Long",  timeframe:"15m", confidence:"8/10", entry:"77550",    sl:"77400.3",  tp1:"77849.4", tp2:"", result:"Loss", pnl:-6.4411,  notes:"",                                                         date:"25/5/2026" },
  // ── Session 2 (26 Mei 2026) ──────────────────────────────────────────────────
  { pair:"SOLUSDT",     direction:"Long",  timeframe:"15m", confidence:"8/10", entry:"85.023",   sl:"84.8",     tp1:"85.469",  tp2:"", result:"Loss", pnl:-1.7708,  notes:"RR terlalu kecil, SL terlalu ketat",                       date:"26/5/2026" },
  { pair:"SOLUSDT",     direction:"Long",  timeframe:"15m", confidence:"8/10", entry:"85.023",   sl:"84.55",    tp1:"85.969",  tp2:"", result:"Loss", pnl:-3.2450,  notes:"Re-entry setelah SL kena, struktur belum confirm",          date:"26/5/2026" },
  { pair:"NEARUSDT",    direction:"Long",  timeframe:"15m", confidence:"8/10", entry:"2.74",     sl:"2.6891",   tp1:"2.8418",  tp2:"", result:"Loss", pnl:-3.6043,  notes:"",                                                         date:"26/5/2026" },
  { pair:"HYPEUSDT",    direction:"Long",  timeframe:"15m", confidence:"8/10", entry:"59.65",    sl:"59.171",   tp1:"60.608",  tp2:"", result:"Loss", pnl:-2.8215,  notes:"",                                                         date:"26/5/2026" },
  { pair:"HYPEUSDT",    direction:"Long",  timeframe:"15m", confidence:"8/10", entry:"59.967",   sl:"59.033",   tp1:"61.835",  tp2:"", result:"Win",  pnl: 4.0395,  notes:"",                                                         date:"26/5/2026" },
  { pair:"BTCUSDT",     direction:"Long",  timeframe:"15m", confidence:"8/10", entry:"76650",    sl:"76700",    tp1:"76750",   tp2:"", result:"Loss", pnl:-0.0616,  notes:"Terkena SL di area profit/BE, minus karena fee",           date:"26/5/2026" },
  { pair:"BTCUSDT",     direction:"Long",  timeframe:"15m", confidence:"8/10", entry:"77127.22", sl:"76696.88", tp1:"77987.9", tp2:"", result:"Win",  pnl: 7.0860,  notes:"",                                                         date:"26/5/2026" },
  { pair:"SOLUSDT",     direction:"Long",  timeframe:"15m", confidence:"8/10", entry:"85.1",     sl:"84.805",   tp1:"85.69",   tp2:"", result:"Win",  pnl: 2.3137,  notes:"",                                                         date:"26/5/2026" },
];

// ─── ML-STYLE RING BADGE ─────────────────────────────────────────────────────
function MLBadge({ value, sub, color1, color2, size=88 }) {
  const id = "mlb-" + color1.replace("#","");
  const r = size/2 - 6, circ = 2*Math.PI*r;
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:5 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color1}/>
            <stop offset="100%" stopColor={color2}/>
          </linearGradient>
          <filter id={id+"f"}>
            <feGaussianBlur stdDeviation="3.5" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        {/* Outer glow track */}
        <circle cx={size/2} cy={size/2} r={r+1} fill="none" stroke={color1} strokeWidth="1.5" opacity="0.18"/>
        {/* Track */}
        <circle cx={size/2} cy={size/2} r={r} fill="#060e1c" stroke="#0d1e35" strokeWidth="2"/>
        {/* Gradient ring */}
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={`url(#${id})`} strokeWidth="7"
          strokeLinecap="round" filter={`url(#${id+"f"})`}/>
        {/* Inner circle accent */}
        <circle cx={size/2} cy={size/2} r={r-7} fill="none" stroke={color1} strokeWidth="0.5" opacity="0.25"/>
        {/* Value */}
        <text x={size/2} y={size/2-5} textAnchor="middle" dominantBaseline="middle"
          fontSize={String(value).length>5?12:String(value).length>3?14:18}
          fontWeight="700" fill="#e8f4ff" fontFamily="'IBM Plex Mono',monospace">{value}</text>
        {/* Sub label */}
        {sub && <text x={size/2} y={size/2+11} textAnchor="middle" fontSize="7.5" fill={color1}
          fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.03em">{sub}</text>}
      </svg>
    </div>
  );
}

// ─── ML-STYLE HEXAGONAL SPIDER CHART ─────────────────────────────────────────
function SpiderChart({ axes, size=220 }) {
  // axes: [{label, value 0-10}]
  const cx=size/2, cy=size/2+5, R=size/2-38, n=axes.length;
  const ang = i => (i/n)*2*Math.PI - Math.PI/2;
  const pt  = (i,v) => ({ x:cx+(v/10)*R*Math.cos(ang(i)), y:cy+(v/10)*R*Math.sin(ang(i)) });
  const op  = i     => ({ x:cx+R*Math.cos(ang(i)), y:cy+R*Math.sin(ang(i)) });
  const toPath = pts => pts.map((p,i)=>`${i?"L":"M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("")+"Z";
  const dataPts = axes.map((_,i)=>pt(i,_.value));

  return (
    <svg width={size} height={size+20} viewBox={`0 0 ${size} ${size+20}`} style={{ overflow:"visible" }}>
      <defs>
        <filter id="sg">
          <feGaussianBlur stdDeviation="4" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="sg2">
          <feGaussianBlur stdDeviation="7" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <radialGradient id="sfill" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#c8f0ff" stopOpacity="0.35"/>
          <stop offset="60%" stopColor="#00c8f0" stopOpacity="0.18"/>
          <stop offset="100%" stopColor="#0066cc" stopOpacity="0.06"/>
        </radialGradient>
      </defs>

      {/* Grid rings: 25, 50, 75, 100% */}
      {[2.5,5,7.5,10].map((v,li)=>(
        <polygon key={li}
          points={axes.map((_,i)=>{const p=pt(i,v);return`${p.x.toFixed(1)},${p.y.toFixed(1)}`;}).join(" ")}
          fill={li===3?"#0a1e38":"none"}
          stroke={li===3?"#1a3f6f":"#0d2040"}
          strokeWidth={li===3?1.5:0.7} opacity="0.9"/>
      ))}

      {/* Axis spokes */}
      {axes.map((_,i)=>{const o=op(i);
        return <line key={i} x1={cx.toFixed(1)} y1={cy.toFixed(1)} x2={o.x.toFixed(1)} y2={o.y.toFixed(1)}
          stroke="#1a3f6f" strokeWidth="0.8" opacity="0.7"/>;
      })}

      {/* Data glow bg */}
      <path d={toPath(dataPts)} fill="#00c8f0" opacity="0.08" filter="url(#sg2)"/>
      {/* Data fill */}
      <path d={toPath(dataPts)} fill="url(#sfill)"/>
      {/* Data stroke */}
      <path d={toPath(dataPts)} fill="none" stroke="#00d4ff" strokeWidth="1.8" filter="url(#sg)" opacity="0.95"/>

      {/* Data dots */}
      {dataPts.map((p,i)=>(
        <g key={i}>
          <circle cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r="5" fill="#00d4ff" opacity="0.15" filter="url(#sg2)"/>
          <circle cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r="3" fill="#00d4ff" stroke="#060e1c" strokeWidth="1" filter="url(#sg)"/>
        </g>
      ))}

      {/* Labels */}
      {axes.map((ax,i)=>{
        const a=ang(i), lr=R+18;
        const lx=cx+lr*Math.cos(a), ly=cy+lr*Math.sin(a);
        const anchor=Math.abs(lx-cx)<6?"middle":lx<cx?"end":"start";
        return (
          <text key={i} x={lx.toFixed(1)} y={ly.toFixed(1)} textAnchor={anchor}
            fill="#4a80a8" fontSize="9" fontFamily="'IBM Plex Mono',monospace"
            dominantBaseline="middle">
            {ax.label}
          </text>
        );
      })}
    </svg>
  );
}

// ─── PLAN TEXT ────────────────────────────────────────────────────────────────
const G="#00ff88", R="#ff4466", C="#00d4ff", Y="#ffb800";
function PlanText({ text }) {
  return <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:12, lineHeight:1.85 }}>
    {text.split("\n").map((ln,i) => {
      if (/^#{1,3}\s/.test(ln)) {
        const clean=ln.replace(/^#+\s*/,""); const [pair="",dir=""] = clean.split(/\s*[—–\-]+\s*/);
        const du=dir.trim().toUpperCase(); const dc=du.includes("LONG")?G:du.includes("SHORT")?R:Y;
        return <div key={i} style={{ display:"flex",alignItems:"center",gap:10,margin:"18px 0 8px",padding:"10px 14px",background:`${dc}0d`,borderLeft:`3px solid ${dc}`,borderRadius:"0 6px 6px 0" }}>
          <span style={{ fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:800,color:"#e0f0ff" }}>{pair.trim()}</span>
          {du&&<span style={{ fontSize:10,fontWeight:700,padding:"2px 10px",borderRadius:20,background:`${dc}20`,color:dc,border:`1px solid ${dc}40` }}>{du}</span>}
        </div>;
      }
      if (ln.startsWith("**Confidence:**")) {
        const n=parseInt(ln.match(/(\d+)/)?.[1]||0); const cc=n>=9?G:n>=8?Y:R;
        return <div key={i} style={{ display:"flex",alignItems:"center",gap:8,margin:"4px 0",color:"#4a6a8a",fontSize:11 }}>
          <span>Confidence</span>
          <span style={{ color:cc,fontWeight:700,fontSize:14 }}>{n}/10</span>
          <div style={{ display:"flex",gap:2 }}>{[...Array(10)].map((_,x)=><div key={x} style={{ width:16,height:4,borderRadius:2,background:x<n?cc:"#0f2440" }}/>)}</div>
        </div>;
      }
      if (ln.match(/^\*\*[^*]+:\*\*/)) {
        const m=ln.match(/^\*\*([^*]+):\*\*\s*(.*)/);
        if(m){ const vc=m[1]==="Entry"?C:m[1].includes("Stop")?R:m[1].startsWith("TP")?G:null;
          return <div key={i} style={{ display:"flex",gap:8,margin:"3px 0",flexWrap:"wrap" }}>
            <span style={{ color:"#5a9abc",minWidth:90,flexShrink:0 }}>{m[1]}:</span>
            <span style={{ color:vc||"#8ab0d0",fontWeight:vc?600:400 }}>{m[2]}</span>
          </div>; }
      }
      if (ln.includes("✔")||ln.includes("✘")) {
        const items=ln.split("|").map(s=>s.trim()).filter(Boolean);
        return <div key={i} style={{ display:"flex",flexWrap:"wrap",gap:3,margin:"6px 0" }}>
          {items.map((it,j)=>{ const ok=it.startsWith("✔"); return <span key={j} style={{ fontSize:10,padding:"2px 8px",borderRadius:3,background:ok?`${G}12`:`${R}12`,border:`1px solid ${ok?G+"33":R+"33"}`,color:ok?G:R }}>{it}</span>; })}
        </div>;
      }
      if (ln.startsWith("---")) return <div key={i} style={{ height:1,background:"#0f2440",margin:"12px 0" }}/>;
      if (ln.startsWith("⛔")) return <div key={i} style={{ padding:"10px 14px",background:`${Y}0d`,border:`1px solid ${Y}30`,borderRadius:8,color:Y,margin:"10px 0",fontWeight:600 }}>{ln}</div>;
      if (!ln.trim()) return <div key={i} style={{ height:6 }}/>;
      return <div key={i} style={{ color:"#3a5a7a" }}>{ln}</div>;
    })}
  </div>;
}

// ─── JOURNAL FORM ─────────────────────────────────────────────────────────────
function JournalForm({ initial, isEdit, onSave, onCancel }) {
  const def = { pair:"",direction:"Long",entry:"",sl:"",tp1:"",tp2:"",result:"Win",pnl:"",confidence:"",timeframe:"5m",notes:"",date:new Date().toLocaleDateString("id-ID") };
  const [f,sf] = useState(()=>initial?{...def,...initial,pnl:initial.pnl!=null?String(initial.pnl):""}:{...def});
  const set=(k,v)=>sf(p=>({...p,[k]:v}));
  const ev=parseFloat(f.entry),sv=parseFloat(f.sl),t1=parseFloat(f.tp1);
  const long=f.direction==="Long",slD=long?ev-sv:sv-ev,tpD=long?t1-ev:ev-t1;
  const rr=(ev&&sv&&t1&&slD>0&&tpD>0)?tpD/slD:null,rrOk=rr?rr>=2:null;
  const onRes=v=>{set("result",v);const p=parseFloat(f.pnl);if(v==="Open"){set("pnl","");return;}if(!isNaN(p)&&p!==0){if(v==="Loss")set("pnl",String(-Math.abs(p)));if(v==="Win")set("pnl",String(Math.abs(p)));if(v==="BE")set("pnl","0");}};
  const save=()=>{let pnl=parseFloat(f.pnl)||0;if(f.result==="Loss")pnl=-Math.abs(pnl);else if(f.result==="Win")pnl=Math.abs(pnl);else if(f.result==="BE")pnl=0;else if(f.result==="Open")pnl=0;onSave({...f,pnl});};
  const rc=f.result==="Win"?G:f.result==="Loss"?R:f.result==="Open"?C:Y;
  const pv=parseFloat(f.pnl);
  const wrong=!isNaN(pv)&&pv!==0&&f.result!=="Open"&&((f.result==="Loss"&&pv>0)||(f.result==="Win"&&pv<0));
  const inp=(ex={})=>({background:"#050d1a",border:"1px solid #0f2440",color:"#c0d8f0",padding:"8px 11px",borderRadius:6,fontFamily:"'IBM Plex Mono',monospace",fontSize:11,width:"100%",outline:"none",...ex});
  const lbl={fontSize:9,color:"#5a9abc",marginBottom:4,letterSpacing:"0.1em",display:"block"};
  return (
    <div style={{ background:"#050d1a",border:`1px solid ${isEdit?Y+"44":"#0f2440"}`,borderRadius:isEdit?"0 0 8px 8px":8,padding:16,marginTop:isEdit?0:8 }}>
      <div style={{ fontSize:11,color:isEdit?Y:C,fontWeight:700,marginBottom:14,fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.08em" }}>
        {isEdit?"✎ EDIT TRADE":initial?"⚡ AUTO-FILL FROM PLAN":"+ NEW TRADE LOG"}
      </div>
      {rr&&<div style={{ padding:"7px 12px",marginBottom:12,borderRadius:6,background:rrOk?`${G}0d`:`${R}0d`,border:`1px solid ${rrOk?G+"30":R+"30"}`,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap" }}>
        <span style={{ fontSize:10,color:"#4a6a8a" }}>RR</span>
        <span style={{ fontSize:13,fontWeight:700,color:rrOk?G:R,fontFamily:"'IBM Plex Mono',monospace" }}>1:{rr.toFixed(2)}</span>
        <span style={{ fontSize:10,color:rrOk?G:R }}>{rrOk?"✔ Meets 1:2 requirement":"✘ Below 1:2 — move TP1 further"}</span>
      </div>}
      <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:8 }}>
        <div><label style={lbl}>PAIR</label><input style={inp()} value={f.pair} onChange={e=>set("pair",e.target.value)} placeholder="BTCUSDT"/></div>
        <div><label style={lbl}>ENTRY ($)</label><input style={inp()} type="number" value={f.entry} onChange={e=>set("entry",e.target.value)}/></div>
        <div><label style={lbl}>STOP LOSS ($)</label><input style={inp({borderColor:sv&&rrOk===false?R+"55":"#0f2440"})} type="number" value={f.sl} onChange={e=>set("sl",e.target.value)}/></div>
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:8 }}>
        <div><label style={{...lbl,color:rr&&!rrOk?R:"#5a9abc"}}>TP1 ($){rr&&!rrOk?" ⚠":""}</label>
          <input style={inp({borderColor:rrOk===true?G+"55":rrOk===false?R+"55":"#0f2440"})} type="number" value={f.tp1} onChange={e=>set("tp1",e.target.value)}/></div>
        <div><label style={lbl}>TP2 ($)</label><input style={inp()} type="number" value={f.tp2} onChange={e=>set("tp2",e.target.value)}/></div>
        <div><label style={lbl}>CONFIDENCE</label><input style={inp()} value={f.confidence} onChange={e=>set("confidence",e.target.value)} placeholder="8/10"/></div>
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:8 }}>
        <div><label style={lbl}>DIRECTION</label>
          <select style={inp()} value={f.direction} onChange={e=>set("direction",e.target.value)}><option>Long</option><option>Short</option></select></div>
        <div><label style={lbl}>RESULT</label>
          <select style={inp({borderColor:rc+"55",color:rc,fontWeight:600})} value={f.result} onChange={e=>onRes(e.target.value)}>
            <option style={{color:"#c0d8f0",fontWeight:"normal"}}>Win</option>
            <option style={{color:"#c0d8f0",fontWeight:"normal"}}>Loss</option>
            <option style={{color:"#c0d8f0",fontWeight:"normal"}}>BE</option>
            <option style={{color:"#c0d8f0",fontWeight:"normal"}}>Open</option>
          </select></div>
        <div><label style={lbl}>TIMEFRAME</label>
          <select style={inp()} value={f.timeframe} onChange={e=>set("timeframe",e.target.value)}>
            {["1m","3m","5m","15m"].map(o=><option key={o}>{o}</option>)}</select></div>
        <div><label style={{...lbl,color:rc}}>PnL (USDT) → {f.result==="Loss"?"NEG":f.result==="Win"?"POS":f.result==="Open"?"RUNNING":"0"}</label>
          <input style={inp({borderColor:rc+"55",color:!isNaN(pv)?(pv<0?R:pv>0?G:Y):"#c0d8f0",fontWeight:600})} type="number" value={f.pnl} onChange={e=>set("pnl",e.target.value)} placeholder={f.result==="Loss"?"-5.00":"+10.00"}/></div>
      </div>
      {wrong&&<div style={{ marginBottom:8,padding:"6px 12px",background:`${R}0d`,border:`1px solid ${R}33`,borderRadius:6,fontSize:11,color:R }}>⚠ Sign auto-corrects to {f.result==="Loss"?"-":"+"}${Math.abs(pv).toFixed(2)} on save</div>}
      <div style={{ marginBottom:12 }}>
        <label style={lbl}>NOTES</label>
        <textarea style={{...inp(),height:50,resize:"vertical"}} value={f.notes} onChange={e=>set("notes",e.target.value)} placeholder="Reason, lesson, mistake..."/>
      </div>
      <div style={{ display:"flex",gap:8 }}>
        <button onClick={save} style={{ padding:"8px 20px",background:isEdit?`${Y}22`:G,border:`1px solid ${isEdit?Y:G}`,borderRadius:6,color:isEdit?Y:"#000",fontSize:11,fontFamily:"'IBM Plex Mono',monospace",cursor:"pointer",fontWeight:700 }}>
          {isEdit?"✓ Save Changes":"✓ Save Trade"}</button>
        <button onClick={onCancel} style={{ padding:"8px 14px",background:"transparent",border:"1px solid #0f2440",borderRadius:6,color:"#4a6a8a",fontSize:11,fontFamily:"'IBM Plex Mono',monospace",cursor:"pointer" }}>Cancel</button>
      </div>
    </div>
  );
}

// ─── DELETE MODAL ─────────────────────────────────────────────────────────────
function DelModal({ trade, onConfirm, onCancel }) {
  if (!trade) return null;
  const c=trade.result==="Win"?G:trade.result==="Loss"?R:Y;
  return <div style={{ position:"fixed",inset:0,background:"#00000099",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16 }}>
    <div style={{ background:"#080f1e",border:`1px solid ${R}44`,borderRadius:12,padding:28,maxWidth:300,width:"100%",textAlign:"center" }}>
      <div style={{ fontSize:28,marginBottom:10 }}>🗑</div>
      <div style={{ fontFamily:"'Syne',sans-serif",fontSize:15,color:"#e0f0ff",fontWeight:800,marginBottom:8 }}>Delete Trade?</div>
      <div style={{ fontFamily:"'IBM Plex Mono',monospace",fontSize:12,color:"#4a6a8a",marginBottom:20,lineHeight:1.9 }}>
        <span style={{ color:"#e0f0ff",fontWeight:600 }}>{trade.pair}</span> · {trade.direction} · <span style={{ color:c,fontWeight:600 }}>{trade.result} {trade.pnl>=0?"+":""}{(trade.pnl||0).toFixed(2)}</span>
        <br/><span style={{ fontSize:10 }}>Cannot be undone.</span>
      </div>
      <div style={{ display:"flex",gap:8,justifyContent:"center" }}>
        <button onClick={onConfirm} style={{ padding:"8px 22px",background:`${R}22`,border:`1px solid ${R}`,borderRadius:6,color:R,fontSize:11,fontFamily:"'IBM Plex Mono',monospace",cursor:"pointer",fontWeight:700 }}>Delete</button>
        <button onClick={onCancel} style={{ padding:"8px 18px",background:"transparent",border:"1px solid #0f2440",borderRadius:6,color:"#4a6a8a",fontSize:11,fontFamily:"'IBM Plex Mono',monospace",cursor:"pointer" }}>Cancel</button>
      </div>
    </div>
  </div>;
}


// ─── PnL CALENDAR HEATMAP ─────────────────────────────────────────────────────
function PnLCalendar({ journal }) {
  const now = new Date();
  const [viewYear,  setViewYear]  = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0-indexed

  const DAYS = ["S","M","T","W","T","F","S"];
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // Group by day key "YYYY-M-D"
  const dayMap = {};
  journal.forEach(t => {
    if (!t.date || t.result === "Open") return;
    const parts = t.date.split("/");
    const d=parseInt(parts[0]), m=parseInt(parts[1]), y=parseInt(parts[2]||2026);
    if (y===viewYear && m===viewMonth+1) {
      if (!dayMap[d]) dayMap[d] = { pnl:0, count:0 };
      dayMap[d].pnl   += t.pnl || 0;
      dayMap[d].count += 1;
    }
  });

  const daysInMonth   = new Date(viewYear, viewMonth+1, 0).getDate();
  const firstWeekday  = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
  const maxAbsPnl     = Math.max(...Object.values(dayMap).map(d=>Math.abs(d.pnl)), 1);

  const prevMonth = () => { if(viewMonth===0){setViewMonth(11);setViewYear(y=>y-1);}else setViewMonth(m=>m-1); };
  const nextMonth = () => { if(viewMonth===11){setViewMonth(0);setViewYear(y=>y+1);}else setViewMonth(m=>m+1); };

  const cells = [];
  for (let i=0; i<firstWeekday; i++) cells.push(null);
  for (let d=1; d<=daysInMonth; d++) cells.push(d);

  return (
    <div style={{ background:"#070d1a", border:"1px solid #0d2040", borderRadius:10, overflow:"hidden" }}>
      {/* Header */}
      <div style={{ padding:"10px 16px", borderBottom:"1px solid #0d2040", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <button onClick={prevMonth} style={{ background:"transparent", border:"1px solid #0f2440", borderRadius:5, color:"#4a6a8a", fontSize:14, padding:"2px 10px", cursor:"pointer", fontFamily:"inherit" }}>‹</button>
        <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:12, color:"#c0d8f0", letterSpacing:"0.08em" }}>
          {MONTHS[viewMonth]} {viewYear}
        </span>
        <button onClick={nextMonth} style={{ background:"transparent", border:"1px solid #0f2440", borderRadius:5, color:"#4a6a8a", fontSize:14, padding:"2px 10px", cursor:"pointer", fontFamily:"inherit" }}>›</button>
      </div>

      <div style={{ padding:"12px 10px" }}>
        {/* Weekday headers */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4, marginBottom:6 }}>
          {DAYS.map((d,i)=><div key={i} style={{ textAlign:"center", fontSize:10, color:"#5a9abc", fontWeight:600 }}>{d}</div>)}
        </div>

        {/* Day cells */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:5 }}>
          {cells.map((day, i) => {
            if (!day) return <div key={i}/>;
            const data     = dayMap[day];
            const hasTrade = !!data;
            const pnl      = data?.pnl || 0;
            const isPos    = pnl >= 0;
            const intensity = hasTrade ? Math.min(0.25 + (Math.abs(pnl)/maxAbsPnl)*0.55, 0.85) : 0;

            let bg = "transparent", border = "1px solid #0a1628";
            if (hasTrade) {
              bg     = isPos ? `rgba(0,200,100,${intensity})` : `rgba(220,50,60,${intensity})`;
              border = `1px solid ${isPos?"#00c06040":"#dd324040"}`;
            }
            const isToday = day===now.getDate() && viewMonth===now.getMonth() && viewYear===now.getFullYear();

            return (
              <div key={i} title={hasTrade?`${data.count} trade(s): ${pnl>=0?"+":""}${pnl.toFixed(4)} USDT`:""} style={{
                background: bg, border: isToday?"1px solid #00d4ff44":border,
                borderRadius: 7, padding:"6px 5px 5px", minHeight:54,
                display:"flex", flexDirection:"column", justifyContent:"space-between",
              }}>
                <span style={{ fontSize:15, fontWeight:700, color: hasTrade?"#e0f0ff":"#5a9abc", lineHeight:1 }}>{day}</span>
                {hasTrade && (
                  <span style={{ fontSize:9, fontWeight:700, color:isPos?"#00ff88":"#ff4466", lineHeight:1, textAlign:"right" }}>
                    {isPos?"+":""}{pnl.toFixed(4)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div style={{ padding:"8px 16px", borderTop:"1px solid #0d2040", display:"flex", gap:16, fontSize:9, color:"#5a9abc", alignItems:"center" }}>
        <div style={{ display:"flex",gap:4,alignItems:"center" }}>
          <div style={{ width:10,height:10,borderRadius:2,background:"rgba(0,200,100,0.5)" }}/> Profit
        </div>
        <div style={{ display:"flex",gap:4,alignItems:"center" }}>
          <div style={{ width:10,height:10,borderRadius:2,background:"rgba(220,50,60,0.5)" }}/> Loss
        </div>
        <div style={{ display:"flex",gap:4,alignItems:"center" }}>
          <div style={{ width:10,height:10,borderRadius:2,background:"#0a1628",border:"1px solid #1a3a5c" }}/> No trade
        </div>
        <span style={{ marginLeft:"auto" }}>Hover for details</span>
      </div>
    </div>
  );
}

// ─── P&L RANKING BY PAIR ──────────────────────────────────────────────────────
function PairRanking({ journal }) {
  const byPair = {};
  journal.forEach(t => {
    if (!t.pair || t.result==="Open") return;
    if (!byPair[t.pair]) byPair[t.pair] = { pnl:0, trades:0, wins:0 };
    byPair[t.pair].pnl    += t.pnl || 0;
    byPair[t.pair].trades += 1;
    if (t.result==="Win") byPair[t.pair].wins++;
  });

  const sorted = Object.entries(byPair).sort((a,b)=>b[1].pnl-a[1].pnl);
  if (!sorted.length) return null;
  const maxAbs = Math.max(...sorted.map(([,d])=>Math.abs(d.pnl)), 1);

  return (
    <div style={{ background:"#070d1a", border:"1px solid #0d2040", borderRadius:10, overflow:"hidden" }}>
      <div style={{ padding:"10px 16px", borderBottom:"1px solid #0d2040", display:"flex", justifyContent:"space-between" }}>
        <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:11, color:"#c0d8f0", letterSpacing:"0.06em" }}>P&L RANKING</span>
        <span style={{ fontSize:9, color:"#5a9abc" }}>by pair · {sorted.length} contracts</span>
      </div>
      <div style={{ padding:"10px 0" }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", padding:"0 16px 6px", borderBottom:"1px solid #0a1a2e" }}>
          <span style={{ fontSize:9, color:"#4a7a9a", letterSpacing:"0.08em" }}>Contracts</span>
          <span style={{ fontSize:9, color:"#4a7a9a", letterSpacing:"0.08em", textAlign:"right" }}>P&L (USDT)</span>
        </div>
        {sorted.map(([pair, data], i) => {
          const isPos = data.pnl >= 0;
          const barW  = Math.abs(data.pnl) / maxAbs * 100;
          const wr    = data.trades > 0 ? Math.round(data.wins/data.trades*100) : 0;
          return (
            <div key={i} style={{ padding:"8px 16px", borderBottom:"1px solid #0a1a2e", display:"grid", gridTemplateColumns:"1fr auto", alignItems:"center", gap:8 }}>
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                  <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:12, color:"#e0f0ff" }}>{pair}</span>
                  <span style={{ fontSize:9, color:"#5a9abc" }}>{data.trades}T · {wr}%WR</span>
                </div>
                {/* Bar */}
                <div style={{ height:5, background:"#0a1628", borderRadius:3, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:barW+"%", background:isPos?"#00c060":"#dd3244", borderRadius:3, transition:"width 0.3s" }}/>
                </div>
              </div>
              <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:13, fontWeight:700, color:isPos?"#00ff88":"#ff4466", textAlign:"right", fontVariantNumeric:"tabular-nums", minWidth:60 }}>
                {isPos?"+":""}{data.pnl.toFixed(4)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  // Config
  const [capital, setCap] = useState("500");
  const [risk,    setRisk]= useState("1");
  const [lev,     setLev] = useState("10");
  const [tf,      setTf]  = useState("5m");
  const [sess,    setSess]= useState("Asia");
  const [tab,     setTab] = useState("plan");
  const [statsPeriod,  setStatsPeriod]  = useState("all");
  const [customFrom,   setCustomFrom]   = useState("");
  const [customTo,     setCustomTo]     = useState("");

  // Wallet
  const [wallet,      setWallet]     = useState({ initial:500 });
  const [editWallet,  setEditWallet] = useState(false);
  const [walletInput, setWalletInput]= useState("500");

  // Prices (realtime)
  const [prices, setPrices] = useState(
    Object.fromEntries(COIN_CFG.map(c=>[c.p, {
      price: c.fallback, ch: 0, oi: "—", fr: "—", vol: "—", loading: true
    }]))
  );
  const [priceAge, setPriceAge] = useState(null);
  const [fetchErr, setFetchErr] = useState(false);

  // Plan
  const [plan,      setPlan]     = useState("");
  const [planSetups,setPSetups]  = useState([]);
  const [planMeta,  setPMeta]    = useState(null);
  const [addedKeys, setAddedKeys]= useState(new Set());
  const [loading,   setLoading]  = useState(false);
  const [stream,    setStream]   = useState("");
  const streamRef = useRef("");

  // Journal
  const [journal,   setJournal]  = useState([]);
  const [jLoaded,   setJLoaded]  = useState(false);
  const [editIdx,   setEditIdx]  = useState(null);
  const [formKey,   setFormKey]  = useState(0);
  const [delIdx,    setDelIdx]   = useState(null);
  const [showAdd,   setShowAdd]  = useState(false);
  const [addKey,    setAddKey]   = useState(0);
  const [addInit,   setAddInit]  = useState(null);
  const [expandIdx, setExpandIdx]= useState(null);

  // Load persisted data
  useEffect(()=>{
    jLoad().then(d=>{
      if(d.length===0){const s=[...SEED_TRADES];setJournal(s);jSave(s);}
      else setJournal(d);
      setJLoaded(true);
    });
    wLoad().then(d=>{setWallet(d);setWalletInput(String(d.initial));});
  },[]);

  // ── Real-time prices via Bybit Perpetual API (linear) ───────────────────────
  const [dataSource, setDataSource] = useState("loading"); // "bybit"|"binance"|"static"

  const fmtNum = (n, K=1e3, M=1e6, B=1e9) =>
    n>B?(n/B).toFixed(2)+"B":n>M?(n/M).toFixed(2)+"M":n>K?(n/K).toFixed(1)+"K":n.toFixed(0);

  const applyBybit = (list) => {
    const map = {};
    list.forEach(t => { map[t.symbol] = t; });
    setPrices(prev => {
      const next = { ...prev };
      COIN_CFG.forEach(c => {
        const t = map[c.p]; if (!t) return;
        const price=parseFloat(t.lastPrice), ch=parseFloat(t.price24hPcnt)*100;
        const fr=parseFloat(t.fundingRate||0)*100, oi=parseFloat(t.openInterest||0), vol=parseFloat(t.volume24h||0);
        next[c.p] = { price, ch:parseFloat(ch.toFixed(2)),
          fr:(fr>=0?"+":"")+fr.toFixed(4)+"%", frRaw:fr,
          oi:fmtNum(oi), vol:fmtNum(vol),
          bid:t.bid1Price?parseFloat(t.bid1Price):null,
          ask:t.ask1Price?parseFloat(t.ask1Price):null,
          high:t.highPrice24h?parseFloat(t.highPrice24h):null,
          low:t.lowPrice24h?parseFloat(t.lowPrice24h):null,
          loading:false };
      });
      return next;
    });
  };

  const applyBinance = (list) => {
    const map = {};
    list.forEach(t => { map[t.symbol] = t; });
    setPrices(prev => {
      const next = { ...prev };
      COIN_CFG.forEach(c => {
        const t = map[c.p]; if (!t) return;
        const price=parseFloat(t.lastPrice), ch=parseFloat(t.priceChangePercent);
        const vol=parseFloat(t.quoteVolume||0);
        next[c.p] = { ...next[c.p], price, ch:parseFloat(ch.toFixed(2)),
          vol:fmtNum(vol), loading:false };
      });
      return next;
    });
  };

  const fetchPrices = useCallback(async () => {
    const timeout = (ms) => new Promise((_,r)=>setTimeout(()=>r(new Error("timeout")),ms));

    // ── 1. Try Bybit ──────────────────────────────────────────────────────────
    try {
      setFetchErr(false);
      const res = await Promise.race([
        fetch("https://api.bybit.com/v5/market/tickers?category=linear"),
        timeout(6000)
      ]);
      if (!res.ok) throw new Error("Bybit HTTP "+res.status);
      const data = await res.json();
      if (data.retCode !== 0) throw new Error(data.retMsg);
      applyBybit(data.result.list);
      setDataSource("bybit");
      setPriceAge(new Date());
      return;
    } catch (e1) { console.warn("Bybit failed:", e1.message); }

    // ── 2. Try Binance ────────────────────────────────────────────────────────
    try {
      const syms = COIN_CFG.map(c=>c.p).filter(s=>s!=="HYPEUSDT"); // Binance may lack HYPE
      const res = await Promise.race([
        fetch("https://api.binance.com/api/v3/ticker/24hr?symbols="+encodeURIComponent(JSON.stringify(syms))),
        timeout(5000)
      ]);
      if (!res.ok) throw new Error("Binance HTTP "+res.status);
      const list = await res.json();
      applyBinance(list);
      setDataSource("binance");
      setFetchErr(false);
      setPriceAge(new Date());
      return;
    } catch (e2) { console.warn("Binance failed:", e2.message); }

    // ── 3. Static fallback ────────────────────────────────────────────────────
    setFetchErr(true);
    setDataSource("static");
    setPrices(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => { if (next[k].loading) next[k] = { ...next[k], loading: false }; });
      return next;
    });
  }, []);

  useEffect(() => {
    fetchPrices();
    const iv = setInterval(fetchPrices, 15000); // refresh every 15s
    return () => clearInterval(iv);
  }, [fetchPrices]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const sync = d => { setJournal(d); jSave(d); };
  const riskU = ((parseFloat(capital)||0)*(parseFloat(risk)||1)/100).toFixed(2);
  const wins  = journal.filter(j=>j.result==="Win");
  const losses= journal.filter(j=>j.result==="Loss");
  const bes   = journal.filter(j=>j.result==="BE");
  const openTrades = journal.filter(j=>j.result==="Open");
  const closedTrades = journal.filter(j=>j.result!=="Open");
  const wr    = closedTrades.length>0?Math.round(wins.length/closedTrades.length*100):null;
  const totalPnl = journal.filter(j=>j.result!=="Open").reduce((s,j)=>s+(j.pnl||0),0);
  const bestWin  = wins.length>0?Math.max(...wins.map(j=>j.pnl||0)):0;
  const metrics  = calcMetrics(journal, parseFloat(riskU)||5);
  const currentBalance = wallet.initial + totalPnl;
  const balanceGrowth  = wallet.initial>0 ? ((totalPnl/wallet.initial)*100).toFixed(2) : "0.00";

  // ── Journal actions ───────────────────────────────────────────────────────
  const openEdit=idx=>{if(editIdx===idx){setEditIdx(null);return;}setEditIdx(idx);setFormKey(k=>k+1);setShowAdd(false);setExpandIdx(idx);};
  const openAdd=(init=null)=>{setAddInit(init);setAddKey(k=>k+1);setShowAdd(true);setEditIdx(null);};
  const addTrade=e=>{const u=[e,...journal];sync(u);setShowAdd(false);setAddInit(null);};
  const updateTrade=(idx,e)=>{const u=journal.map((t,i)=>i===idx?e:t);sync(u);setEditIdx(null);};
  const confirmDel=()=>{if(delIdx===null)return;const u=journal.filter((_,i)=>i!==delIdx);sync(u);if(editIdx===delIdx)setEditIdx(null);setDelIdx(null);};
  const handleQuickAdd=s=>{openAdd({pair:s.pair,direction:s.direction,entry:s.entry,sl:s.sl,tp1:s.tp1,tp2:s.tp2,confidence:s.confidenceStr,timeframe:tf,notes:s.setup?"Setup: "+s.setup+(s.timeLimit?" | "+s.timeLimit:""):""});setAddedKeys(p=>new Set([...p,s.pair+s.direction]));setTab("journal");setTimeout(()=>window.scrollTo({top:0,behavior:"smooth"}),60);};
  const saveWallet=()=>{const d={initial:parseFloat(walletInput)||0};setWallet(d);wSave(d);setEditWallet(false);};

  // ── Generate plan ──────────────────────────────────────────────────────────
  const generate=async()=>{
    setLoading(true);setPlan("");setStream("");setPSetups([]);setAddedKeys(new Set());setTab("plan");
    streamRef.current="";const t0=Date.now();
    try{
      const lCtx=losses.slice(-3).map(l=>`- ${l.pair} ${l.direction}: "${l.notes||"no notes"}" → ${(l.pnl||0).toFixed(2)}`).join("\n");
      const liveMarket=COIN_CFG.map(c=>`- ${c.p}: $${prices[c.p]?.price?.toFixed(2)||c.fallback} | 24h:${prices[c.p]?.ch?.toFixed(2)||0}%`).join("\n");
      const ctx=`MARKET LIVE:\nMacro: ${MACRO}\n${liveMarket}\nPARAM: $${capital} | Risk ${risk}%=$${riskU} | ${lev}x | ${tf} | ${sess}\nSTATS: ${journal.length} trades | WR:${wr??0}% | PnL:$${totalPnl.toFixed(4)}\n${losses.length?"LOSS TERKINI:\n"+lCtx:""}\nBerikan plan. Maks 3 setup, confidence ≥8, RR ≥1:2.`;
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},headers:{"Content-Type":"application/json","x-api-key":import.meta.env.VITE_ANTHROPIC_API_KEY||"","anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,system:SYSTEM,messages:[{role:"user",content:ctx}]})});
      const data=await res.json();
      const text=data.content?.map(b=>b.text||"").join("")||"⚠️ No response.";
      let i=0;const iv=setInterval(()=>{if(i<text.length){streamRef.current+=text[i];setStream(streamRef.current);i+=8;}else{clearInterval(iv);setPlan(text);setStream("");setPSetups(parseSetups(text));setPMeta({time:new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"}),sess,elapsed:((Date.now()-t0)/1000).toFixed(1)});setLoading(false);}},14);
    }catch{setPlan("⚠️ Connection failed.");setLoading(false);}
  };

  const displayText = loading?stream:plan;

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100vh", background:"#060b14", color:"#8ab0d0", fontFamily:"'IBM Plex Mono',monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=Syne:wght@700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-thumb{background:#0f2440;border-radius:2px}
        select,input,textarea{background:#050d1a;border:1px solid #0f2440;color:#c0d8f0;border-radius:6px;font-family:'IBM Plex Mono',monospace;outline:none;transition:border-color 0.15s}
        select:focus,input:focus,textarea:focus{border-color:#00d4ff55}
        select option{background:#080f1e}
        .tab{padding:10px 18px;font-size:10px;font-family:'IBM Plex Mono',monospace;cursor:pointer;background:transparent;border:none;color:#2a4a6a;border-bottom:2px solid transparent;letter-spacing:0.1em;text-transform:uppercase;font-weight:600;transition:all 0.15s}
        .tab:hover{color:#5b8db8}
        .tab.on{color:#00d4ff;border-bottom-color:#00d4ff}
        .pulse{animation:pulse 2s ease-in-out infinite}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
        .gold-shimmer{background:linear-gradient(90deg,#b8860b 0%,#ffd700 25%,#fff0a0 50%,#ffd700 75%,#b8860b 100%);background-size:250% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:shimmer 2.2s linear infinite}
        @keyframes shimmer{to{background-position:-250% center}}
        .gold-card{box-shadow:0 0 20px #ffd70020,inset 0 0 40px #ffd70008!important;border-color:#ffd70030!important}
        .gbg{position:fixed;inset:0;background-image:linear-gradient(#00d4ff06 1px,transparent 1px),linear-gradient(90deg,#00d4ff06 1px,transparent 1px);background-size:40px 40px;pointer-events:none;z-index:0}
        .z1{position:relative;z-index:1}
        .card{background:#080f1e;border:1px solid #0f2440;border-radius:10px}
        .jrow:hover{background:#0a1628!important}
        @media(max-width:700px){.grid-plan{grid-template-columns:1fr!important}.no-mob{display:none!important}}
      `}</style>

      <div className="gbg"/>
      <div className="z1" style={{ maxWidth:1100, margin:"0 auto", padding:"0 16px 40px" }}>

        {/* ── HEADER ── */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"16px 0 12px", borderBottom:"1px solid #0a1628", flexWrap:"wrap", gap:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div className="pulse" style={{ width:7,height:7,borderRadius:"50%",background:"#00d4ff",boxShadow:"0 0 10px #00d4ff" }}/>
            <span style={{ fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:20,color:"#e0f0ff",letterSpacing:"-0.02em" }}>
              Scalp<span style={{ color:"#00d4ff" }}>Desk</span>
            </span>
            <span style={{ fontSize:9,color:"#4a7a9a",letterSpacing:"0.15em" }}>BYBIT PERPETUAL · NATHAN</span>
          </div>
          <div style={{ display:"flex", gap:0 }}>
            {["plan","journal","market","stats"].map(t=>(
              <button key={t} className={`tab${tab===t?" on":""}`} onClick={()=>setTab(t)}>
                {t==="journal"?`Journal (${journal.length})`:t.charAt(0).toUpperCase()+t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* ── LIVE TICKER — Bybit Perpetual ── */}
        <div style={{ borderBottom:"1px solid #0a1628" }}>
          {/* Status bar */}
          <div style={{ display:"flex", alignItems:"center", gap:10, padding:"4px 4px 0", justifyContent:"space-between" }}>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div className={fetchErr ? "" : "pulse"} style={{ width:5,height:5,borderRadius:"50%",background:fetchErr?"#ff4466":"#00ff88",boxShadow:fetchErr?"0 0 6px #ff4466":"0 0 6px #00ff88" }}/>
              <span style={{ fontSize:8,color:fetchErr?"#ff4466":"#00c060",letterSpacing:"0.12em",fontWeight:600 }}>
                {dataSource==="bybit"?"BYBIT PERPETUAL — LIVE":dataSource==="binance"?"BINANCE — LIVE (BYBIT UNAVAILABLE)":"STATIC DATA — API UNAVAILABLE"}
              </span>
              {priceAge&&!fetchErr&&(
                <span style={{ fontSize:8,color:"#4a7a9a" }}>· updated {priceAge.toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</span>
              )}
            </div>
            <button onClick={fetchPrices} title="Refresh prices"
              style={{ background:"transparent",border:"1px solid #0f2440",borderRadius:4,color:"#5a9abc",fontSize:9,padding:"2px 8px",cursor:"pointer",fontFamily:"inherit",lineHeight:1.6 }}>
              ↺ Refresh
            </button>
          </div>
          {/* Ticker coins */}
          <div style={{ display:"flex", gap:0, overflowX:"auto", scrollbarWidth:"none" }}>
            {COIN_CFG.map(c => {
              const d=prices[c.p];
              const up=(d?.ch||0)>=0;
              const frNum=d?.frRaw??0;
              const frColor=frNum>0.01?"#ff8800":frNum<-0.01?"#00aaff":"#5b8db8";
              const fmtPrice=(p)=>{
                if(!p) return "···";
                if(p>=10000) return p.toLocaleString("en-US",{maximumFractionDigits:0});
                if(p>=100)   return p.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
                if(p>=1)     return p.toLocaleString("en-US",{minimumFractionDigits:3,maximumFractionDigits:3});
                return p.toLocaleString("en-US",{minimumFractionDigits:5,maximumFractionDigits:5});
              };
              return (
                <div key={c.s} style={{ flexShrink:0,padding:"8px 16px",borderRight:"1px solid #0a1628" }}>
                  {/* Symbol + price */}
                  <div style={{ display:"flex",alignItems:"baseline",gap:7,marginBottom:3 }}>
                    <span style={{ fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:11,color:"#e0f0ff" }}>{c.s}</span>
                    <span style={{ fontSize:13,color:"#e0f0ff",fontVariantNumeric:"tabular-nums",fontWeight:600 }}>
                      {d?.loading ? <span style={{ color:"#4a7a9a" }}>···</span> : fmtPrice(d?.price)}
                    </span>
                    <span style={{ fontSize:10,color:up?"#00ff88":"#ff4466",fontWeight:700 }}>
                      {up?"▲":"▼"}{Math.abs(d?.ch||0).toFixed(2)}%
                    </span>
                  </div>
                  {/* OI + FR row */}
                  <div style={{ display:"flex",gap:10,fontSize:8,color:"#5a9abc" }}>
                    {d?.oi&&d.oi!=="—"&&<span>OI <span style={{ color:"#3a6080" }}>{d.oi}</span></span>}
                    {d?.fr&&d.fr!=="—"&&<span>FR <span style={{ color:frColor,fontWeight:600 }}>{d.fr}</span></span>}
                    {d?.vol&&d.vol!=="—"&&<span>Vol <span style={{ color:"#5a9abc" }}>{d.vol}</span></span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── PLAN TAB ── */}
        {tab==="plan"&&(
          <div style={{ display:"grid", gridTemplateColumns:"260px 1fr", gap:16, marginTop:16, alignItems:"start" }} className="grid-plan">
            {/* Config */}
            <div className="card" style={{ padding:16 }}>
              <div style={{ fontSize:9,color:"#4a7a9a",letterSpacing:"0.15em",marginBottom:14 }}>PARAMETERS</div>
              <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
                {[["Capital (USDT)","number",capital,setCap],["Leverage","number",lev,setLev]].map(([l,t,v,s])=>(
                  <div key={l}><div style={{ fontSize:9,color:"#5a9abc",marginBottom:4 }}>{l}</div>
                    <input type={t} value={v} onChange={e=>s(e.target.value)} style={{ padding:"8px 11px",fontSize:11,width:"100%" }}/></div>
                ))}
                {[["Risk %","risk",[["0.5","0.5% Conservative"],["1","1% Moderate"],["2","2% Aggressive"]],risk,setRisk],
                  ["Entry TF","tf",[["1m","1m"],["3m","3m"],["5m","5m"],["15m","15m"]],tf,setTf],
                  ["Session","sess",[["Asia","Asia"],["London","London"],["New York","New York"],["Overlap","Overlap"]],sess,setSess]
                ].map(([l,k,opts,v,s])=>(
                  <div key={k}><div style={{ fontSize:9,color:"#5a9abc",marginBottom:4 }}>{l}</div>
                    <select value={v} onChange={e=>s(e.target.value)} style={{ padding:"8px 11px",fontSize:11,width:"100%" }}>
                      {opts.map(([val,lbl])=><option key={val} value={val}>{lbl}</option>)}</select></div>
                ))}
                <div style={{ padding:"10px 12px",background:"#050d1a",borderRadius:6,border:"1px solid #0f2440" }}>
                  <div style={{ fontSize:9,color:"#5a9abc",fontWeight:600,marginBottom:3 }}>Risk per Trade</div>
                  <div style={{ fontSize:16,fontWeight:700,color:Y }}>${riskU} USDT</div>
                </div>
                <div style={{ height:1,background:"#0f2440" }}/>
                <button onClick={generate} disabled={loading} style={{ padding:"11px",background:loading?"#0a1628":C,border:`1px solid ${loading?"#0f2440":C}`,borderRadius:8,color:loading?"#5a9abc":"#000",fontSize:12,fontFamily:"'Syne',sans-serif",cursor:loading?"not-allowed":"pointer",fontWeight:800 }}>
                  {loading?<span className="pulse">◌ Analyzing...</span>:"▶  Get Plan"}</button>
                {plan&&!loading&&<div style={{ display:"flex",gap:6 }}>
                  <button onClick={()=>navigator.clipboard.writeText(plan)} style={{ flex:1,padding:"7px",background:"transparent",border:"1px solid #0f2440",borderRadius:6,color:"#4a6a8a",fontSize:10,fontFamily:"inherit",cursor:"pointer" }}>⎘ Copy</button>
                  <button onClick={generate} style={{ flex:1,padding:"7px",background:"transparent",border:`1px solid ${C}33`,borderRadius:6,color:C,fontSize:10,fontFamily:"inherit",cursor:"pointer" }}>↺ Refresh</button>
                </div>}
              </div>
            </div>
            {/* Plan output */}
            <div className="card" style={{ padding:20, minHeight:400 }}>
              {!plan&&!loading&&<div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:380,gap:12,color:"#0f2440" }}>
                <div style={{ fontSize:48 }}>◈</div>
                <div style={{ fontSize:10,letterSpacing:"0.2em",color:"#5a9abc" }}>SET PARAMETERS AND CLICK GET PLAN</div>
              </div>}
              {displayText&&<>
                {planMeta&&!loading&&<div style={{ display:"flex",gap:14,fontSize:10,color:"#4a7a9a",marginBottom:16,flexWrap:"wrap" }}>
                  <span>Generated {planMeta.time}</span><span>·</span><span>{planMeta.sess}</span><span>·</span><span>{planMeta.elapsed}s</span>
                </div>}
                <PlanText text={displayText}/>
                {!loading&&planSetups.length>0&&(
                  <div style={{ marginTop:20,border:`1px solid ${C}22`,borderRadius:10,overflow:"hidden" }}>
                    <div style={{ background:`${C}0d`,padding:"8px 14px",fontSize:9,color:C,letterSpacing:"0.12em" }}>⚡ {planSetups.length} VALID SETUP — QUICK ADD TO JOURNAL</div>
                    {planSetups.map((s,i)=>{
                      const done=addedKeys.has(s.pair+s.direction); const dc=s.direction==="Long"?G:R; const cc=s.confidence>=9?G:Y;
                      return <div key={i} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderTop:"1px solid #0f2440",background:"#060b14",flexWrap:"wrap",gap:8 }}>
                        <div style={{ display:"flex",gap:8,alignItems:"center",flexWrap:"wrap" }}>
                          <span style={{ fontFamily:"'Syne',sans-serif",fontWeight:800,color:"#e0f0ff",fontSize:13 }}>{s.pair}</span>
                          <span style={{ fontSize:10,padding:"2px 9px",borderRadius:20,background:`${dc}18`,border:`1px solid ${dc}44`,color:dc,fontWeight:600 }}>{s.direction}</span>
                          <span style={{ fontSize:10,padding:"2px 9px",borderRadius:20,background:`${cc}12`,color:cc,border:`1px solid ${cc}30`,fontWeight:600 }}>★ {s.confidenceStr}</span>
                          <span style={{ fontSize:11,color:"#5a9abc",display:"flex",gap:10 }}>
                            {s.entry&&<span>E:<span style={{ color:C }}> ${s.entry}</span></span>}
                            {s.sl&&<span>SL:<span style={{ color:R }}> ${s.sl}</span></span>}
                            {s.tp1&&<span>TP1:<span style={{ color:G }}> ${s.tp1}</span></span>}
                          </span>
                        </div>
                        {done?<span style={{ fontSize:10,color:"#4a7a9a" }}>✓ Added</span>
                          :<button onClick={()=>handleQuickAdd(s)} style={{ padding:"6px 16px",background:`${G}22`,border:`1px solid ${G}55`,borderRadius:6,color:G,fontSize:11,fontFamily:"inherit",cursor:"pointer",fontWeight:700 }}>Add to Journal</button>}
                      </div>;
                    })}
                  </div>
                )}
                {!loading&&<div style={{ marginTop:14,paddingTop:12,borderTop:"1px solid #0f2440" }}>
                  <button onClick={()=>{openAdd();setTab("journal");}} style={{ padding:"7px 16px",background:"transparent",border:`1px solid ${G}33`,borderRadius:6,color:G,fontSize:10,fontFamily:"inherit",cursor:"pointer",fontWeight:600 }}>+ Log Manual</button>
                </div>}
              </>}
            </div>
          </div>
        )}

        {/* ── JOURNAL TAB ── */}
        {tab==="journal"&&(
          <div style={{ marginTop:16 }}>
            {/* Wallet + quick stats */}
            <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14 }}>
              {/* Win Rate — gold if >60%, green 50-60%, red <50% */}
              {(()=>{
                const isGold = wr!=null && wr > 60;
                const isGreen= wr!=null && wr >= 50 && wr <= 60;
                const isRed  = wr!=null && wr < 50;
                return (
                  <div className={isGold?"card gold-card":"card"} style={{ padding:"12px 14px",
                    background: isGold?"linear-gradient(135deg,#0e1a06,#12200a)":"",
                    position:"relative", overflow:"hidden" }}>
                    {isGold&&<div style={{ position:"absolute",inset:0,background:"radial-gradient(ellipse at 50% 0%,#ffd70015 0%,transparent 70%)",pointerEvents:"none" }}/>}
                    <div style={{ fontSize:9,letterSpacing:"0.1em",marginBottom:5,fontWeight:600,
                      color: isGold?"#c8a000":isGreen?"#3a8060":isRed?"#8a1a2a":"#1a3a5c" }}>
                      WIN RATE {isGold?"★":""}
                    </div>
                    {wr!=null
                      ? isGold
                        ? <div className="gold-shimmer" style={{ fontSize:20,fontWeight:900,fontVariantNumeric:"tabular-nums" }}>{wr}%</div>
                        : <div style={{ fontSize:20,fontWeight:800,color:isGreen?G:isRed?R:Y,fontVariantNumeric:"tabular-nums" }}>{wr}%</div>
                      : <div style={{ fontSize:20,fontWeight:800,color:"#4a7a9a" }}>—</div>
                    }
                    {wr!=null&&(
                      <div style={{ fontSize:8,marginTop:3,
                        color: isGold?"#c8a000":isGreen?"#3a8060":isRed?"#8a1a2a":"#5a9abc" }}>
                        {isGold?"🏆 Excellent":isGreen?"On Track":isRed?"⚠ Needs Work":"—"}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Total PnL */}
              <div className="card" style={{ padding:"12px 14px" }}>
                <div style={{ fontSize:9,color:"#5a9abc",letterSpacing:"0.08em",fontWeight:600,marginBottom:6 }}>TOTAL PnL</div>
                <div style={{ fontSize:16,fontWeight:700,color:totalPnl>0?G:totalPnl<0?R:"#1a3a5c",fontVariantNumeric:"tabular-nums" }}>
                  {totalPnl>=0?"+":""}{totalPnl.toFixed(4)} <span style={{ fontSize:9 }}>USDT</span>
                </div>
              </div>

              {/* W / L / BE */}
              <div className="card" style={{ padding:"12px 14px" }}>
                <div style={{ fontSize:9,color:"#5a9abc",letterSpacing:"0.08em",fontWeight:600,marginBottom:6 }}>W / L / BE / Open</div>
                <div style={{ fontSize:14,fontWeight:700,fontVariantNumeric:"tabular-nums",display:"flex",gap:6,alignItems:"center" }}>
                  <span style={{ color:G }}>{wins.length}</span>
                  <span style={{ color:"#4a7a9a" }}>/</span>
                  <span style={{ color:R }}>{losses.length}</span>
                  <span style={{ color:"#4a7a9a" }}>/</span>
                  <span style={{ color:Y }}>{bes.length}</span>
                  {journal.filter(j=>j.result==="Open").length>0&&<>
                    <span style={{ color:"#4a7a9a" }}>/</span>
                    <span style={{ color:C }}>{journal.filter(j=>j.result==="Open").length}</span>
                  </>}
                </div>
              </div>

              {/* Stop Rule */}
              <div className="card" style={{ padding:"12px 14px" }}>
                <div style={{ fontSize:9,color:"#5a9abc",letterSpacing:"0.08em",fontWeight:600,marginBottom:6 }}>STOP RULE</div>
                <div style={{ fontSize:14,fontWeight:700,color:losses.slice(-2).length>=2?R:G }}>
                  {losses.slice(-2).length>=2?"⛔ STOP":"✓ Active"}
                </div>
                <div style={{ fontSize:8,color:"#4a7a9a",marginTop:3 }}>
                  {losses.slice(-2).length>=2?"2 consec. losses":"Trading OK"}
                </div>
              </div>
            </div>
            <div style={{ marginBottom:12,display:"flex",gap:8 }}>
              <button onClick={()=>{if(showAdd){setShowAdd(false);}else openAdd();}}
                style={{ padding:"8px 16px",background:showAdd?`${R}15`:`${G}15`,border:`1px solid ${showAdd?R:G}44`,borderRadius:6,color:showAdd?R:G,fontSize:11,fontFamily:"inherit",cursor:"pointer",fontWeight:700 }}>
                {showAdd?"✕ Close Form":"+ Log New Trade"}
              </button>
            </div>
            {showAdd&&<JournalForm key={"add-"+addKey} initial={addInit} isEdit={false} onSave={addTrade} onCancel={()=>{setShowAdd(false);setAddInit(null);}}/>}
            {jLoaded&&journal.length===0&&!showAdd&&(
              <div className="card" style={{ padding:60,textAlign:"center",color:"#0f2440",fontFamily:"'Syne',sans-serif" }}>No trades yet. Click "+ Log New Trade".</div>
            )}
            {[...journal].sort((a,b)=>{
              const pd = s => { if(!s) return 0; const [d,m,y]=(s||"").split("/").map(Number); return new Date(y,m-1,d).getTime(); };
              const diff = pd(b.date) - pd(a.date);
              if(diff!==0) return diff;
              return journal.indexOf(a) - journal.indexOf(b);
            }).map((t,_sortedIdx)=>{
              const idx = journal.indexOf(t); // real index for edit/delete
              const isOpen=t.result==="Open";
              const c=t.result==="Win"?G:t.result==="Loss"?R:isOpen?C:Y;
              const isEditing=editIdx===idx; const isExpanded=expandIdx===idx||isEditing;
              return (
                <div key={idx} style={{ marginBottom:8,borderRadius:8,overflow:"hidden",border:`1px solid ${isEditing?Y+"44":c+"22"}` }}>
                  <div className="jrow" style={{ background:"#080f1e",padding:"12px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,cursor:"pointer",transition:"background 0.15s" }}
                    onClick={()=>setExpandIdx(isExpanded&&!isEditing?null:idx)}>
                    <div style={{ display:"flex",gap:8,alignItems:"center",flexWrap:"wrap" }}>
                      <span style={{ fontFamily:"'Syne',sans-serif",fontWeight:800,color:"#e0f0ff",fontSize:14 }}>{t.pair||"—"}</span>
                      {t.direction&&<span style={{ fontSize:10,padding:"2px 9px",borderRadius:20,fontWeight:600,background:t.direction==="Long"?`${G}18`:`${R}18`,color:t.direction==="Long"?G:R,border:`1px solid ${t.direction==="Long"?G+"44":R+"44"}` }}>{t.direction}</span>}
                      {t.timeframe&&<span style={{ fontSize:10,padding:"2px 7px",borderRadius:4,background:"#0a1628",color:"#5a9abc" }}>{t.timeframe}</span>}
                      {t.confidence&&<span style={{ fontSize:10,color:C }}>★ {t.confidence}</span>}
                      <span style={{ fontSize:10,color:"#4a7a9a" }}>{t.date}</span>
                    </div>
                    <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                      {isOpen
                        ? <span style={{ fontSize:11,fontWeight:700,color:C,letterSpacing:"0.06em",animation:"pulse 1.8s ease-in-out infinite" }}>● RUNNING</span>
                        : <span style={{ fontSize:15,fontWeight:700,color:c,fontVariantNumeric:"tabular-nums",fontFamily:"'IBM Plex Mono',monospace" }}>{t.pnl>=0?"+":""}{(t.pnl||0).toFixed(2)}</span>}
                      <span style={{ fontSize:10,padding:"3px 10px",borderRadius:20,background:`${c}18`,color:c,border:`1px solid ${c}33`,fontWeight:600 }}>{t.result}</span>
                      {/* EDIT */}
                      <button onClick={e=>{e.stopPropagation();openEdit(idx);}}
                        style={{ padding:"5px 12px",borderRadius:6,fontSize:10,fontFamily:"inherit",cursor:"pointer",fontWeight:700,background:isEditing?`${Y}20`:"#0a1628",border:`1px solid ${isEditing?Y+"66":"#1a3a5c"}`,color:isEditing?Y:"#4a6a8a" }}>
                        {isEditing?"✕ Close":"✎ Edit"}</button>
                      {/* DELETE */}
                      <button onClick={e=>{e.stopPropagation();setDelIdx(idx);}}
                        style={{ padding:"5px 12px",borderRadius:6,fontSize:10,fontFamily:"inherit",cursor:"pointer",fontWeight:700,background:`${R}15`,border:`1px solid ${R}55`,color:R }}>
                        🗑 Delete</button>
                    </div>
                  </div>
                  {isExpanded&&!isEditing&&<div style={{ background:"#060b14",padding:"10px 16px",borderTop:"1px solid #0a1628" }}>
                    <div style={{ display:"flex",gap:18,fontSize:11,flexWrap:"wrap",marginBottom:t.notes?8:0 }}>
                      {t.entry&&<span style={{ color:"#5a9abc" }}>Entry <span style={{ color:C }}>${t.entry}</span></span>}
                      {t.sl&&<span style={{ color:"#5a9abc" }}>SL <span style={{ color:R }}>${t.sl}</span></span>}
                      {t.tp1&&<span style={{ color:"#5a9abc" }}>TP1 <span style={{ color:G }}>${t.tp1}</span></span>}
                      {t.tp2&&<span style={{ color:"#5a9abc" }}>TP2 <span style={{ color:G }}>${t.tp2}</span></span>}
                    </div>
                    {t.notes&&<div style={{ fontSize:11,color:"#5a9abc",borderLeft:"2px solid #0f2440",paddingLeft:10,fontStyle:"italic" }}>{t.notes}</div>}
                  </div>}
                  {isEditing&&<JournalForm key={`edit-${idx}-${formKey}`} initial={t} isEdit onSave={e=>updateTrade(idx,e)} onCancel={()=>setEditIdx(null)}/>}
                </div>
              );
            })}
          </div>
        )}

        {/* ── MARKET TAB ── */}
        {tab==="market"&&(
          <div style={{ marginTop:16 }}>
            <div style={{ background:`${Y}0d`,border:`1px solid ${Y}22`,borderRadius:8,padding:"10px 16px",marginBottom:14,fontSize:11,color:Y }}>⚠ {MACRO}</div>
            <div className="card" style={{ overflow:"hidden" }}>
              <table style={{ width:"100%",borderCollapse:"collapse",fontSize:11 }}>
                <thead><tr style={{ background:"#060b14" }}>
                  {["Symbol","Mark Price","24H Change","Volume 24H","Open Interest","Funding Rate","Bid / Ask"].map(h=>(
                    <th key={h} style={{ padding:"10px 14px",textAlign:"left",fontSize:9,color:"#4a7a9a",letterSpacing:"0.1em",borderBottom:"1px solid #0a1628",fontWeight:600,whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>{COIN_CFG.map((c,i)=>{
                  const d=prices[c.p]; const up=(d?.ch||0)>=0;
                  const frNum=d?.frRaw??0;
                  const frCol=frNum>0.05?"#ff4466":frNum>0?"#ff8800":frNum<-0.05?"#00aaff":frNum<0?"#0088ff":"#5b8db8";
                  const fmtP=(p)=>{ if(!p)return"—"; if(p>=1000)return p.toLocaleString("en-US",{maximumFractionDigits:0}); if(p>=1)return p.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:4}); return p.toFixed(6); };
                  return <tr key={c.p} style={{ borderBottom:i<COIN_CFG.length-1?"1px solid #0a1628":"none" }}>
                    <td style={{ padding:"12px 14px" }}>
                      <span style={{ fontFamily:"'Syne',sans-serif",fontWeight:800,color:"#e0f0ff" }}>{c.s}</span>
                      <span style={{ fontSize:9,color:"#4a7a9a",marginLeft:5 }}>USDT PERP</span>
                    </td>
                    <td style={{ padding:"12px 14px",color:"#e0f0ff",fontVariantNumeric:"tabular-nums",fontWeight:600 }}>
                      {d?.loading?<span className="pulse" style={{ color:"#4a7a9a" }}>Loading...</span>:fmtP(d?.price)}
                    </td>
                    <td style={{ padding:"12px 14px",color:up?G:R,fontWeight:700,fontVariantNumeric:"tabular-nums" }}>
                      {up?"▲":"▼"} {Math.abs(d?.ch||0).toFixed(2)}%
                    </td>
                    <td style={{ padding:"12px 14px",color:"#3a6080",fontVariantNumeric:"tabular-nums" }}>{d?.vol||"—"}</td>
                    <td style={{ padding:"12px 14px",color:"#3a6080",fontVariantNumeric:"tabular-nums" }}>{d?.oi||"—"}</td>
                    <td style={{ padding:"12px 14px",color:frCol,fontWeight:600,fontVariantNumeric:"tabular-nums" }}>
                      {d?.fr||"—"}
                      {frNum>0.05&&<span style={{ fontSize:8,color:"#ff4466",marginLeft:4 }}>⚠ HIGH</span>}
                      {frNum<-0.05&&<span style={{ fontSize:8,color:"#00aaff",marginLeft:4 }}>↓ NEG</span>}
                    </td>
                    <td style={{ padding:"12px 14px",fontVariantNumeric:"tabular-nums" }}>
                      {d?.bid&&d?.ask
                        ? <><span style={{ color:G }}>{fmtP(d.bid)}</span><span style={{ color:"#4a7a9a" }}> / </span><span style={{ color:R }}>{fmtP(d.ask)}</span></>
                        : <span style={{ color:"#4a7a9a" }}>—</span>}
                    </td>
                    <td style={{ padding:"12px 14px" }}><span style={{ fontSize:10,padding:"3px 10px",borderRadius:20,background:`${sc}15`,color:sc,border:`1px solid ${sc}30`,fontWeight:600 }}>{sig}</span></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── STATS TAB (ML-style) ── */}
        {tab==="stats"&&(()=>{
          // ── Time filter ─────────────────────────────────────────────────────────
          const parseDate = s => {
            if(!s) return null;
            const p=s.split("/"); const d=parseInt(p[0]),m=parseInt(p[1]),y=parseInt(p[2]||2026);
            return new Date(y,m-1,d);
          };
          const now = new Date();
          const filteredJournal = (() => {
            if (statsPeriod==="all") return journal;
            if (statsPeriod==="custom") {
              const from = customFrom ? new Date(customFrom) : null;
              const to   = customTo   ? new Date(customTo)   : null;
              return journal.filter(t=>{ const d=parseDate(t.date); if(!d) return false; if(from&&d<from) return false; if(to&&d>to) return false; return true; });
            }
            const days = parseInt(statsPeriod);
            const cutoff = new Date(now - days*24*60*60*1000);
            return journal.filter(t=>{ const d=parseDate(t.date); return d&&d>=cutoff; });
          })();

          // ── Filtered stats ───────────────────────────────────────────────────────
          const fWins   = filteredJournal.filter(j=>j.result==="Win");
          const fLosses = filteredJournal.filter(j=>j.result==="Loss");
          const fBes    = filteredJournal.filter(j=>j.result==="BE");
          const fOpen   = filteredJournal.filter(j=>j.result==="Open");
          const fWr     = filteredJournal.filter(j=>j.result!=="Open").length>0 ? Math.round(fWins.length/filteredJournal.filter(j=>j.result!=="Open").length*100) : null;
          const fPnl    = filteredJournal.reduce((s,j)=>s+(j.pnl||0),0);
          const fAvgWin  = fWins.length   ? fWins.reduce((s,j)=>s+Math.abs(j.pnl||0),0)/fWins.length   : 0;
          const fAvgLoss = fLosses.length ? fLosses.reduce((s,j)=>s+Math.abs(j.pnl||0),0)/fLosses.length : 0;
          const fPf      = fAvgLoss>0 ? fAvgWin/fAvgLoss : fAvgWin>0?5:0;
          const fBestWin = fWins.length   ? Math.max(...fWins.map(j=>j.pnl||0))   : 0;
          let fMaxC=0,fcw=0;
          for(const j of filteredJournal){if(j.result==="Win"){fcw++;fMaxC=Math.max(fMaxC,fcw);}else fcw=0;}
          const fLast5W   = filteredJournal.slice(0,5).filter(j=>j.result==="Win").length;
          const fMomentum = filteredJournal.length>0?(fLast5W/Math.min(filteredJournal.length,5))*10:0;
          const fDisc     = filteredJournal.length>0?filteredJournal.filter(j=>j.confidence&&parseInt(j.confidence)>=8).length/filteredJournal.length*10:0;
          const norm=(v,max)=>parseFloat(Math.min(Math.max(v/max*10,0),10).toFixed(2));
          const spAxes=[
            {label:"Win Rate",   value:norm(fWr||0,100)},
            {label:"RR Ratio",   value:norm(fPf,3)},
            {label:"Momentum",   value:parseFloat(fMomentum.toFixed(2))},
            {label:"Discipline", value:parseFloat(fDisc.toFixed(2))},
            {label:"Net Profit", value:norm(Math.max(fPnl,0),50)},
            {label:"Consistency",value:norm((fWr||0)*0.6+fMaxC*8,100)},
          ];
          const overallScore=(spAxes.reduce((s,a)=>s+a.value,0)/spAxes.length).toFixed(1);
          const statItems=[
            {label:"Streak",   val:fMaxC+" wins"},
            {label:"5x Combo", val:fMaxC>=5?"YES":"NO"},
            {label:"3x Combo", val:fMaxC>=3?"YES":"NO"},
            {label:"Best Win", val:fBestWin>0?"$"+fBestWin.toFixed(4):"—"},
            {label:"W / L",    val:fWins.length+" / "+fLosses.length},
            {label:"Net PnL",  val:(fPnl>=0?"+":"")+"$"+fPnl.toFixed(4)},
          ];

          return (
          <div style={{ marginTop:16 }}>

            {/* ── TIME FILTER TABS ── */}
            <div className="card" style={{ padding:"0", marginBottom:12, overflow:"hidden" }}>
              <div style={{ display:"flex", overflowX:"auto", scrollbarWidth:"none", borderBottom:"1px solid #0d2040" }}>
                {["7d","14d","30d","60d","90d","180d","all","custom"].map(p=>(
                  <button key={p} onClick={()=>setStatsPeriod(p)}
                    style={{ flexShrink:0, padding:"9px 16px", background:"transparent", border:"none",
                      borderBottom:`2px solid ${statsPeriod===p?C:"transparent"}`,
                      color:statsPeriod===p?C:"#4a6a8a", fontSize:11, fontFamily:"'IBM Plex Mono',monospace",
                      cursor:"pointer", letterSpacing:"0.06em", fontWeight:statsPeriod===p?700:400 }}>
                    {p==="all"?"All Time":p==="custom"?"Custom":p.toUpperCase()}
                  </button>
                ))}
                <div style={{ padding:"8px 12px", marginLeft:"auto", display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontSize:10, color:"#5a9abc", fontWeight:600 }}>{filteredJournal.length} trades</span>
                </div>
              </div>
              {statsPeriod==="custom"&&(
                <div style={{ padding:"10px 16px", display:"flex", gap:12, alignItems:"center", flexWrap:"wrap" }}>
                  <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                    <span style={{ fontSize:9, color:"#4a6a8a" }}>From</span>
                    <input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)}
                      style={{ background:"#050d1a", border:"1px solid #0f2440", color:"#c0d8f0", padding:"5px 8px", borderRadius:5, fontSize:11, fontFamily:"inherit" }}/>
                  </div>
                  <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                    <span style={{ fontSize:9, color:"#4a6a8a" }}>To</span>
                    <input type="date" value={customTo} onChange={e=>setCustomTo(e.target.value)}
                      style={{ background:"#050d1a", border:"1px solid #0f2440", color:"#c0d8f0", padding:"5px 8px", borderRadius:5, fontSize:11, fontFamily:"inherit" }}/>
                  </div>
                </div>
              )}
            </div>

            {/* ── WALLET SUMMARY BAR ── */}
            <div className="card" style={{ padding:"14px 18px",marginBottom:12,display:"flex",alignItems:"center",gap:24,flexWrap:"wrap" }}>
              {[
                ["INITIAL CAPITAL", "$"+wallet.initial.toLocaleString(),                                                                      "#7ab4d8"],
                ["CURRENT BALANCE", "$"+currentBalance.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}),             totalPnl>=0?G:R],
                ["GROWTH",          (parseFloat(balanceGrowth)>=0?"+":"")+balanceGrowth+"%",                                                  parseFloat(balanceGrowth)>=0?G:R],
                ["NET PnL (ALL)",   (totalPnl>=0?"+":"")+totalPnl.toFixed(4)+" USDT",                                                        totalPnl>=0?G:R],
              ].map(([l,v,c],i)=>(
                <div key={i} style={{ minWidth:100 }}>
                  <div style={{ fontSize:9, color:"#7ab8d4", letterSpacing:"0.1em", marginBottom:3, fontWeight:700 }}>{l}</div>
                  <div style={{ fontSize:16, fontWeight:800, color:c, fontVariantNumeric:"tabular-nums", fontFamily:"'IBM Plex Mono',monospace" }}>{v}</div>
                </div>
              ))}
              <button onClick={()=>setEditWallet(v=>!v)} style={{ marginLeft:"auto",fontSize:9,color:"#7ab8d4",background:"#0a1628",border:"1px solid #1a3a5c",borderRadius:5,padding:"5px 12px",cursor:"pointer",fontFamily:"inherit",fontWeight:600 }}>
                {editWallet?"✕ Cancel":"✎ Edit Capital"}
              </button>
              {editWallet&&<div style={{ display:"flex",gap:6,alignItems:"center" }}>
                <span style={{ fontSize:11,color:"#4a6a8a" }}>$</span>
                <input type="number" value={walletInput} onChange={e=>setWalletInput(e.target.value)} style={{ width:90,padding:"5px 8px",fontSize:12,background:"#050d1a",border:"1px solid #0f2440",color:"#c0d8f0",borderRadius:5,fontFamily:"inherit" }}/>
                <button onClick={saveWallet} style={{ padding:"5px 12px",background:`${G}22`,border:`1px solid ${G}55`,borderRadius:5,color:G,fontSize:10,fontFamily:"inherit",cursor:"pointer",fontWeight:700 }}>Save</button>
              </div>}
            </div>

            {/* ── ML STATS PANEL ── */}
            <div className="card" style={{ overflow:"hidden", background:"linear-gradient(160deg,#07101e 0%,#050c18 100%)", marginBottom:12 }}>
              <div style={{ padding:"10px 18px",borderBottom:"1px solid #0d2040",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
                <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                  <div className="pulse" style={{ width:5,height:5,borderRadius:"50%",background:C,boxShadow:`0 0 8px ${C}` }}/>
                  <span style={{ fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:11,color:"#c0d8f0",letterSpacing:"0.06em" }}>
                    {statsPeriod==="all"?"ALL TRADES":statsPeriod==="custom"?"CUSTOM RANGE":statsPeriod.toUpperCase()+" PERFORMANCE"}
                  </span>
                  {fOpen.length>0&&<span style={{ fontSize:9,color:C }}>· {fOpen.length} open</span>}
                </div>
                <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                  <span style={{ fontSize:9,color:"#7ab8d4",fontWeight:700,letterSpacing:"0.1em" }}>SCORE</span>
                  <span style={{ fontFamily:"'IBM Plex Mono',monospace",fontSize:14,fontWeight:700,color:parseFloat(overallScore)>=7?G:parseFloat(overallScore)>=5?Y:R }}>{overallScore}</span>
                  <span style={{ fontSize:11,color:"#5a9abc",fontWeight:600 }}>/10</span>
                </div>
              </div>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",minHeight:280 }}>
                <div style={{ padding:"18px 16px",borderRight:"1px solid #0d2040" }}>
                  <div style={{ display:"flex",gap:10,justifyContent:"space-around",marginBottom:20 }}>
                    <MLBadge value={filteredJournal.filter(j=>j.result!=="Open").length} sub="Trades"  color1="#c040ff" color2="#7020c0" size={82}/>
                    <MLBadge value={fWr!=null?fWr+"%":"—"} sub={fWr!=null&&fWr>=55?"Hot🔥":"Win%"} color1="#e8a020" color2="#c87010" size={82}/>
                    <MLBadge value={fWins.length} sub="Wins" color1="#20cc60" color2="#10a040" size={82}/>
                  </div>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 8px" }}>
                    {statItems.map((it,i)=>(
                      <div key={i} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:"1px solid #0a1a2e" }}>
                        <span style={{ fontSize:10,color:"#5a9abc" }}>{it.label}</span>
                        <span style={{ fontSize:12,fontWeight:700,color:"#a8cce8",fontFamily:"'IBM Plex Mono',monospace" }}>{it.val}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop:10,padding:"8px 0",borderTop:"1px solid #0a1a2e",display:"flex",gap:12,flexWrap:"wrap" }}>
                    {[["Avg Win","$"+fAvgWin.toFixed(4),G],["Avg Loss","$"+fAvgLoss.toFixed(4),R],["PF",fPf.toFixed(2)+"x",fPf>=2?G:fPf>=1?Y:R]].map(([l,v,c])=>(
                      <div key={l}><div style={{ fontSize:8,color:"#5a9abc",marginBottom:1 }}>{l}</div><div style={{ fontSize:12,fontWeight:700,color:c }}>{v}</div></div>
                    ))}
                  </div>
                </div>
                <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"12px 8px 8px" }}>
                  {filteredJournal.length>0
                    ?<SpiderChart axes={spAxes} size={220}/>
                    :<div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:10,color:"#0f2440",padding:40 }}>
                        <div style={{ fontSize:32 }}>◈</div>
                        <div style={{ fontSize:9,letterSpacing:"0.1em" }}>No data for selected period</div>
                      </div>
                  }
                  {filteredJournal.length>0&&(
                    <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,width:"100%",padding:"0 8px 4px" }}>
                      {spAxes.map((ax)=>{
                        const vc=ax.value>=7?G:ax.value>=5?Y:R;
                        return <div key={ax.label} style={{ background:"#050c18",borderRadius:5,padding:"4px 6px",border:`1px solid ${vc}20`,textAlign:"center" }}>
                          <div style={{ fontSize:7.5,color:"#5a9abc",marginBottom:1 }}>{ax.label}</div>
                          <div style={{ fontSize:12,fontWeight:700,color:vc }}>{ax.value.toFixed(1)}</div>
                        </div>;
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── P&L CALENDAR + RANKING ROW ── */}
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12 }}>
              <PnLCalendar journal={filteredJournal}/>
              <PairRanking journal={filteredJournal}/>
            </div>

          </div>
          );
        })()}

      </div>

      <DelModal trade={delIdx!==null?journal[delIdx]:null} onConfirm={confirmDel} onCancel={()=>setDelIdx(null)}/>
    </div>
  );
}
