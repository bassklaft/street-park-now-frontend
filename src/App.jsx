import { useState, useCallback, useEffect, useRef } from "react";

const API = import.meta.env?.VITE_BACKEND_URL || "https://street-park-info-backend.onrender.com";

// ─── STORAGE (plain functions, no hooks) ──────────────────────────────────────
const Storage = {
  getCount:     () => parseInt(localStorage.getItem("spi_searches") || "0"),
  incCount:     () => { const n = Storage.getCount() + 1; localStorage.setItem("spi_searches", String(n)); return n; },
  isSubscribed: () => localStorage.getItem("spi_subscribed") === "true",
  getSaved:     () => { try { return JSON.parse(localStorage.getItem("spi_saved") || "[]"); } catch { return []; } },
  saveSearch:   (loc) => {
    if (!Storage.isSubscribed()) return null;
    const entry = {
      id: Date.now(),
      label: loc.label || loc.street,
      street: loc.street,
      borough: loc.borough || "",
      neighborhood: loc.neighborhood || "",
      lat: loc.lat, lng: loc.lng,
      type: loc.isEstablishment ? "establishment" : loc.isPark ? "park" : loc.isZip ? "zip" : "location",
      ts: new Date().toLocaleString("en-US", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }),
    };
    const prev = Storage.getSaved();
    const updated = [entry, ...prev.filter(s => s.label !== entry.label)].slice(0, 20);
    localStorage.setItem("spi_saved", JSON.stringify(updated));
    return updated;
  },
  clearSaved: () => localStorage.removeItem("spi_saved"),
};

// ─── API HELPERS ──────────────────────────────────────────────────────────────
async function geocode(q, uLat, uLng) {
  const p = new URLSearchParams({ q });
  if (uLat && uLng) { p.set("userLat", uLat); p.set("userLng", uLng); }
  const r = await fetch(`${API}/api/geocode?${p}`);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `Couldn't find "${q}" in NYC`);
  return d;
}
async function reverseGeocode(lat, lng) {
  const r = await fetch(`${API}/api/reverse-geocode?lat=${lat}&lng=${lng}`);
  const d = await r.json();
  if (!r.ok) throw new Error("Could not identify your street");
  return d;
}
async function getCleaning(street, lat, lng) {
  try {
    const p = new URLSearchParams({ street });
    if (lat && lng) { p.set("lat", lat); p.set("lng", lng); }
    const r = await fetch(`${API}/api/cleaning?${p}`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}
async function getFilms(street) {
  try { const r = await fetch(`${API}/api/films?street=${encodeURIComponent(street)}`); return r.ok ? r.json() : []; } catch { return []; }
}
async function getEvents(borough) {
  try { const r = await fetch(`${API}/api/events?borough=${encodeURIComponent(borough || "")}`); return r.ok ? r.json() : []; } catch { return []; }
}
async function getWeather(lat, lng) {
  try { const r = await fetch(`${API}/api/weather?lat=${lat}&lng=${lng}`); return r.ok ? r.json() : null; } catch { return null; }
}
async function getASP() {
  try { const r = await fetch(`${API}/api/asp`); return r.ok ? r.json() : { suspended: false }; } catch { return { suspended: false }; }
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const todayAbbr = () => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date().getDay()];
const fmtDT = s => { try { return new Date(s).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}); } catch { return s; } };
const WX = { 0:"Clear",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",45:"Foggy",48:"Icy fog",51:"Light drizzle",53:"Drizzle",55:"Heavy drizzle",61:"Light rain",63:"Rain",65:"Heavy rain",71:"Light snow",73:"Snow",75:"Heavy snow",77:"Snow grains",80:"Rain showers",81:"Showers",82:"Heavy showers",85:"Snow showers",86:"Heavy snow showers",95:"Thunderstorm",96:"Thunderstorm+hail",99:"Severe thunderstorm" };
const SEVERE = new Set([51,53,55,61,63,65,71,73,75,77,80,81,82,85,86,95,96,99]);
const wxIcon = c => [95,96,99].includes(c)?"⛈":[71,73,75,77,85,86].includes(c)?"❄":[61,63,65,80,81,82].includes(c)?"🌧":[51,53,55].includes(c)?"🌦":[45,48].includes(c)?"🌫":c>=1&&c<=3?"⛅":"☀";
const haversineKm = (a,b,c,d) => { const R=6371,dL=(c-a)*Math.PI/180,dG=(d-b)*Math.PI/180,x=Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dG/2)**2; return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)); };
const fmtKm = km => km < 1 ? `${Math.round(km*1000)}m away` : `${km.toFixed(1)}km away`;

// ─── MAP ──────────────────────────────────────────────────────────────────────
function ParkMap({ destLat, destLng, userLat, userLng, label, history = [] }) {
  const ref = useRef(null);
  const inst = useRef(null);

  useEffect(() => {
    if (!ref.current || inst.current) return;
    let alive = true;
    (async () => {
      if (!window.L) {
        const lnk = document.createElement("link");
        lnk.rel = "stylesheet"; lnk.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(lnk);
        await new Promise(res => { const s = document.createElement("script"); s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"; s.onload = res; document.head.appendChild(s); });
      }
      if (!alive || !ref.current) return;
      const L = window.L;
      const cLat = userLat ? (destLat + userLat) / 2 : destLat;
      const cLng = userLng ? (destLng + userLng) / 2 : destLng;
      const map = L.map(ref.current, { center: [cLat, cLng], zoom: userLat ? 15 : 16 });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(map);

      // History — green pins or circles
      (history || []).forEach(h => {
        if (!h.lat || !h.lng) return;
        if (h.type === "establishment") {
          const icon = L.divIcon({ html: `<svg viewBox="0 0 20 28" width="16" height="22" xmlns="http://www.w3.org/2000/svg"><path d="M10 0C4.5 0 0 4.5 0 10c0 7.5 10 18 10 18S20 17.5 20 10C20 4.5 15.5 0 10 0z" fill="#38A169"/><circle cx="10" cy="10" r="4" fill="white"/></svg>`, className: "", iconSize: [16,22], iconAnchor: [8,22] });
          L.marker([h.lat, h.lng], { icon }).addTo(map).bindPopup(`<span style="font-size:12px">🕐 ${h.label}</span>`);
        } else {
          L.circle([h.lat, h.lng], { radius: h.type==="zip"?600:400, color:"#38A169", fillColor:"#38A169", fillOpacity:0.12, weight:2, dashArray:"6 4" }).addTo(map).bindPopup(`<span style="font-size:12px">🕐 ${h.label}</span>`);
        }
      });

      // Red destination
      const rI = L.divIcon({ html: `<svg viewBox="0 0 20 28" width="20" height="28" xmlns="http://www.w3.org/2000/svg"><path d="M10 0C4.5 0 0 4.5 0 10c0 7.5 10 18 10 18S20 17.5 20 10C20 4.5 15.5 0 10 0z" fill="#E53E3E"/><circle cx="10" cy="10" r="4" fill="white"/></svg>`, className: "", iconSize: [20,28], iconAnchor: [10,28], popupAnchor: [0,-28] });
      L.marker([destLat, destLng], { icon: rI }).addTo(map).bindPopup(`<b style="font-size:13px">🅿 ${label}</b>`).openPopup();

      // Blue user
      if (userLat && userLng) {
        const bI = L.divIcon({ html: `<svg viewBox="0 0 18 18" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="9" r="9" fill="#3182CE" opacity="0.3"/><circle cx="9" cy="9" r="5" fill="#3182CE"/><circle cx="9" cy="9" r="2.5" fill="white"/></svg>`, className: "", iconSize: [18,18], iconAnchor: [9,9] });
        L.marker([userLat, userLng], { icon: bI }).addTo(map).bindPopup(`<span style="font-size:12px">📍 You</span>`);
        L.polyline([[userLat,userLng],[destLat,destLng]], { color:"#F7C948", weight:2, dashArray:"6,8", opacity:0.7 }).addTo(map);
        map.fitBounds(L.latLngBounds([[userLat,userLng],[destLat,destLng]]), { padding:[40,40] });
      }
      inst.current = map;
    })().catch(console.error);
    return () => { alive = false; if (inst.current) { inst.current.remove(); inst.current = null; } };
  }, [destLat, destLng, userLat, userLng, label, history]);

  return <div ref={ref} style={{ width:"100%", height:"260px" }} />;
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const css = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@400;500&family=Barlow+Condensed:wght@400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--black:#080808;--yellow:#F7C948;--yd:#c9a010;--white:#EDEBE4;--g1:#141414;--g2:#1e1e1e;--muted:#555;--red:#E53E3E;--green:#38A169;--blue:#3182CE;--orange:#DD6B20;--mono:'IBM Plex Mono',monospace;--display:'Bebas Neue',sans-serif;--body:'Barlow Condensed',sans-serif}
html,body{background:var(--black);color:var(--white);font-family:var(--body);min-height:100vh;overflow-x:hidden}
.nav{position:sticky;top:0;z-index:100;background:var(--black);border-bottom:2px solid var(--yellow);display:flex;align-items:center;justify-content:space-between;padding:0 20px;height:60px}
.logo{font-family:var(--display);font-size:1.9rem;letter-spacing:.06em;color:var(--yellow);cursor:pointer;transition:opacity .15s}
.logo:hover{opacity:.8}
.logo span{color:var(--white)}
.pill{font-family:var(--mono);font-size:.6rem;letter-spacing:.12em;padding:4px 9px;background:var(--yellow);color:var(--black)}
.pill.ghost{background:none;border:1px solid #333;color:#777;cursor:pointer;transition:all .15s}
.pill.ghost:hover{border-color:#666;color:var(--white)}
.home{min-height:calc(100vh - 60px);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 24px;text-align:center;animation:up .4s ease}
.h1{font-family:var(--display);font-size:clamp(3rem,9vw,5.5rem);letter-spacing:.04em;line-height:.92;margin-bottom:16px}
.h1 em{color:var(--yellow);font-style:normal}
.sub{font-family:var(--mono);font-size:.72rem;color:var(--muted);letter-spacing:.08em;line-height:1.8;max-width:420px;margin:0 auto 32px}
.sub strong{color:var(--white)}
.search-wrap{width:100%;max-width:540px}
.gate-note{font-family:var(--mono);font-size:.62rem;letter-spacing:.08em;text-align:center;margin-bottom:10px}
.search-box{display:flex;border:2px solid var(--yellow);background:var(--g2)}
.search-box input{flex:1;background:none;border:none;outline:none;color:var(--white);font-family:var(--mono);font-size:.9rem;padding:14px 18px;letter-spacing:.04em}
.search-box input::placeholder{color:#444}
.search-box button{background:var(--yellow);border:none;cursor:pointer;font-family:var(--display);font-size:1.4rem;letter-spacing:.1em;padding:0 22px;transition:background .15s;white-space:nowrap}
.search-box button:hover{background:var(--yd)}
.or{font-family:var(--mono);font-size:.65rem;color:#444;letter-spacing:.1em;margin:16px 0}
.gps-btn{background:none;border:1px solid #333;color:#888;font-family:var(--mono);font-size:.7rem;letter-spacing:.1em;padding:10px 20px;cursor:pointer;transition:all .15s;display:flex;align-items:center;gap:8px}
.gps-btn:hover{border-color:var(--yellow);color:var(--yellow)}
.err{font-family:var(--mono);font-size:.68rem;color:var(--red);margin-top:14px;max-width:440px}
.loading{min-height:calc(100vh - 60px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px}
.spin{width:44px;height:44px;border:3px solid #222;border-top-color:var(--yellow);border-radius:50%;animation:spin .7s linear infinite}
.loading-lbl{font-family:var(--mono);font-size:.7rem;color:var(--muted);letter-spacing:.15em;text-transform:uppercase}
.dash{padding:0 20px 80px;max-width:800px;margin:0 auto}
.loc-bar{padding:18px 0 14px;display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid #1f1f1f;margin-bottom:18px;animation:up .3s ease}
.loc-eyebrow{font-family:var(--mono);font-size:.58rem;color:var(--yellow);letter-spacing:.15em;text-transform:uppercase;margin-bottom:3px}
.loc-name{font-family:var(--display);font-size:1.9rem;letter-spacing:.04em;line-height:1}
.loc-meta{font-family:var(--mono);font-size:.6rem;color:var(--muted);margin-top:3px}
.re-btn{background:none;border:1px solid #2a2a2a;color:#555;font-family:var(--mono);font-size:.58rem;letter-spacing:.1em;padding:6px 11px;cursor:pointer;transition:all .15s;white-space:nowrap;margin-top:4px}
.re-btn:hover{border-color:#555;color:var(--white)}
.map-wrap{margin-bottom:8px;border:1px solid #2a2a2a;animation:up .3s ease}
.map-legend{display:flex;gap:16px;padding:8px 12px;background:var(--g2);border-top:1px solid #222;flex-wrap:wrap}
.map-legend-item{display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:.6rem;color:var(--muted)}
.map-dot{width:10px;height:10px;border-radius:50%}
.history-wrap{padding:10px 0;margin-bottom:12px}
.htoggle{display:flex;align-items:center;gap:10px;cursor:pointer}
.htoggle input{width:16px;height:16px;accent-color:var(--yellow);cursor:pointer}
.htoggle-label{font-family:var(--mono);font-size:.68rem;color:var(--white);letter-spacing:.06em;cursor:pointer}
.hsub{font-family:var(--mono);font-size:.58rem;color:var(--muted);margin-top:4px;margin-left:26px;cursor:pointer}
.hlist{margin-top:10px}
.hitem{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--g1);border:1px solid #1f1f1f;margin-bottom:4px;cursor:pointer;transition:border-color .15s}
.hitem:hover{border-color:#333}
.hdot{width:8px;height:8px;border-radius:50%;background:var(--green);flex-shrink:0}
.hdot.area{background:none;border:2px solid var(--green)}
.hitem-label{font-family:var(--mono);font-size:.65rem;color:var(--white)}
.hitem-meta{font-family:var(--mono);font-size:.56rem;color:var(--muted)}
.hitem-ts{font-family:var(--mono);font-size:.55rem;color:#444}
.hclear{font-family:var(--mono);font-size:.6rem;color:#444;background:none;border:none;cursor:pointer;padding:6px 0;display:block}
.hclear:hover{color:var(--red)}
.gps-prompt{background:var(--g2);border:1px solid #2a2a2a;border-left:3px solid var(--yellow);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.gps-prompt-text{font-family:var(--mono);font-size:.65rem;color:var(--muted);line-height:1.5}
.gps-prompt-btn{background:var(--yellow);color:var(--black);border:none;cursor:pointer;font-family:var(--mono);font-size:.6rem;letter-spacing:.1em;padding:7px 14px;white-space:nowrap}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:2px;margin-bottom:20px;animation:up .3s .05s ease both}
.card{background:var(--g2);padding:14px 16px;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:#2a2a2a}
.card.ok::before{background:var(--green)}.card.warn::before{background:var(--yellow)}.card.alert::before{background:var(--red)}.card.info::before{background:var(--blue)}.card.orange::before{background:var(--orange)}
.card-lbl{font-family:var(--mono);font-size:.55rem;letter-spacing:.12em;color:var(--muted);text-transform:uppercase;margin-bottom:5px}
.card-val{font-family:var(--display);font-size:1.25rem;letter-spacing:.04em;line-height:1.1}
.card-sub{font-family:var(--mono);font-size:.58rem;color:var(--muted);margin-top:3px}
.sec{margin-bottom:26px;animation:up .3s .1s ease both}
.sec-hd{display:flex;align-items:center;gap:10px;font-family:var(--mono);font-size:.62rem;letter-spacing:.15em;color:var(--yellow);text-transform:uppercase;margin-bottom:10px}
.sec-hd::after{content:'';flex:1;height:1px;background:#1f1f1f}
.badge{background:var(--yellow);color:var(--black);font-size:.55rem;padding:2px 6px;font-weight:500}
.sec-note{font-family:var(--mono);font-size:.62rem;color:var(--muted);margin-bottom:10px}
.clean-card{background:var(--g2);border:1px solid #222;padding:15px 18px;margin-bottom:8px;position:relative}
.clean-card.today{border-color:var(--red);background:#120808}
.today-tag{position:absolute;top:0;right:0;background:var(--red);color:var(--white);font-family:var(--mono);font-size:.52rem;letter-spacing:.12em;padding:3px 9px;text-transform:uppercase}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}
.chip{font-family:var(--mono);font-size:.58rem;padding:3px 8px;border:1px solid #2a2a2a;color:#555}
.chip.on{background:var(--yellow);color:var(--black);border-color:var(--yellow)}
.clean-time{font-family:var(--display);font-size:1.45rem;letter-spacing:.04em}
.clean-raw{font-family:var(--mono);font-size:.58rem;color:#444;margin-top:3px;line-height:1.4}
.side-tag{display:inline-block;font-family:var(--mono);font-size:.56rem;padding:2px 7px;border:1px solid #2a2a2a;color:var(--muted);margin-bottom:6px}
.street-lbl{font-family:var(--mono);font-size:.62rem;color:var(--yellow);letter-spacing:.1em;margin-bottom:6px;text-transform:uppercase}
.ev-card{background:var(--g2);border:1px solid #222;border-left:3px solid var(--blue);padding:13px 16px;margin-bottom:8px}
.ev-card.film{border-left-color:var(--orange)}.ev-card.severe{border-left-color:var(--red);background:#12100a}
.ev-type{font-family:var(--mono);font-size:.56rem;letter-spacing:.12em;color:var(--muted);text-transform:uppercase;margin-bottom:3px}
.ev-name{font-family:var(--body);font-size:1.05rem;font-weight:700;margin-bottom:3px}
.ev-meta{font-family:var(--mono);font-size:.6rem;color:var(--muted);line-height:1.5}
.ev-impact{display:inline-block;margin-top:5px;font-family:var(--mono);font-size:.56rem;padding:2px 8px;background:#0a0a0a;border:1px solid #2a2a2a;color:var(--muted)}
.estab-card{background:var(--g2);border:1px solid #222;padding:14px 18px;margin-bottom:8px;cursor:pointer;transition:border-color .15s}
.estab-card:hover{border-color:#444}.estab-card.sel{border-color:var(--yellow)}
.estab-name{font-family:var(--body);font-size:1rem;font-weight:700}
.estab-dist{font-family:var(--mono);font-size:.58rem;color:var(--muted)}
.estab-meta{font-family:var(--mono);font-size:.6rem;color:var(--muted);margin-top:2px}
.estab-street{font-family:var(--mono);font-size:.62rem;color:var(--yellow);margin-top:3px}
.estab-hint{font-family:var(--mono);font-size:.58rem;color:#444;margin-top:4px}
.wx-row{display:flex;gap:2px;flex-wrap:wrap}
.wx-day{background:var(--g2);padding:13px 15px;flex:1;min-width:90px}
.wx-date{font-family:var(--mono);font-size:.56rem;color:var(--muted);margin-bottom:5px}
.wx-icon{font-size:1.5rem;margin-bottom:3px}
.wx-lbl{font-family:var(--mono);font-size:.6rem;color:#888;margin-bottom:3px}
.wx-precip{font-family:var(--mono);font-size:.62rem;color:var(--yellow)}
.signup{background:linear-gradient(135deg,#141000,#0c0c0c);border:2px solid var(--yellow);padding:22px 20px;margin-top:8px}
.signup-title{font-family:var(--display);font-size:1.7rem;letter-spacing:.04em;margin-bottom:3px}
.signup-sub{font-family:var(--mono);font-size:.62rem;color:var(--muted);margin-bottom:14px}
.phone-row{display:flex;border:1px solid #333;max-width:440px}
.phone-row input{flex:1;background:var(--g1);border:none;outline:none;color:var(--white);font-family:var(--mono);font-size:.85rem;padding:12px 14px}
.phone-row input::placeholder{color:#444}
.phone-row button{background:var(--yellow);color:var(--black);border:none;cursor:pointer;font-family:var(--display);font-size:1.1rem;letter-spacing:.08em;padding:0 16px;transition:background .15s;white-space:nowrap}
.phone-row button:hover{background:var(--yd)}.phone-row button:disabled{opacity:.5;cursor:not-allowed}
.signup-fine{font-family:var(--mono);font-size:.56rem;color:#333;margin-top:9px}
.ok-msg{font-family:var(--mono);font-size:.75rem;color:var(--green)}
.prices{display:flex;gap:2px;margin-top:28px}
.price{background:var(--g2);padding:18px 16px;flex:1}
.price.feat{background:var(--yellow);color:var(--black)}
.p-name{font-family:var(--mono);font-size:.58rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:7px}
.price.feat .p-name{color:#8a6c00}
.p-num{font-family:var(--display);font-size:2.2rem;line-height:1;margin-bottom:2px}
.p-per{font-family:var(--mono);font-size:.58rem;color:var(--muted);margin-bottom:11px}
.price.feat .p-per{color:#8a6c00}
.p-feat{font-family:var(--mono);font-size:.6rem;color:#666;line-height:1.9}
.price.feat .p-feat{color:#5a4500}
.p-feat::before{content:'✓  ';color:var(--yellow)}
.price.feat .p-feat::before{color:var(--black)}
.p-cta{margin-top:13px;display:block;width:100%;text-align:center;background:var(--black);color:var(--yellow);font-family:var(--display);font-size:1.1rem;letter-spacing:.1em;padding:10px;border:none;cursor:pointer;transition:opacity .15s}
.p-cta:hover{opacity:.8}
.empty{font-family:var(--mono);font-size:.68rem;color:#444;padding:14px 0}
.ambiguous-wrap{min-height:calc(100vh - 60px);padding:32px 24px;max-width:600px;margin:0 auto;animation:up .3s ease;}
.ambiguous-title{font-family:var(--display);font-size:2rem;letter-spacing:.04em;margin-bottom:6px;}
.ambiguous-sub{font-family:var(--mono);font-size:.65rem;color:var(--muted);letter-spacing:.06em;margin-bottom:24px;}
.ambiguous-category{font-family:var(--mono);font-size:.6rem;color:var(--yellow);letter-spacing:.15em;text-transform:uppercase;margin-bottom:8px;margin-top:20px;}
.ambiguous-option{display:flex;align-items:center;justify-content:space-between;background:var(--g2);border:1px solid #2a2a2a;padding:14px 18px;margin-bottom:6px;cursor:pointer;transition:border-color .15s;}
.ambiguous-option:hover{border-color:var(--yellow);}
.ambiguous-option-label{font-family:var(--body);font-size:1.05rem;font-weight:600;color:var(--white);}
.ambiguous-option-meta{font-family:var(--mono);font-size:.6rem;color:var(--muted);margin-top:2px;}
.ambiguous-arrow{font-family:var(--mono);font-size:.8rem;color:var(--muted);}
inset:0;background:rgba(0,0,0,.92);z-index:500;display:flex;align-items:flex-end;justify-content:center}
.paywall-sheet{background:var(--g2);border-top:3px solid var(--yellow);padding:32px 24px 48px;width:100%;max-width:500px;animation:slideUp .3s ease}
.paywall-icon{font-size:2.5rem;margin-bottom:12px}
.paywall-title{font-family:var(--display);font-size:2.2rem;letter-spacing:.04em;margin-bottom:8px}
.paywall-sub{font-family:var(--mono);font-size:.72rem;color:var(--muted);line-height:1.7;margin-bottom:20px}
.paywall-plans{display:flex;gap:8px;margin-bottom:12px}
.paywall-plan{flex:1;background:var(--g1);border:1px solid #2a2a2a;padding:16px 12px;cursor:pointer;text-align:center;transition:border-color .15s}
.paywall-plan:hover{border-color:#555}.paywall-plan.best{border-color:var(--yellow)}
.pp-name{font-family:var(--mono);font-size:.6rem;letter-spacing:.1em;color:var(--muted);text-transform:uppercase;margin-bottom:6px}
.paywall-plan.best .pp-name{color:var(--yellow)}
.pp-price{font-family:var(--display);font-size:1.8rem}
.pp-per{font-family:var(--mono);font-size:.58rem;color:var(--muted)}
.pp-tag{font-family:var(--mono);font-size:.55rem;background:var(--yellow);color:var(--black);padding:2px 6px;margin-top:4px;display:inline-block}
.paywall-cta{display:block;width:100%;background:var(--yellow);color:var(--black);border:none;cursor:pointer;font-family:var(--display);font-size:1.4rem;letter-spacing:.1em;padding:16px;margin-bottom:10px}
.paywall-apple{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:#000;color:#fff;border:none;cursor:pointer;font-family:var(--body);font-size:1rem;font-weight:600;padding:14px;margin-bottom:8px;border-radius:8px}
.paywall-dismiss{display:block;width:100%;background:none;border:none;color:#555;font-family:var(--mono);font-size:.65rem;cursor:pointer;padding:8px}
.paywall-dismiss:hover{color:var(--white)}
@keyframes up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
@media(max-width:520px){.cards{grid-template-columns:1fr 1fr}.prices{flex-direction:column}.wx-row{flex-direction:column}}
`;

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function App() {
  // All useState hooks first — no exceptions
  const [phase,          setPhase]          = useState("home");
  const [query,          setQuery]          = useState("");
  const [locData,        setLocData]        = useState(null);
  const [coords,         setCoords]         = useState(null);
  const [err,            setErr]            = useState(null);
  const [cleaning,       setCleaning]       = useState([]);
  const [films,          setFilms]          = useState([]);
  const [events,         setEvents]         = useState([]);
  const [weather,        setWeather]        = useState(null);
  const [asp,            setAsp]            = useState(null);
  const [selectedEstab,  setSelectedEstab]  = useState(null);
  const [phone,          setPhone]          = useState("");
  const [signupBusy,     setSignupBusy]     = useState(false);
  const [signedUp,       setSignedUp]       = useState(false);
  const [signupErr,      setSignupErr]      = useState(null);
  const [checkoutBusy,   setCheckoutBusy]   = useState(null);
  const [showPaywall,    setShowPaywall]    = useState(false);
  const [searchCount,    setSearchCount]    = useState(() => Storage.getCount());
  const [isSubscribed]                      = useState(() => Storage.isSubscribed());
  const [savedSearches,  setSavedSearches]  = useState(() => Storage.getSaved());
  const [showHistory,    setShowHistory]    = useState(false);

  // All useCallback hooks next — defined in dependency order
  const resetHome = useCallback(() => {
    setPhase("home"); setLocData(null); setSignedUp(false);
    setQuery(""); setSelectedEstab(null); setErr(null);
  }, []);

  const canSearch = useCallback(() => {
    if (Storage.isSubscribed()) return true;
    if (Storage.getCount() >= 2) { setShowPaywall(true); return false; }
    return true;
  }, []);

  const tickSearch = useCallback(() => {
    setSearchCount(Storage.incCount());
  }, []);

  const loadCleaningForStreets = useCallback(async (streets, lat, lng) => {
    const res = await Promise.all(streets.map(s => getCleaning(s, lat, lng)));
    return res.flatMap((r, i) => r.map(c => ({ ...c, street: streets[i] })));
  }, []);

  const loadAll = useCallback(async (loc) => {
    setLocData(loc);
    setCoords({ lat: loc.lat, lng: loc.lng });
    setSelectedEstab(null);
    setPhase("loading");
    const saved = Storage.saveSearch(loc);
    if (saved) setSavedSearches(saved);
    const streets = loc.isPark && loc.parkStreets?.length ? loc.parkStreets : loc.isZip && loc.zipStreets?.length ? loc.zipStreets : [loc.street];
    const [cR, fR, evR, wxR, aR] = await Promise.allSettled([
      loadCleaningForStreets(streets, loc.lat, loc.lng),
      getFilms(loc.street), getEvents(loc.borough),
      getWeather(loc.lat, loc.lng), getASP(),
    ]);
    setCleaning(cR.status === "fulfilled" ? cR.value : []);
    setFilms(fR.status === "fulfilled" ? fR.value : []);
    setEvents(evR.status === "fulfilled" ? evR.value : []);
    setWeather(wxR.status === "fulfilled" ? wxR.value : null);
    setAsp(aR.status === "fulfilled" ? aR.value : null);
    setPhase("dash");
  }, [loadCleaningForStreets]);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    if (!canSearch()) return;
    tickSearch();
    setErr(null); setPhase("loading");
    try {
      const loc = await geocode(q, coords?.lat, coords?.lng);
      if (loc.type === "ambiguous") {
        setLocData(loc);
        setPhase("ambiguous");
        return;
      }
      if (loc.isEstablishment) {
        setLocData(loc);
        setCoords({ lat: loc.establishments[0]?.lat || 40.758, lng: loc.establishments[0]?.lng || -73.9855 });
        const saved = Storage.saveSearch(loc);
        if (saved) setSavedSearches(saved);
        setPhase("dash");
        setCleaning([]); setFilms([]); setEvents([]); setWeather(null); setAsp(null);
      } else {
        await loadAll(loc);
      }
    } catch (e) { setErr(e.message); setPhase("home"); }
  }, [query, coords, canSearch, tickSearch, loadAll]);

  const handleGPS = useCallback(() => {
    setErr(null);
    if (!canSearch()) return;
    if (!navigator.geolocation) { setErr("Geolocation not available."); return; }
    tickSearch();
    setPhase("loading");
    navigator.geolocation.getCurrentPosition(
      async ({ coords: { latitude: lat, longitude: lng } }) => {
        setCoords({ lat, lng });
        try { const loc = await reverseGeocode(lat, lng); await loadAll({ ...loc, lat, lng }); }
        catch (e) { setErr(e.message); setPhase("home"); }
      },
      (e) => { setErr(e.code === 1 ? "Location blocked. Allow in Safari → Settings → Privacy." : "Could not get location."); setPhase("home"); },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }, [canSearch, tickSearch, loadAll]);

  const handleCheckout = useCallback(async (plan) => {
    setCheckoutBusy(plan);
    try {
      const r = await fetch(`${API}/create-checkout-session`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ plan, phone, street: locData?.street || "" }) });
      const d = await r.json();
      if (d.url) window.location.href = d.url;
    } catch(e) { console.error(e); } finally { setCheckoutBusy(null); }
  }, [phone, locData]);

  const handleSignup = useCallback(async () => {
    if (phone.replace(/\D/g,"").length < 10) { setSignupErr("Enter a valid US phone number"); return; }
    setSignupBusy(true); setSignupErr(null);
    try {
      const r = await fetch(`${API}/subscribe`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ phone, street: locData?.street||"", borough: locData?.borough||"", lat: coords?.lat, lng: coords?.lng }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Signup failed");
      setSignedUp(true);
    } catch(e) { setSignupErr(e.message); } finally { setSignupBusy(false); }
  }, [phone, locData, coords]);

  // useEffect last — after all useCallback
  useEffect(() => {
    if (window.__AUTO_GPS__) { window.__AUTO_GPS__ = false; setTimeout(handleGPS, 500); }
  }, [handleGPS]);

  // Derived values (not hooks)
  const today        = todayAbbr();
  const cleanToday   = cleaning.some(c => c.days?.includes(today));
  const aspOff       = asp?.suspended;
  const wxNow        = weather?.current;
  const wxDaily      = weather?.daily;
  const severeNow    = wxNow?.weather_code && SEVERE.has(wxNow.weather_code);
  const isMulti      = locData?.isPark || locData?.isZip;
  const histPins     = showHistory && isSubscribed ? savedSearches.filter(s => s.label !== (locData?.label || locData?.street)) : [];
  const remaining    = Math.max(0, 2 - searchCount);

  return (
    <>
      <style>{css}</style>

      {/* NAV */}
      <nav className="nav">
        <div className="logo" onClick={resetHome}>STREET PARK <span>INFO</span></div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span className="pill">NYC</span>
          {phase === "dash" && <button className="pill ghost" onClick={resetHome}>↺ CHANGE</button>}
        </div>
      </nav>

      {/* HOME */}
      {phase === "home" && (
        <div className="home">
          <h1 className="h1">KNOW BEFORE<br /><em>YOU PARK.</em></h1>
          <p className="sub">Street cleaning · Film shoots · Events · Weather<br /><strong>Search any street, zip, neighborhood, park, or business.</strong></p>
          <div className="search-wrap">
            {!isSubscribed && searchCount > 0 && (
              <div className="gate-note" style={{color: remaining === 0 ? "var(--red)" : "var(--yellow)"}}>
                {remaining === 0 ? "⚠ Free searches used — subscribe to continue" : `${remaining} free search${remaining === 1 ? "" : "es"} remaining`}
              </div>
            )}
            <div className="search-box">
              <input type="text" placeholder="Broadway, 11211, Central Park, McDonald's, intrepid…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()} autoFocus />
              <button onClick={handleSearch}>LOOK UP</button>
            </div>
            <div className="or">— or —</div>
            <button className="gps-btn" onClick={handleGPS}>📍 Use my current location</button>
            {err && <div className="err">⚠ {err}</div>}
          </div>
        </div>
      )}

      {/* LOADING */}
      {phase === "loading" && (
        <div className="loading"><div className="spin" /><div className="loading-lbl">Scanning NYC databases…</div></div>
      )}

      {/* AMBIGUOUS PICKER */}
      {phase === "ambiguous" && locData?.options && (
        <div className="ambiguous-wrap">
          <div className="ambiguous-title">Did you mean…</div>
          <div className="ambiguous-sub">"{locData.originalQuery}" could refer to a few things in NYC. Pick one:</div>
          {Object.entries(
            locData.options.reduce((acc, opt) => {
              const cat = opt.category || "Other";
              if (!acc[cat]) acc[cat] = [];
              acc[cat].push(opt);
              return acc;
            }, {})
          ).map(([category, options]) => (
            <div key={category}>
              <div className="ambiguous-category">{category}</div>
              {options.map((opt, i) => (
                <div key={i} className="ambiguous-option" onClick={() => loadAll(opt)}>
                  <div>
                    <div className="ambiguous-option-label">{opt.label}</div>
                    <div className="ambiguous-option-meta">{opt.borough}{opt.neighborhood ? ` · ${opt.neighborhood}` : ""}</div>
                  </div>
                  <span className="ambiguous-arrow">→</span>
                </div>
              ))}
            </div>
          ))}
          <button className="re-btn" style={{marginTop:24}} onClick={resetHome}>← Back to search</button>
        </div>
      )}

      {/* DASHBOARD */}
      {phase === "dash" && locData && (
        <div className="dash">

          {/* Loc bar */}
          <div className="loc-bar">
            <div>
              <div className="loc-eyebrow">📍 {locData.isEstablishment ? "Search results" : "Your location"}</div>
              <div className="loc-name">{locData.label || locData.street}</div>
              <div className="loc-meta">{locData.isEstablishment ? `${locData.establishments?.length} locations · sorted by distance` : [locData.neighborhood,locData.borough].filter(Boolean).join(" · ") + " · Updated just now"}</div>
            </div>
            {!locData.isEstablishment && <button className="re-btn" onClick={() => loadAll(locData)}>↻ REFRESH</button>}
          </div>

          {/* Map */}
          {locData.lat && locData.lng && (
            <div className="map-wrap">
              <ParkMap
                destLat={selectedEstab?.lat || locData.lat}
                destLng={selectedEstab?.lng || locData.lng}
                userLat={coords?.lat !== locData.lat ? coords?.lat : null}
                userLng={coords?.lng !== locData.lng ? coords?.lng : null}
                label={selectedEstab?.name || locData.label || locData.street}
                history={histPins}
              />
              <div className="map-legend">
                <div className="map-legend-item"><div className="map-dot" style={{background:"var(--red)"}} /><span>Destination</span></div>
                {coords?.lat && coords.lat !== locData.lat && <div className="map-legend-item"><div className="map-dot" style={{background:"var(--blue)"}} /><span>You</span></div>}
                {histPins.length > 0 && <div className="map-legend-item"><div className="map-dot" style={{background:"var(--green)"}} /><span>Previous searches</span></div>}
              </div>
            </div>
          )}

          {/* History toggle */}
          <div className="history-wrap">
            <label className="htoggle">
              <input type="checkbox" checked={showHistory && isSubscribed} onChange={e => { if (!isSubscribed) { setShowPaywall(true); return; } setShowHistory(e.target.checked); }} />
              <span className="htoggle-label">Show my previous searches {!isSubscribed && "🔒"}</span>
            </label>
            {!isSubscribed && <div className="hsub" onClick={() => setShowPaywall(true)}>Subscribe to save and view your search history on the map →</div>}
            {showHistory && isSubscribed && savedSearches.length === 0 && <div className="hsub">No saved searches yet</div>}
            {showHistory && isSubscribed && savedSearches.length > 0 && (
              <div className="hlist">
                {savedSearches.map(s => (
                  <div key={s.id} className="hitem" onClick={() => { setQuery(s.label); handleSearch(); }}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div className={`hdot ${s.type !== "establishment" ? "area" : ""}`} />
                      <div><div className="hitem-label">{s.label}</div><div className="hitem-meta">{s.borough}{s.neighborhood ? ` · ${s.neighborhood}` : ""}</div></div>
                    </div>
                    <div className="hitem-ts">{s.ts}</div>
                  </div>
                ))}
                <button className="hclear" onClick={() => { Storage.clearSaved(); setSavedSearches([]); }}>Clear history</button>
              </div>
            )}
          </div>

          {/* GPS prompt */}
          {!coords?.lat && !locData.isEstablishment && (
            <div className="gps-prompt">
              <div className="gps-prompt-text">📍 Enable location for a blue pin showing where you are</div>
              <button className="gps-prompt-btn" onClick={handleGPS}>ENABLE →</button>
            </div>
          )}

          {/* Establishment view */}
          {locData.isEstablishment ? (
            <div className="sec">
              <div className="sec-hd">📍 Locations {locData.establishments?.length > 0 && <span className="badge">{locData.establishments.length}</span>}</div>
              <div className="sec-note">Tap a location to see its street cleaning schedule</div>
              {locData.establishments?.map((e, i) => {
                const dist = coords ? haversineKm(coords.lat, coords.lng, e.lat, e.lng) : null;
                const isSel = selectedEstab?.name === e.name;
                return (
                  <div key={i} className={`estab-card ${isSel ? "sel" : ""}`} onClick={async () => {
                    setSelectedEstab(e);
                    const c = await getCleaning(e.street, e.lat, e.lng);
                    setCleaning(c.map(x => ({ ...x, street: e.street })));
                  }}>
                    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
                      <div className="estab-name">{e.name}</div>
                      {dist !== null && <div className="estab-dist">{fmtKm(dist)}</div>}
                    </div>
                    <div className="estab-meta">{e.address} · {e.borough}</div>
                    <div className="estab-street">{e.street}</div>
                    {isSel && cleaning.length > 0 && cleaning.map((c, ci) => (
                      <div key={ci} style={{marginTop:10,borderTop:"1px solid #2a2a2a",paddingTop:8}}>
                        <div className="chips">{DAYS.map(d => <span key={d} className={`chip ${c.days?.includes(d) ? "on" : ""}`}>{d}</span>)}</div>
                        {c.time && <div className="clean-time" style={{fontSize:"1.2rem"}}>{c.time}</div>}
                        {c.side && <div className="side-tag" style={{marginTop:4}}>{c.side}</div>}
                      </div>
                    ))}
                    {!isSel && <div className="estab-hint">Tap to see cleaning schedule →</div>}
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              {/* Status cards */}
              <div className="cards">
                <div className={`card ${aspOff ? "ok" : cleanToday ? "alert" : "ok"}`}>
                  <div className="card-lbl">Street Cleaning</div>
                  <div className="card-val">{aspOff ? "SUSPENDED" : cleanToday ? "TODAY" : "NOT TODAY"}</div>
                  <div className="card-sub">{aspOff ? "ASP holiday" : cleanToday ? "Move your car!" : "You're good"}</div>
                </div>
                <div className={`card ${films.length ? "orange" : "ok"}`}>
                  <div className="card-lbl">Film Permits</div>
                  <div className="card-val">{films.length ? `${films.length} NEARBY` : "CLEAR"}</div>
                  <div className="card-sub">{films.length ? "Parking held" : "No shoots"}</div>
                </div>
                <div className={`card ${events.length ? "info" : "ok"}`}>
                  <div className="card-lbl">Public Events</div>
                  <div className="card-val">{events.length ? `${events.length} THIS WEEK` : "CLEAR"}</div>
                  <div className="card-sub">{events.length ? "May affect parking" : "None listed"}</div>
                </div>
                <div className={`card ${severeNow ? "warn" : "ok"}`}>
                  <div className="card-lbl">Weather</div>
                  <div className="card-val">{wxNow ? `${Math.round(wxNow.temperature_2m)}°F` : "—"}</div>
                  <div className="card-sub">{severeNow ? WX[wxNow.weather_code] : wxNow ? `Wind ${Math.round(wxNow.wind_speed_10m)}mph` : "—"}</div>
                </div>
              </div>

              {/* Cleaning */}
              <div className="sec">
                <div className="sec-hd">🧹 Street Cleaning {cleaning.length > 0 && <span className="badge">{cleaning.length}</span>}</div>
                {isMulti && <div className="sec-note">Showing {locData.isPark ? "all bordering streets" : "streets in this zip"}</div>}
                {cleaning.length === 0 ? <div className="empty">No street cleaning regulations found for this block.</div>
                  : cleaning.map((c, i) => (
                    <div key={i} className={`clean-card ${c.days?.includes(today) ? "today" : ""}`}>
                      {c.days?.includes(today) && <span className="today-tag">⚠ CLEANING TODAY</span>}
                      {isMulti && c.street && <div className="street-lbl">{c.street}</div>}
                      {c.side && <div className="side-tag">{c.side === "L" ? "Left / Even" : c.side === "R" ? "Right / Odd" : c.side}</div>}
                      <div className="chips">{DAYS.map(d => <span key={d} className={`chip ${c.days?.includes(d) ? "on" : ""}`}>{d}</span>)}</div>
                      {c.time && <div className="clean-time">{c.time}</div>}
                      <div className="clean-raw">{c.raw}</div>
                    </div>
                  ))}
              </div>

              {/* Film permits */}
              <div className="sec">
                <div className="sec-hd">🎬 Film & TV Permits {films.length > 0 && <span className="badge">{films.length}</span>}</div>
                {films.length === 0 ? <div className="empty">No active film permits on your street this week.</div>
                  : films.map((f, i) => (
                    <div key={i} className="ev-card film">
                      <div className="ev-type">🎬 {f.type} · {f.subtype}</div>
                      <div className="ev-name">Film Permit</div>
                      <div className="ev-meta">{fmtDT(f.start)} → {fmtDT(f.end)}{f.parkingHeld && <><br />Parking held: {f.parkingHeld.substring(0,140)}{f.parkingHeld.length>140?"…":""}</>}</div>
                      <span className="ev-impact">⚠ Parking restricted during shoot</span>
                    </div>
                  ))}
              </div>

              {/* Events */}
              <div className="sec">
                <div className="sec-hd">📅 Public Events {events.length > 0 && <span className="badge">{events.length}</span>}</div>
                {events.length === 0 ? <div className="empty">No permitted public events in your borough this week.</div>
                  : events.slice(0,5).map((ev, i) => (
                    <div key={i} className="ev-card">
                      <div className="ev-type">📅 {ev.type}</div>
                      <div className="ev-name">{ev.name}</div>
                      <div className="ev-meta">{ev.start && `Starts: ${ev.start}`}{ev.location && ` · ${ev.location}`}{ev.borough && ` · ${ev.borough}`}</div>
                      {ev.parkingImpacted && <span className="ev-impact">⚠ Parking may be impacted</span>}
                    </div>
                  ))}
              </div>

              {/* Weather */}
              <div className="sec">
                <div className="sec-hd">🌤 Weather Forecast</div>
                {!weather ? <div className="empty">Weather data unavailable.</div> : (
                  <>
                    {severeNow && <div className="ev-card severe" style={{marginBottom:8}}><div className="ev-type">⚠ WEATHER ALERT</div><div className="ev-name">{WX[wxNow.weather_code]}</div><div className="ev-meta">May affect parking rules and street cleaning enforcement.</div></div>}
                    <div className="wx-row">
                      {(wxDaily?.time || []).slice(0,3).map((ds, i) => {
                        const code = wxDaily.weather_code?.[i], rain = wxDaily.precipitation_sum?.[i], snow = wxDaily.snowfall_sum?.[i];
                        const lbl = i===0?"Today":i===1?"Tomorrow":new Date(ds+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
                        return (
                          <div key={i} className="wx-day">
                            <div className="wx-date">{lbl}</div>
                            <div className="wx-icon">{wxIcon(code)}</div>
                            <div className="wx-lbl">{WX[code] || "Clear"}</div>
                            {(rain>0.05||snow>0.1) && <div className="wx-precip">{snow>0.1?`❄ ${snow.toFixed(1)}" snow`:`💧 ${rain?.toFixed(2)}" rain`}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* Signup */}
          <div className="signup">
            <div className="signup-title">GET TEXTED BEFORE IT MATTERS</div>
            <div className="signup-sub">Street cleaning · Film shoots · Snowstorms · Events · FREE 30-day trial</div>
            {!signedUp ? (
              <>
                <div className="phone-row">
                  <input type="tel" placeholder="+1 (917) 555-0100" value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => e.key==="Enter" && handleSignup()} />
                  <button onClick={handleSignup} disabled={signupBusy}>{signupBusy ? "…" : "SIGN ME UP →"}</button>
                </div>
                {signupErr && <div style={{fontFamily:"var(--mono)",fontSize:".62rem",color:"var(--red)",marginTop:8}}>⚠ {signupErr}</div>}
                <div className="signup-fine">$2.99/mo after trial · Cancel anytime · Reply STOP to unsubscribe</div>
              </>
            ) : <div className="ok-msg">✅ Done! Check your phone. Upgrade below to keep alerts after 30 days.</div>}
          </div>

          {/* Pricing */}
          <div className="prices">
            {[
              {key:"monthly",name:"Monthly",price:"$2.99",per:"/month",features:["SMS alerts","1 address","Film & event alerts","ASP alerts"]},
              {key:"annual",name:"Annual · Best Value",price:"$19",per:"/year · save 47%",features:["SMS alerts","3 addresses","Film & event alerts","Priority weather"],feat:true},
            ].map(p => (
              <div key={p.key} className={`price ${p.feat ? "feat" : ""}`}>
                <div className="p-name">{p.name}</div>
                <div className="p-num">{p.price}</div>
                <div className="p-per">{p.per}</div>
                {p.features.map(f => <div key={f} className="p-feat">{f}</div>)}
                <button className="p-cta" disabled={!!checkoutBusy} onClick={() => handleCheckout(p.key)}>{checkoutBusy===p.key?"LOADING…":"START FREE TRIAL →"}</button>
              </div>
            ))}
          </div>

        </div>
      )}

      {/* PAYWALL */}
      {showPaywall && (
        <div className="paywall-overlay" onClick={() => setShowPaywall(false)}>
          <div className="paywall-sheet" onClick={e => e.stopPropagation()}>
            <div className="paywall-icon">🚗</div>
            <div className="paywall-title">UNLOCK STREET PARK INFO</div>
            <div className="paywall-sub">You've used your 2 free searches. Subscribe to keep searching, save your history, and get SMS alerts before your car gets ticketed.</div>
            <button className="paywall-apple" onClick={() => handleCheckout("annual")}> Subscribe with Apple</button>
            <div className="paywall-plans">
              {[{key:"monthly",name:"Monthly",price:"$2.99",per:"/mo"},{key:"annual",name:"Annual",price:"$19",per:"/yr",tag:"SAVE 47%"}].map(p => (
                <div key={p.key} className={`paywall-plan ${p.tag?"best":""}`} onClick={() => handleCheckout(p.key)}>
                  <div className="pp-name">{p.name}</div>
                  <div className="pp-price">{p.price}</div>
                  <div className="pp-per">{p.per}</div>
                  {p.tag && <div className="pp-tag">{p.tag}</div>}
                </div>
              ))}
            </div>
            <button className="paywall-cta" onClick={() => handleCheckout("annual")}>START 30-DAY FREE TRIAL →</button>
            <button className="paywall-dismiss" onClick={() => setShowPaywall(false)}>Maybe later</button>
          </div>
        </div>
      )}
    </>
  );
}
