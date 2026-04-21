import { useState, useCallback, useEffect, useRef } from "react";

const API = import.meta.env?.VITE_BACKEND_URL || "https://street-park-info-backend.onrender.com";

const WX_LABELS = {
  0:"Clear",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",
  45:"Foggy",48:"Icy fog",51:"Light drizzle",53:"Drizzle",55:"Heavy drizzle",
  61:"Light rain",63:"Rain",65:"Heavy rain",71:"Light snow",73:"Snow",75:"Heavy snow",
  77:"Snow grains",80:"Rain showers",81:"Showers",82:"Heavy showers",
  85:"Snow showers",86:"Heavy snow showers",95:"Thunderstorm",96:"Thunderstorm + hail",99:"Severe thunderstorm",
};
const SEVERE = new Set([51,53,55,61,63,65,71,73,75,77,80,81,82,85,86,95,96,99]);
function wxIcon(c) {
  if([95,96,99].includes(c)) return "⛈";
  if([71,73,75,77,85,86].includes(c)) return "❄";
  if([61,63,65,80,81,82].includes(c)) return "🌧";
  if([51,53,55].includes(c)) return "🌦";
  if([45,48].includes(c)) return "🌫";
  if(c>=1&&c<=3) return "⛅";
  return "☀";
}

function haversineKm(lat1,lng1,lat2,lng2) {
  const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function fmtKm(km) {
  if(km<1) return `${Math.round(km*1000)}m away`;
  return `${km.toFixed(1)}km away`;
}

async function geocode(input, userLat, userLng) {
  const params = new URLSearchParams({ q: input.trim() });
  if (userLat && userLng) { params.set("userLat", userLat); params.set("userLng", userLng); }
  const r = await fetch(`${API}/api/geocode?${params}`);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `Could not find "${input}" in NYC`);
  return d;
}

async function reverseGeocode(lat, lng) {
  const r = await fetch(`${API}/api/reverse-geocode?lat=${lat}&lng=${lng}`);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Could not identify your street");
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
  try { const r = await fetch(`${API}/api/events?borough=${encodeURIComponent(borough||"")}`); return r.ok ? r.json() : []; } catch { return []; }
}

async function getWeather(lat, lng) {
  try { const r = await fetch(`${API}/api/weather?lat=${lat}&lng=${lng}`); return r.ok ? r.json() : null; } catch { return null; }
}

async function getASP() {
  try { const r = await fetch(`${API}/api/asp`); return r.ok ? r.json() : { suspended: false }; } catch { return { suspended: false }; }
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@400;500&family=Barlow+Condensed:wght@400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{--black:#080808;--yellow:#F7C948;--yd:#c9a010;--white:#EDEBE4;--g1:#141414;--g2:#1e1e1e;--g3:#2c2c2c;--muted:#555;--red:#E53E3E;--green:#38A169;--blue:#3182CE;--orange:#DD6B20;--mono:'IBM Plex Mono',monospace;--display:'Bebas Neue',sans-serif;--body:'Barlow Condensed',sans-serif;}
html,body{background:var(--black);color:var(--white);font-family:var(--body);min-height:100vh;overflow-x:hidden;}

.nav{position:sticky;top:0;z-index:100;background:var(--black);border-bottom:2px solid var(--yellow);display:flex;align-items:center;justify-content:space-between;padding:0 20px;height:60px;}
.logo{font-family:var(--display);font-size:1.9rem;letter-spacing:.06em;color:var(--yellow);line-height:1;cursor:pointer;transition:opacity .15s;}
.logo:hover{opacity:.8;}
.logo span{color:var(--white);}
.pill{font-family:var(--mono);font-size:.6rem;letter-spacing:.12em;padding:4px 9px;background:var(--yellow);color:var(--black);}
.pill.ghost{background:none;border:1px solid #333;color:#777;cursor:pointer;transition:all .15s;}
.pill.ghost:hover{border-color:#666;color:var(--white);}

.home{min-height:calc(100vh - 60px);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 24px;text-align:center;animation:up .4s ease;}
.h1{font-family:var(--display);font-size:clamp(3rem,9vw,5.5rem);letter-spacing:.04em;line-height:.92;margin-bottom:16px;}
.h1 em{color:var(--yellow);font-style:normal;}
.sub{font-family:var(--mono);font-size:.72rem;color:var(--muted);letter-spacing:.08em;line-height:1.8;max-width:420px;margin:0 auto 32px;}
.sub strong{color:var(--white);}
.search-wrap{width:100%;max-width:540px;}
.search-box{display:flex;border:2px solid var(--yellow);background:var(--g2);}
.search-box input{flex:1;background:none;border:none;outline:none;color:var(--white);font-family:var(--mono);font-size:.9rem;padding:14px 18px;letter-spacing:.04em;}
.search-box input::placeholder{color:#444;}
.search-box button{background:var(--yellow);border:none;cursor:pointer;font-family:var(--display);font-size:1.4rem;letter-spacing:.1em;padding:0 22px;transition:background .15s;white-space:nowrap;}
.search-box button:hover{background:var(--yd);}
.or{font-family:var(--mono);font-size:.65rem;color:#444;letter-spacing:.1em;margin:16px 0;}
.gps-btn{background:none;border:1px solid #333;color:#888;font-family:var(--mono);font-size:.7rem;letter-spacing:.1em;padding:10px 20px;cursor:pointer;transition:all .15s;display:flex;align-items:center;gap:8px;}
.gps-btn:hover{border-color:var(--yellow);color:var(--yellow);}
.err{font-family:var(--mono);font-size:.68rem;color:var(--red);letter-spacing:.05em;margin-top:14px;max-width:440px;}

.loading{min-height:calc(100vh - 60px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;}
.spin{width:44px;height:44px;border:3px solid #222;border-top-color:var(--yellow);border-radius:50%;animation:spin .7s linear infinite;}
.loading-lbl{font-family:var(--mono);font-size:.7rem;color:var(--muted);letter-spacing:.15em;text-transform:uppercase;}

.dash{padding:0 20px 80px;max-width:800px;margin:0 auto;}
.loc-bar{padding:18px 0 14px;display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid #1f1f1f;margin-bottom:18px;animation:up .3s ease;}
.loc-eyebrow{font-family:var(--mono);font-size:.58rem;color:var(--yellow);letter-spacing:.15em;text-transform:uppercase;margin-bottom:3px;}
.loc-name{font-family:var(--display);font-size:1.9rem;letter-spacing:.04em;line-height:1;}
.loc-meta{font-family:var(--mono);font-size:.6rem;color:var(--muted);letter-spacing:.05em;margin-top:3px;}
.re-btn{background:none;border:1px solid #2a2a2a;color:#555;font-family:var(--mono);font-size:.58rem;letter-spacing:.1em;padding:6px 11px;cursor:pointer;transition:all .15s;white-space:nowrap;margin-top:4px;}
.re-btn:hover{border-color:#555;color:var(--white);}

.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:2px;margin-bottom:20px;animation:up .3s .05s ease both;}
.card{background:var(--g2);padding:14px 16px;position:relative;overflow:hidden;}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--g3);}
.card.ok::before{background:var(--green);}
.card.warn::before{background:var(--yellow);}
.card.alert::before{background:var(--red);}
.card.info::before{background:var(--blue);}
.card.orange::before{background:var(--orange);}
.card-lbl{font-family:var(--mono);font-size:.55rem;letter-spacing:.12em;color:var(--muted);text-transform:uppercase;margin-bottom:5px;}
.card-val{font-family:var(--display);font-size:1.25rem;letter-spacing:.04em;line-height:1.1;}
.card-sub{font-family:var(--mono);font-size:.58rem;color:var(--muted);letter-spacing:.04em;margin-top:3px;}

.sec{margin-bottom:26px;animation:up .3s .1s ease both;}
.sec-hd{display:flex;align-items:center;gap:10px;font-family:var(--mono);font-size:.62rem;letter-spacing:.15em;color:var(--yellow);text-transform:uppercase;margin-bottom:10px;}
.sec-hd::after{content:'';flex:1;height:1px;background:#1f1f1f;}
.badge{background:var(--yellow);color:var(--black);font-size:.55rem;padding:2px 6px;font-weight:500;}

.clean-card{background:var(--g2);border:1px solid #222;padding:15px 18px;margin-bottom:8px;position:relative;}
.clean-card.today{border-color:var(--red);background:#120808;}
.today-tag{position:absolute;top:0;right:0;background:var(--red);color:var(--white);font-family:var(--mono);font-size:.52rem;letter-spacing:.12em;padding:3px 9px;text-transform:uppercase;}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;}
.chip{font-family:var(--mono);font-size:.58rem;letter-spacing:.06em;padding:3px 8px;border:1px solid #2a2a2a;color:#555;}
.chip.on{background:var(--yellow);color:var(--black);border-color:var(--yellow);}
.clean-time{font-family:var(--display);font-size:1.45rem;letter-spacing:.04em;}
.clean-raw{font-family:var(--mono);font-size:.58rem;color:#444;letter-spacing:.03em;margin-top:3px;line-height:1.4;}
.side-tag{display:inline-block;font-family:var(--mono);font-size:.56rem;letter-spacing:.08em;padding:2px 7px;border:1px solid #2a2a2a;color:var(--muted);margin-bottom:6px;}
.street-label{font-family:var(--mono);font-size:.62rem;color:var(--yellow);letter-spacing:.1em;margin-bottom:6px;text-transform:uppercase;}

.ev-card{background:var(--g2);border:1px solid #222;border-left:3px solid var(--blue);padding:13px 16px;margin-bottom:8px;}
.ev-card.film{border-left-color:var(--orange);}
.ev-card.severe{border-left-color:var(--red);background:#12100a;}
.ev-type{font-family:var(--mono);font-size:.56rem;letter-spacing:.12em;color:var(--muted);text-transform:uppercase;margin-bottom:3px;}
.ev-name{font-family:var(--body);font-size:1.05rem;font-weight:700;margin-bottom:3px;}
.ev-meta{font-family:var(--mono);font-size:.6rem;color:var(--muted);letter-spacing:.04em;line-height:1.5;}
.ev-impact{display:inline-block;margin-top:5px;font-family:var(--mono);font-size:.56rem;letter-spacing:.1em;padding:2px 8px;background:#0a0a0a;border:1px solid #2a2a2a;color:var(--muted);}

/* Establishment cards */
.estab-card{background:var(--g2);border:1px solid #222;padding:14px 18px;margin-bottom:8px;cursor:pointer;transition:border-color .15s;}
.estab-card:hover{border-color:#444;}
.estab-card.selected{border-color:var(--yellow);}
.estab-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:4px;}
.estab-name{font-family:var(--body);font-size:1rem;font-weight:700;color:var(--white);}
.estab-dist{font-family:var(--mono);font-size:.58rem;color:var(--muted);letter-spacing:.06em;}
.estab-meta{font-family:var(--mono);font-size:.6rem;color:var(--muted);letter-spacing:.04em;}
.estab-street{font-family:var(--mono);font-size:.62rem;color:var(--yellow);letter-spacing:.08em;margin-top:3px;}
.estab-hint{font-family:var(--mono);font-size:.6rem;color:#444;letter-spacing:.06em;margin-top:3px;}

.wx-row{display:flex;gap:2px;flex-wrap:wrap;}
.wx-day{background:var(--g2);padding:13px 15px;flex:1;min-width:90px;}
.wx-date{font-family:var(--mono);font-size:.56rem;letter-spacing:.1em;color:var(--muted);margin-bottom:5px;}
.wx-icon{font-size:1.5rem;margin-bottom:3px;}
.wx-lbl{font-family:var(--mono);font-size:.6rem;color:#888;letter-spacing:.04em;margin-bottom:3px;}
.wx-precip{font-family:var(--mono);font-size:.62rem;color:var(--yellow);letter-spacing:.04em;}

.signup{background:linear-gradient(135deg,#141000,#0c0c0c);border:2px solid var(--yellow);padding:22px 20px;margin-top:8px;animation:up .3s .2s ease both;}
.signup-title{font-family:var(--display);font-size:1.7rem;letter-spacing:.04em;margin-bottom:3px;}
.signup-sub{font-family:var(--mono);font-size:.62rem;color:var(--muted);letter-spacing:.05em;margin-bottom:14px;}
.phone-row{display:flex;border:1px solid #333;max-width:440px;}
.phone-row input{flex:1;background:var(--g1);border:none;outline:none;color:var(--white);font-family:var(--mono);font-size:.85rem;padding:12px 14px;letter-spacing:.04em;}
.phone-row input::placeholder{color:#444;}
.phone-row button{background:var(--yellow);color:var(--black);border:none;cursor:pointer;font-family:var(--display);font-size:1.1rem;letter-spacing:.08em;padding:0 16px;transition:background .15s;white-space:nowrap;}
.phone-row button:hover{background:var(--yd);}
.phone-row button:disabled{opacity:.5;cursor:not-allowed;}
.signup-fine{font-family:var(--mono);font-size:.56rem;color:#333;margin-top:9px;letter-spacing:.04em;}
.success{font-family:var(--mono);font-size:.75rem;color:var(--green);letter-spacing:.08em;}

.prices{display:flex;gap:2px;margin-top:28px;animation:up .3s .25s ease both;}
.price{background:var(--g2);padding:18px 16px;flex:1;}
.price.feat{background:var(--yellow);color:var(--black);}
.p-name{font-family:var(--mono);font-size:.58rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:7px;}
.price.feat .p-name{color:#8a6c00;}
.p-num{font-family:var(--display);font-size:2.2rem;letter-spacing:.02em;line-height:1;margin-bottom:2px;}
.p-per{font-family:var(--mono);font-size:.58rem;color:var(--muted);margin-bottom:11px;}
.price.feat .p-per{color:#8a6c00;}
.p-feat{font-family:var(--mono);font-size:.6rem;color:#666;letter-spacing:.03em;line-height:1.9;}
.price.feat .p-feat{color:#5a4500;}
.p-feat::before{content:'✓  ';color:var(--yellow);}
.price.feat .p-feat::before{color:var(--black);}
.p-cta{margin-top:13px;display:block;width:100%;text-align:center;background:var(--black);color:var(--yellow);font-family:var(--display);font-size:1.1rem;letter-spacing:.1em;padding:10px;border:none;cursor:pointer;transition:opacity .15s;}
.p-cta:hover{opacity:.8;}

.empty{font-family:var(--mono);font-size:.68rem;color:#444;letter-spacing:.08em;padding:14px 0;}
.sec-note{font-family:var(--mono);font-size:.62rem;color:var(--muted);letter-spacing:.06em;margin-bottom:10px;}

/* MAP */
.map-wrap{position:relative;margin-bottom:20px;border:1px solid #2a2a2a;animation:up .3s ease;}
.map-container{width:100%;height:260px;}
.map-legend{display:flex;gap:16px;padding:8px 12px;background:var(--g2);border-top:1px solid #222;}
.map-legend-item{display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:.6rem;color:var(--muted);letter-spacing:.06em;}
.map-dot{width:10px;height:10px;border-radius:50%;}
.map-dot.blue{background:#3182CE;}
.map-dot.red{background:#E53E3E;}
.map-gps-prompt{background:var(--g2);border:1px solid #2a2a2a;border-left:3px solid var(--yellow);padding:12px 16px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;gap:12px;}
.map-gps-prompt-text{font-family:var(--mono);font-size:.65rem;color:var(--muted);letter-spacing:.05em;line-height:1.5;}
.map-gps-btn{background:var(--yellow);color:var(--black);border:none;cursor:pointer;font-family:var(--mono);font-size:.6rem;letter-spacing:.1em;padding:7px 14px;white-space:nowrap;transition:background .15s;}
.map-gps-btn:hover{background:var(--yd);}

/* PAYWALL MODAL */
.paywall-overlay{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:500;display:flex;align-items:flex-end;justify-content:center;padding:0;}
.paywall-sheet{background:var(--g2);border-top:3px solid var(--yellow);padding:32px 24px 48px;width:100%;max-width:500px;animation:slideUp .3s ease;}
.paywall-icon{font-size:2.5rem;margin-bottom:12px;}
.paywall-title{font-family:var(--display);font-size:2.2rem;letter-spacing:.04em;margin-bottom:8px;}
.paywall-sub{font-family:var(--mono);font-size:.72rem;color:var(--muted);letter-spacing:.05em;line-height:1.7;margin-bottom:24px;}
.paywall-free-count{font-family:var(--mono);font-size:.65rem;color:var(--yellow);letter-spacing:.08em;margin-bottom:20px;padding:8px 12px;border:1px solid #2a2a2a;background:var(--g1);}
.paywall-plans{display:flex;gap:8px;margin-bottom:16px;}
.paywall-plan{flex:1;background:var(--g1);border:1px solid #2a2a2a;padding:16px 12px;cursor:pointer;transition:border-color .15s;text-align:center;}
.paywall-plan:hover{border-color:#555;}
.paywall-plan.best{border-color:var(--yellow);}
.paywall-plan-name{font-family:var(--mono);font-size:.6rem;letter-spacing:.1em;color:var(--muted);text-transform:uppercase;margin-bottom:6px;}
.paywall-plan.best .paywall-plan-name{color:var(--yellow);}
.paywall-plan-price{font-family:var(--display);font-size:1.8rem;letter-spacing:.04em;}
.paywall-plan-per{font-family:var(--mono);font-size:.58rem;color:var(--muted);}
.paywall-plan-tag{font-family:var(--mono);font-size:.55rem;background:var(--yellow);color:var(--black);padding:2px 6px;margin-top:4px;display:inline-block;}
.paywall-cta{display:block;width:100%;background:var(--yellow);color:var(--black);border:none;cursor:pointer;font-family:var(--display);font-size:1.4rem;letter-spacing:.1em;padding:16px;transition:background .15s;margin-bottom:12px;}
.paywall-cta:hover{background:var(--yd);}
.paywall-dismiss{display:block;width:100%;background:none;border:none;color:#555;font-family:var(--mono);font-size:.65rem;letter-spacing:.1em;cursor:pointer;padding:8px;}
.paywall-dismiss:hover{color:var(--white);}
.paywall-apple{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:#000;color:#fff;border:none;cursor:pointer;font-family:var(--body);font-size:1rem;font-weight:600;padding:14px;margin-bottom:8px;border-radius:8px;transition:opacity .15s;}
.paywall-apple:hover{opacity:.85;}

/* HISTORY */
.history-toggle{display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 0;margin-bottom:4px;}
.history-toggle input[type=checkbox]{width:16px;height:16px;accent-color:var(--yellow);cursor:pointer;}
.history-toggle-label{font-family:var(--mono);font-size:.68rem;color:var(--white);letter-spacing:.06em;cursor:pointer;}
.history-toggle-sub{font-family:var(--mono);font-size:.58rem;color:var(--muted);letter-spacing:.04em;margin-left:26px;margin-bottom:12px;}
.history-list{margin-bottom:8px;}
.history-item{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--g1);border:1px solid #1f1f1f;margin-bottom:4px;cursor:pointer;transition:border-color .15s;}
.history-item:hover{border-color:#333;}
.history-item-left{display:flex;align-items:center;gap:8px;}
.history-dot{width:8px;height:8px;border-radius:50%;background:var(--green);flex-shrink:0;}
.history-dot.area{background:none;border:2px solid var(--green);}
.history-item-label{font-family:var(--mono);font-size:.65rem;color:var(--white);letter-spacing:.04em;}
.history-item-meta{font-family:var(--mono);font-size:.56rem;color:var(--muted);letter-spacing:.04em;}
.history-item-ts{font-family:var(--mono);font-size:.55rem;color:#444;letter-spacing:.04em;}
.history-clear{font-family:var(--mono);font-size:.6rem;color:#444;letter-spacing:.08em;background:none;border:none;cursor:pointer;padding:4px 0;}
.history-clear:hover{color:var(--red);}
.history-locked{font-family:var(--mono);font-size:.65rem;color:var(--muted);letter-spacing:.06em;padding:12px;border:1px dashed #2a2a2a;text-align:center;cursor:pointer;}
.history-locked:hover{border-color:#555;color:var(--white);}

@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}

@keyframes up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:520px){.cards{grid-template-columns:1fr 1fr}.prices{flex-direction:column}.wx-row{flex-direction:column}}
`;

const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const todayAbbr = () => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date().getDay()];
const fmtDT = s => { try { return new Date(s).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}); } catch { return s; }};

// ─── MAP COMPONENT ───────────────────────────────────────────────────────────
function ParkMap({ destLat, destLng, userLat, userLng, label, history = [] }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const loadLeaflet = async () => {
      if (!window.L) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
        await new Promise((resolve) => {
          const script = document.createElement("script");
          script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
          script.onload = resolve;
          document.head.appendChild(script);
        });
      }

      const L = window.L;
      if (!mapRef.current) return;

      const centerLat = userLat ? (destLat + userLat) / 2 : destLat;
      const centerLng = userLng ? (destLng + userLng) / 2 : destLng;

      const map = L.map(mapRef.current, {
        center: [centerLat, centerLng],
        zoom: userLat ? 15 : 16,
        zoomControl: true,
        attributionControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      // ── HISTORY — green pins (establishments) or green circles (areas) ──
      history.forEach(h => {
        if (!h.lat || !h.lng) return;
        if (h.type === "establishment") {
          // Green pin for establishments
          const greenIcon = L.divIcon({
            html: `<div style="width:16px;height:22px;">
              <svg viewBox="0 0 20 28" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 0C4.5 0 0 4.5 0 10c0 7.5 10 18 10 18s10-10.5 10-18C20 4.5 15.5 0 10 0z" fill="#38A169" opacity="0.85"/>
                <circle cx="10" cy="10" r="4" fill="white"/>
              </svg>
            </div>`,
            className: "", iconSize: [16, 22], iconAnchor: [8, 22], popupAnchor: [0, -22],
          });
          L.marker([h.lat, h.lng], { icon: greenIcon })
            .addTo(map)
            .bindPopup(`<span style="font-family:sans-serif;font-size:12px">🕐 ${h.label}</span>`);
        } else {
          // Green circle/highlight for areas (parks, zips, neighborhoods)
          L.circle([h.lat, h.lng], {
            radius: h.type === "zip" ? 600 : h.type === "park" ? 400 : 300,
            color: "#38A169",
            fillColor: "#38A169",
            fillOpacity: 0.12,
            weight: 2,
            dashArray: "6 4",
          }).addTo(map)
          .bindPopup(`<span style="font-family:sans-serif;font-size:12px">🕐 ${h.label}</span>`);
        }
      });

      // ── RED PIN — parking destination ──
      const redIcon = L.divIcon({
        html: `<div style="width:20px;height:28px;">
          <svg viewBox="0 0 20 28" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 0C4.5 0 0 4.5 0 10c0 7.5 10 18 10 18s10-10.5 10-18C20 4.5 15.5 0 10 0z" fill="#E53E3E"/>
            <circle cx="10" cy="10" r="4" fill="white"/>
          </svg>
        </div>`,
        className: "", iconSize: [20, 28], iconAnchor: [10, 28], popupAnchor: [0, -28],
      });
      L.marker([destLat, destLng], { icon: redIcon })
        .addTo(map)
        .bindPopup(`<b style="font-family:sans-serif;font-size:13px">🅿 ${label}</b>`)
        .openPopup();

      // ── BLUE PIN — user location ──
      if (userLat && userLng) {
        const blueIcon = L.divIcon({
          html: `<div style="width:18px;height:18px;">
            <svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
              <circle cx="9" cy="9" r="9" fill="#3182CE" opacity="0.3"/>
              <circle cx="9" cy="9" r="5" fill="#3182CE"/>
              <circle cx="9" cy="9" r="2.5" fill="white"/>
            </svg>
          </div>`,
          className: "", iconSize: [18, 18], iconAnchor: [9, 9],
        });
        L.marker([userLat, userLng], { icon: blueIcon })
          .addTo(map)
          .bindPopup(`<span style="font-family:sans-serif;font-size:12px">📍 You are here</span>`);

        L.polyline([[userLat, userLng], [destLat, destLng]], {
          color: "#F7C948", weight: 2, dashArray: "6, 8", opacity: 0.7,
        }).addTo(map);

        const bounds = L.latLngBounds([[userLat, userLng], [destLat, destLng]]);
        map.fitBounds(bounds, { padding: [40, 40] });
      }

      mapInstanceRef.current = map;
    };

    loadLeaflet().catch(console.error);
    return () => {
      if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; }
    };
  }, [destLat, destLng, userLat, userLng, label, history]);

  return <div ref={mapRef} className="map-container" />;
}

export default function StreetParkInfo() {
  const [phase, setPhase]     = useState("home");
  const [query, setQuery]     = useState("");
  const [locData, setLocData] = useState(null);
  const [coords, setCoords]   = useState(null);
  const [err, setErr]         = useState(null);
  const [phone, setPhone]     = useState("");
  const [signupBusy, setSignupBusy] = useState(false);
  const [signedUp, setSignedUp]     = useState(false);
  const [signupErr, setSignupErr]   = useState(null);
  const [checkoutBusy, setCheckoutBusy] = useState(null);
  const [selectedEstab, setSelectedEstab] = useState(null);

  const [cleaning, setCleaning] = useState([]);
  const [films, setFilms]       = useState([]);
  const [events, setEvents]     = useState([]);
  const [weather, setWeather]   = useState(null);
  const [asp, setAsp]           = useState(null);

  // ── FREE SEARCH GATE ──────────────────────────────────────────────────────
  const [searchCount, setSearchCount] = useState(() => {
    return parseInt(localStorage.getItem("spi_searches") || "0");
  });
  const [isSubscribed, setIsSubscribed] = useState(() => {
    return localStorage.getItem("spi_subscribed") === "true";
  });
  const [showPaywall, setShowPaywall] = useState(false);

  const incrementSearch = () => {
    const newCount = parseInt(localStorage.getItem("spi_searches") || "0") + 1;
    localStorage.setItem("spi_searches", String(newCount));
    setSearchCount(newCount);
    return newCount;
  };

  const checkGate = () => {
    if (isSubscribed) return true;
    const current = parseInt(localStorage.getItem("spi_searches") || "0");
    if (current >= 2) {
      setShowPaywall(true);
      return false;
    }
    return true;
  };

  // ── SAVED SEARCHES ────────────────────────────────────────────────────────
  const MAX_SAVED = 20;
  const [savedSearches, setSavedSearches] = useState(() => {
    try { return JSON.parse(localStorage.getItem("spi_saved") || "[]"); } catch { return []; }
  });
  const [showHistory, setShowHistory] = useState(false);

  const saveSearch = (loc) => {
    if (!isSubscribed) return; // only save for subscribers
    const entry = {
      id: Date.now(),
      label: loc.label || loc.street,
      street: loc.street,
      borough: loc.borough || "",
      neighborhood: loc.neighborhood || "",
      lat: loc.lat,
      lng: loc.lng,
      type: loc.isEstablishment ? "establishment" : loc.isPark ? "park" : loc.isZip ? "zip" : "location",
      ts: new Date().toLocaleString("en-US", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }),
    };
    const updated = [entry, ...savedSearches.filter(s => s.label !== entry.label)].slice(0, MAX_SAVED);
    setSavedSearches(updated);
    localStorage.setItem("spi_saved", JSON.stringify(updated));
  };

  const clearHistory = () => {
    setSavedSearches([]);
    localStorage.removeItem("spi_saved");
  };

  const today = todayAbbr();

  // Auto-trigger GPS if launched from home screen with ?gps=1
  useEffect(() => {
    if (window.__AUTO_GPS__) {
      window.__AUTO_GPS__ = false;
      setTimeout(() => handleGPS(), 500);
    }
  }, [handleGPS]);

  const resetHome = () => {
    setPhase("home"); setLocData(null); setSignedUp(false);
    setQuery(""); setSelectedEstab(null); setErr(null);
  };

  const loadCleaningForStreets = async (streets, lat, lng) => {
    const results = await Promise.all(streets.map(s => getCleaning(s, lat, lng)));
    return results.flatMap((r, i) => r.map(c => ({ ...c, street: streets[i] })));
  };

  const loadAll = useCallback(async (loc) => {
    setLocData(loc);
    setCoords({ lat: loc.lat, lng: loc.lng });
    setSelectedEstab(null);
    setPhase("loading");
    saveSearch(loc);

    const streetsToFetch =
      loc.isPark && loc.parkStreets?.length ? loc.parkStreets :
      loc.isZip  && loc.zipStreets?.length  ? loc.zipStreets  :
      [loc.street];

    const [cleanResults, f, ev, wx, a] = await Promise.allSettled([
      loadCleaningForStreets(streetsToFetch, loc.lat, loc.lng),
      getFilms(loc.street),
      getEvents(loc.borough),
      getWeather(loc.lat, loc.lng),
      getASP(),
    ]);

    setCleaning(cleanResults.status === "fulfilled" ? cleanResults.value : []);
    setFilms   (f.status === "fulfilled" ? f.value : []);
    setEvents  (ev.status === "fulfilled" ? ev.value : []);
    setWeather (wx.status === "fulfilled" ? wx.value : null);
    setAsp     (a.status === "fulfilled" ? a.value : null);
    setPhase("dash");
  }, [savedSearches, isSubscribed]);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    if (!checkGate()) return;
    incrementSearch();
    setErr(null); setPhase("loading");
    try {
      const loc = await geocode(q, coords?.lat, coords?.lng);
      if (loc.isEstablishment) {
        setLocData(loc);
        setCoords({ lat: loc.establishments[0]?.lat || 40.7580, lng: loc.establishments[0]?.lng || -73.9855 });
        if (isSubscribed) saveSearch(loc);
        setPhase("dash");
        setCleaning([]); setFilms([]); setEvents([]); setWeather(null); setAsp(null);
      } else {
        await loadAll(loc);
      }
    } catch (e) { setErr(e.message); setPhase("home"); }
  }, [query, coords, loadAll, isSubscribed, savedSearches]);

  const handleGPS = useCallback(() => {
    setErr(null);
    if (!checkGate()) return;
    if (!navigator.geolocation) { setErr("Geolocation not available. Enter a street below."); return; }
    incrementSearch();
    setPhase("loading");
    navigator.geolocation.getCurrentPosition(
      async ({ coords: { latitude: lat, longitude: lng } }) => {
        setCoords({ lat, lng });
        try {
          const loc = await reverseGeocode(lat, lng);
          await loadAll({ ...loc, lat, lng });
        } catch (e) { setErr(e.message); setPhase("home"); }
      },
      (e) => {
        setErr(e.code === 1
          ? "Location blocked. Allow location in Safari → Settings → Privacy, or type a street below."
          : "Could not get location. Enter a street below."
        );
        setPhase("home");
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }, [loadAll]);

  const handleSignup = async () => {
    const digits = phone.replace(/\D/g,"");
    if (digits.length < 10) { setSignupErr("Enter a valid US phone number"); return; }
    setSignupBusy(true); setSignupErr(null);
    try {
      const r = await fetch(`${API}/subscribe`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ phone, street: locData?.street||"", borough: locData?.borough||"", lat: coords?.lat, lng: coords?.lng }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error||"Signup failed");
      setSignedUp(true);
    } catch (e) { setSignupErr(e.message); }
    finally { setSignupBusy(false); }
  };

  const handleCheckout = async (plan) => {
    setCheckoutBusy(plan);
    try {
      const r = await fetch(`${API}/create-checkout-session`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ plan, phone, street: locData?.street||"" }),
      });
      const d = await r.json();
      if (d.url) window.location.href = d.url;
    } catch (e) { console.error(e); }
    finally { setCheckoutBusy(null); }
  };

  const cleaningToday = cleaning.some(c => c.days?.includes(today));
  const aspSuspended  = asp?.suspended;
  const wxCurrent     = weather?.current;
  const wxDaily       = weather?.daily;
  const severeToday   = wxCurrent?.weather_code && SEVERE.has(wxCurrent.weather_code);
  const isMultiStreet = locData?.isPark || locData?.isZip;
  const multiStreets  = locData?.isPark ? locData.parkStreets : locData?.isZip ? locData.zipStreets : [];

  return (
    <>
      <style>{css}</style>

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
          <p className="sub">
            Street cleaning · Film shoots · Events · Weather<br />
            <strong>Search any street, zip, neighborhood, park, or business.</strong>
          </p>
          <div className="search-wrap">
            {!isSubscribed && searchCount > 0 && (
              <div style={{fontFamily:"var(--mono)",fontSize:".62rem",color:searchCount>=2?"var(--red)":"var(--yellow)",letterSpacing:".08em",marginBottom:10,textAlign:"center"}}>
                {searchCount>=2 ? "⚠ You've used both free searches — subscribe to continue" : `${2-searchCount} free search remaining`}
              </div>
            )}
            <div className="search-box">
              <input
                type="text"
                placeholder="Broadway, 11211, Central Park, McDonald's, intrepid…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                autoFocus
              />
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
        <div className="loading">
          <div className="spin" />
          <div className="loading-lbl">Scanning NYC databases…</div>
        </div>
      )}

      {/* DASHBOARD */}
      {phase === "dash" && locData && (
        <div className="dash">

          {/* Location header */}
          <div className="loc-bar">
            <div>
              <div className="loc-eyebrow">📍 {locData.isEstablishment ? "Search results" : "Your location"}</div>
              <div className="loc-name">{locData.label || locData.street}</div>
              <div className="loc-meta">
                {locData.isEstablishment
                  ? `${locData.establishments?.length} locations found · sorted by distance`
                  : [locData.neighborhood, locData.borough].filter(Boolean).join(" · ") + " · Updated just now"
                }
              </div>
            </div>
            {!locData.isEstablishment && (
              <button className="re-btn" onClick={() => loadAll(locData)}>↻ REFRESH</button>
            )}
          </div>

          {/* MAP */}
          {locData.lat && locData.lng && (
            <div className="map-wrap">
              <ParkMap
                destLat={selectedEstab?.lat || locData.lat}
                destLng={selectedEstab?.lng || locData.lng}
                userLat={coords?.lat !== locData.lat ? coords?.lat : null}
                userLng={coords?.lng !== locData.lng ? coords?.lng : null}
                label={selectedEstab?.name || locData.label || locData.street}
                history={showHistory && isSubscribed ? savedSearches.filter(s => s.label !== (locData.label || locData.street)) : []}
              />
              <div className="map-legend">
                <div className="map-legend-item"><div className="map-dot red" /><span>Parking destination</span></div>
                {coords?.lat && coords.lat !== locData.lat && (
                  <div className="map-legend-item"><div className="map-dot blue" /><span>Your location</span></div>
                )}
                {showHistory && isSubscribed && savedSearches.length > 0 && (
                  <div className="map-legend-item"><div className="map-dot" style={{background:"#38A169"}} /><span>Previous searches</span></div>
                )}
              </div>
            </div>
          )}

          {/* HISTORY TOGGLE — always visible, locked for non-subscribers */}
          <div style={{marginBottom:16}}>
            <label className="history-toggle">
              <input
                type="checkbox"
                checked={showHistory && isSubscribed}
                onChange={e => {
                  if (!isSubscribed) { setShowPaywall(true); return; }
                  setShowHistory(e.target.checked);
                }}
              />
              <span className="history-toggle-label">
                Show my previous searches {!isSubscribed && "🔒"}
              </span>
            </label>
            {!isSubscribed && (
              <div className="history-toggle-sub" style={{cursor:"pointer"}} onClick={() => setShowPaywall(true)}>
                Subscribe to save and view your search history on the map
              </div>
            )}
            {showHistory && isSubscribed && savedSearches.length === 0 && (
              <div className="history-toggle-sub">No saved searches yet — they appear here after your next search</div>
            )}
            {showHistory && isSubscribed && savedSearches.length > 0 && (
              <div className="history-list">
                {savedSearches.map((s) => (
                  <div key={s.id} className="history-item" onClick={() => { setQuery(s.label); handleSearch(); }}>
                    <div className="history-item-left">
                      <div className={`history-dot ${s.type !== "establishment" ? "area" : ""}`} />
                      <div>
                        <div className="history-item-label">{s.label}</div>
                        <div className="history-item-meta">{s.borough}{s.neighborhood ? ` · ${s.neighborhood}` : ""}</div>
                      </div>
                    </div>
                    <div className="history-item-ts">{s.ts}</div>
                  </div>
                ))}
                <button className="history-clear" onClick={clearHistory}>Clear history</button>
              </div>
            )}
          </div>

          {/* GPS prompt if no user location */}
          {!coords?.lat && phase === "dash" && !locData.isEstablishment && (
            <div className="map-gps-prompt">
              <div className="map-gps-prompt-text">
                📍 Enable location for a blue pin showing where you are relative to your parking spot
              </div>
              <button className="map-gps-btn" onClick={handleGPS}>ENABLE →</button>
            </div>
          )}

          {/* ESTABLISHMENT VIEW */}
          {locData.isEstablishment ? (
            <div>
              <div className="sec">
                <div className="sec-hd">📍 Locations {locData.establishments?.length > 0 && <span className="badge">{locData.establishments.length}</span>}</div>
                <div className="sec-note">Tap a location to see its street cleaning schedule</div>
                {locData.establishments?.map((e, i) => {
                  const dist = coords ? haversineKm(coords.lat, coords.lng, e.lat, e.lng) : null;
                  const isSelected = selectedEstab?.name === e.name;
                  return (
                    <div key={i} className={`estab-card ${isSelected ? "selected" : ""}`} onClick={() => loadEstablishment(e)}>
                      <div className="estab-header">
                        <div className="estab-name">{e.name}</div>
                        {dist !== null && <div className="estab-dist">{fmtKm(dist)}</div>}
                      </div>
                      <div className="estab-meta">{e.address} · {e.borough}</div>
                      <div className="estab-street">{e.street}</div>
                      {isSelected && cleaning.length > 0 && (
                        <div style={{marginTop:12}}>
                          {cleaning.map((c, ci) => (
                            <div key={ci} style={{background:"var(--g1)",borderTop:"1px solid #2a2a2a",padding:"10px 0 4px"}}>
                              <div className="chips" style={{marginBottom:6}}>
                                {DAYS.map(d => <span key={d} className={`chip ${c.days?.includes(d)?"on":""}`}>{d}</span>)}
                              </div>
                              {c.time && <div className="clean-time" style={{fontSize:"1.2rem"}}>{c.time}</div>}
                              {c.side && <div className="side-tag" style={{marginTop:4}}>{c.side}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                      {isSelected && cleaning.length === 0 && (
                        <div style={{fontFamily:"var(--mono)",fontSize:".6rem",color:"var(--muted)",marginTop:8}}>No cleaning schedule found for this block</div>
                      )}
                      {!isSelected && <div className="estab-hint">Tap to see cleaning schedule →</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              {/* Status cards */}
              <div className="cards">
                <div className={`card ${aspSuspended?"ok":cleaningToday?"alert":"ok"}`}>
                  <div className="card-lbl">Street Cleaning</div>
                  <div className="card-val">{aspSuspended?"SUSPENDED":cleaningToday?"TODAY":"NOT TODAY"}</div>
                  <div className="card-sub">{aspSuspended?"ASP holiday":cleaningToday?"Move your car!":"You're good"}</div>
                </div>
                <div className={`card ${films.length?"orange":"ok"}`}>
                  <div className="card-lbl">Film Permits</div>
                  <div className="card-val">{films.length?`${films.length} NEARBY`:"CLEAR"}</div>
                  <div className="card-sub">{films.length?"Parking held":"No shoots"}</div>
                </div>
                <div className={`card ${events.length?"info":"ok"}`}>
                  <div className="card-lbl">Public Events</div>
                  <div className="card-val">{events.length?`${events.length} THIS WEEK`:"CLEAR"}</div>
                  <div className="card-sub">{events.length?"May affect parking":"None listed"}</div>
                </div>
                <div className={`card ${severeToday?"warn":"ok"}`}>
                  <div className="card-lbl">Weather</div>
                  <div className="card-val">{wxCurrent?`${Math.round(wxCurrent.temperature_2m)}°F`:"—"}</div>
                  <div className="card-sub">{severeToday?WX_LABELS[wxCurrent.weather_code]:wxCurrent?`Wind ${Math.round(wxCurrent.wind_speed_10m)}mph`:"—"}</div>
                </div>
              </div>

              {/* Street Cleaning */}
              <div className="sec">
                <div className="sec-hd">🧹 Street Cleaning {cleaning.length > 0 && <span className="badge">{cleaning.length}</span>}</div>
                {isMultiStreet && multiStreets.length > 0 && (
                  <div className="sec-note">Showing schedules for {multiStreets.length} {locData.isPark ? "bordering streets" : "streets in this zip"}</div>
                )}
                {cleaning.length === 0
                  ? <div className="empty">No street cleaning regulations found for this block.</div>
                  : cleaning.map((c, i) => (
                    <div key={i} className={`clean-card ${c.days?.includes(today)?"today":""}`}>
                      {c.days?.includes(today) && <span className="today-tag">⚠ CLEANING TODAY</span>}
                      {isMultiStreet && c.street && <div className="street-label">{c.street}</div>}
                      {c.side && <div className="side-tag">{c.side==="L"?"Left / Even side":c.side==="R"?"Right / Odd side":c.side}</div>}
                      <div className="chips">{DAYS.map(d => <span key={d} className={`chip ${c.days?.includes(d)?"on":""}`}>{d}</span>)}</div>
                      {c.time && <div className="clean-time">{c.time}</div>}
                      <div className="clean-raw">{c.raw}</div>
                    </div>
                  ))}
              </div>

              {/* Film Permits */}
              <div className="sec">
                <div className="sec-hd">🎬 Film & TV Permits {films.length > 0 && <span className="badge">{films.length}</span>}</div>
                {films.length === 0
                  ? <div className="empty">No active film permits on your street this week.</div>
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
                {events.length === 0
                  ? <div className="empty">No permitted public events in your borough this week.</div>
                  : events.slice(0,5).map((ev, i) => (
                    <div key={i} className="ev-card">
                      <div className="ev-type">📅 {ev.type}</div>
                      <div className="ev-name">{ev.name}</div>
                      <div className="ev-meta">{ev.start&&`Starts: ${ev.start}`}{ev.location&&` · ${ev.location}`}{ev.borough&&` · ${ev.borough}`}</div>
                      {ev.parkingImpacted && <span className="ev-impact">⚠ Parking may be impacted</span>}
                    </div>
                  ))}
              </div>

              {/* Weather */}
              <div className="sec">
                <div className="sec-hd">🌤 Weather Forecast</div>
                {!weather ? <div className="empty">Weather data unavailable.</div> : (
                  <>
                    {severeToday && (
                      <div className="ev-card severe" style={{marginBottom:8}}>
                        <div className="ev-type">⚠ WEATHER ALERT</div>
                        <div className="ev-name">{WX_LABELS[wxCurrent.weather_code]}</div>
                        <div className="ev-meta">Current conditions may affect parking rules and street cleaning enforcement.</div>
                      </div>
                    )}
                    <div className="wx-row">
                      {(wxDaily?.time||[]).slice(0,3).map((dateStr, i) => {
                        const code=wxDaily.weather_code?.[i], rain=wxDaily.precipitation_sum?.[i], snow=wxDaily.snowfall_sum?.[i];
                        const d = new Date(dateStr+"T12:00:00");
                        const label = i===0?"Today":i===1?"Tomorrow":d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
                        return (
                          <div key={i} className="wx-day">
                            <div className="wx-date">{label}</div>
                            <div className="wx-icon">{wxIcon(code)}</div>
                            <div className="wx-lbl">{WX_LABELS[code]||"Clear"}</div>
                            {(rain>0.05||snow>0.1)&&<div className="wx-precip">{snow>0.1?`❄ ${snow.toFixed(1)}" snow`:`💧 ${rain?.toFixed(2)}" rain`}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* Signup — shown for all views */}
          <div className="signup">
            <div className="signup-title">GET TEXTED BEFORE IT MATTERS</div>
            <div className="signup-sub">Street cleaning · Film shoots · Snowstorms · Events · FREE 30-day trial</div>
            {!signedUp ? (
              <>
                <div className="phone-row">
                  <input type="tel" placeholder="+1 (917) 555-0100" value={phone} onChange={e=>setPhone(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSignup()} />
                  <button onClick={handleSignup} disabled={signupBusy}>{signupBusy?"…":"SIGN ME UP →"}</button>
                </div>
                {signupErr && <div style={{fontFamily:"var(--mono)",fontSize:".62rem",color:"var(--red)",marginTop:8}}>⚠ {signupErr}</div>}
                <div className="signup-fine">$2.99/mo after trial · Cancel anytime · Reply STOP to unsubscribe</div>
              </>
            ) : (
              <div className="success">✅ Done! Check your phone. Upgrade below to keep alerts after 30 days.</div>
            )}
          </div>

          {/* Pricing */}
          <div className="prices">
            {[
              { key:"monthly", name:"Monthly", price:"$2.99", per:"/month", features:["SMS alerts before every sweep","1 address monitored","Film & event alerts","ASP suspension alerts"] },
              { key:"annual", name:"Annual · Best Value", price:"$19", per:"/year · save 47%", features:["SMS alerts before every sweep","3 addresses monitored","Film & event alerts","Priority weather alerts"], featured:true },
            ].map(p => (
              <div key={p.key} className={`price ${p.featured?"feat":""}`}>
                <div className="p-name">{p.name}</div>
                <div className="p-num">{p.price}</div>
                <div className="p-per">{p.per}</div>
                {p.features.map(f => <div key={f} className="p-feat">{f}</div>)}
                <button className="p-cta" disabled={!!checkoutBusy} onClick={() => handleCheckout(p.key)}>
                  {checkoutBusy===p.key?"LOADING…":"START FREE TRIAL →"}
                </button>
              </div>
            ))}
          </div>

        </div>
      )}

      {/* FREE SEARCH COUNTER — subtle badge on home screen */}
      {phase === "home" && !isSubscribed && searchCount > 0 && (
        <div style={{position:"fixed",bottom:24,right:20,fontFamily:"var(--mono)",fontSize:".6rem",color:searchCount>=2?"var(--red)":"var(--muted)",letterSpacing:".08em",background:"var(--g2)",border:`1px solid ${searchCount>=2?"var(--red)":"#2a2a2a"}`,padding:"6px 12px",zIndex:100}}>
          {searchCount>=2 ? "⚠ FREE SEARCHES USED" : `${2-searchCount} free search${2-searchCount===1?"":"es"} remaining`}
        </div>
      )}

      {/* PAYWALL MODAL */}
      {showPaywall && (
        <div className="paywall-overlay" onClick={() => setShowPaywall(false)}>
          <div className="paywall-sheet" onClick={e => e.stopPropagation()}>
            <div className="paywall-icon">🚗</div>
            <div className="paywall-title">UNLOCK STREET PARK INFO</div>
            <div className="paywall-sub">
              You've used your 2 free searches. Subscribe to keep searching,
              save your history, and get SMS alerts before your car gets ticketed.
            </div>
            <div className="paywall-free-count">
              ✓ 2 free searches used · Unlimited with subscription
            </div>

            {/* Apple In-App Purchase — shown on iOS PWA */}
            <button className="paywall-apple" onClick={() => {
              // Apple IAP bridge — will call native StoreKit when wrapped in native app
              // For now, fall through to Stripe web checkout
              handleCheckout("annual");
            }}>
               Subscribe with Apple
            </button>

            <div className="paywall-plans">
              {[
                { key:"monthly", name:"Monthly", price:"$2.99", per:"/mo", tag:null },
                { key:"annual", name:"Annual", price:"$19", per:"/yr", tag:"SAVE 47%" },
              ].map(p => (
                <div key={p.key} className={`paywall-plan ${p.tag?"best":""}`} onClick={() => handleCheckout(p.key)}>
                  <div className="paywall-plan-name">{p.name}</div>
                  <div className="paywall-plan-price">{p.price}</div>
                  <div className="paywall-plan-per">{p.per}</div>
                  {p.tag && <div className="paywall-plan-tag">{p.tag}</div>}
                </div>
              ))}
            </div>

            <button className="paywall-cta" onClick={() => handleCheckout("annual")}>
              START 30-DAY FREE TRIAL →
            </button>
            <button className="paywall-dismiss" onClick={() => setShowPaywall(false)}>
              Maybe later
            </button>
          </div>
        </div>
      )}
    </>
  );
}
