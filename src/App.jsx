import { useState, useCallback } from "react";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const API = import.meta.env?.VITE_BACKEND_URL || "https://street-park-info-backend.onrender.com";

// ─── WEATHER ─────────────────────────────────────────────────────────────────
const WX_LABELS = {
  0:"Clear",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",
  45:"Foggy",48:"Icy fog",51:"Light drizzle",53:"Drizzle",55:"Heavy drizzle",
  61:"Light rain",63:"Rain",65:"Heavy rain",71:"Light snow",73:"Snow",75:"Heavy snow",
  77:"Snow grains",80:"Rain showers",81:"Showers",82:"Heavy showers",
  85:"Snow showers",86:"Heavy snow showers",95:"Thunderstorm",96:"Thunderstorm + hail",99:"Severe thunderstorm",
};
const SEVERE_CODES = new Set([51,53,55,61,63,65,71,73,75,77,80,81,82,85,86,95,96,99]);
function wxIcon(code) {
  if ([95,96,99].includes(code)) return "⛈";
  if ([71,73,75,77,85,86].includes(code)) return "❄";
  if ([61,63,65,80,81,82].includes(code)) return "🌧";
  if ([51,53,55].includes(code)) return "🌦";
  if ([45,48].includes(code)) return "🌫";
  if (code >= 1 && code <= 3) return "⛅";
  return "☀";
}

// ─── GEOCODING (proxied through backend — no CORS issues) ────────────────────
async function geocode(input) {
  const r = await fetch(`${API}/api/geocode?q=${encodeURIComponent(input.trim())}`);
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

// ─── API CALLS (all proxied through our backend — no CORS issues) ─────────────
async function getCleaning(street) {
  try {
    const r = await fetch(`${API}/api/cleaning?street=${encodeURIComponent(street)}`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}

async function getFilms(street) {
  try {
    const r = await fetch(`${API}/api/films?street=${encodeURIComponent(street)}`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}

async function getEvents(borough) {
  try {
    const r = await fetch(`${API}/api/events?borough=${encodeURIComponent(borough || "")}`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}

async function getWeather(lat, lng) {
  try {
    const r = await fetch(`${API}/api/weather?lat=${lat}&lng=${lng}`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}

async function getASP() {
  try {
    const r = await fetch(`${API}/api/asp`);
    return r.ok ? r.json() : { suspended: false };
  } catch { return { suspended: false }; }
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const css = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@400;500&family=Barlow+Condensed:wght@400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{
  --black:#080808;--yellow:#F7C948;--yd:#c9a010;--white:#EDEBE4;
  --g1:#141414;--g2:#1e1e1e;--g3:#2c2c2c;--muted:#555;
  --red:#E53E3E;--green:#38A169;--blue:#3182CE;--orange:#DD6B20;
  --mono:'IBM Plex Mono',monospace;--display:'Bebas Neue',sans-serif;--body:'Barlow Condensed',sans-serif;
}
html,body{background:var(--black);color:var(--white);font-family:var(--body);min-height:100vh;overflow-x:hidden;}

.nav{position:sticky;top:0;z-index:100;background:var(--black);border-bottom:2px solid var(--yellow);display:flex;align-items:center;justify-content:space-between;padding:0 20px;height:60px;}
.logo{font-family:var(--display);font-size:1.9rem;letter-spacing:.06em;color:var(--yellow);line-height:1;}
.logo span{color:var(--white);}
.pill{font-family:var(--mono);font-size:.6rem;letter-spacing:.12em;padding:4px 9px;background:var(--yellow);color:var(--black);}
.pill.ghost{background:none;border:1px solid #333;color:#777;cursor:pointer;transition:all .15s;}
.pill.ghost:hover{border-color:#666;color:var(--white);}

.home{min-height:calc(100vh - 60px);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 24px;text-align:center;animation:up .4s ease;}
.h1{font-family:var(--display);font-size:clamp(3rem,9vw,5.5rem);letter-spacing:.04em;line-height:.92;margin-bottom:16px;}
.h1 em{color:var(--yellow);font-style:normal;}
.sub{font-family:var(--mono);font-size:.72rem;color:var(--muted);letter-spacing:.08em;line-height:1.8;max-width:380px;margin:0 auto 32px;}
.sub strong{color:var(--white);}

.search-wrap{width:100%;max-width:520px;}
.search-box{display:flex;border:2px solid var(--yellow);background:var(--g2);}
.search-box input{flex:1;background:none;border:none;outline:none;color:var(--white);font-family:var(--mono);font-size:.9rem;padding:14px 18px;letter-spacing:.04em;}
.search-box input::placeholder{color:#444;}
.search-box button{background:var(--yellow);border:none;cursor:pointer;font-family:var(--display);font-size:1.4rem;letter-spacing:.1em;padding:0 22px;transition:background .15s;white-space:nowrap;}
.search-box button:hover{background:var(--yd);}
.or{font-family:var(--mono);font-size:.65rem;color:#444;letter-spacing:.1em;margin:16px 0;}
.gps-btn{background:none;border:1px solid #333;color:#888;font-family:var(--mono);font-size:.7rem;letter-spacing:.1em;padding:10px 20px;cursor:pointer;transition:all .15s;display:flex;align-items:center;gap:8px;}
.gps-btn:hover{border-color:var(--yellow);color:var(--yellow);}
.err{font-family:var(--mono);font-size:.68rem;color:var(--red);letter-spacing:.05em;margin-top:14px;max-width:420px;}

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

.ev-card{background:var(--g2);border:1px solid #222;border-left:3px solid var(--blue);padding:13px 16px;margin-bottom:8px;}
.ev-card.film{border-left-color:var(--orange);}
.ev-card.severe{border-left-color:var(--red);background:#12100a;}
.ev-type{font-family:var(--mono);font-size:.56rem;letter-spacing:.12em;color:var(--muted);text-transform:uppercase;margin-bottom:3px;}
.ev-name{font-family:var(--body);font-size:1.05rem;font-weight:700;margin-bottom:3px;}
.ev-meta{font-family:var(--mono);font-size:.6rem;color:var(--muted);letter-spacing:.04em;line-height:1.5;}
.ev-impact{display:inline-block;margin-top:5px;font-family:var(--mono);font-size:.56rem;letter-spacing:.1em;padding:2px 8px;background:#0a0a0a;border:1px solid #2a2a2a;color:var(--muted);}

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

@keyframes up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:520px){.cards{grid-template-columns:1fr 1fr}.prices{flex-direction:column}.wx-row{flex-direction:column}}
`;

const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const todayAbbr = () => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date().getDay()];
const fmtDT = s => { try { return new Date(s).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}); } catch { return s; }};

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function StreetParkInfo() {
  const [phase, setPhase]           = useState("home"); // home | loading | dash
  const [query, setQuery]           = useState("");
  const [locData, setLocData]       = useState(null);
  const [coords, setCoords]         = useState(null);
  const [err, setErr]               = useState(null);
  const [phone, setPhone]           = useState("");
  const [signupBusy, setSignupBusy] = useState(false);
  const [signedUp, setSignedUp]     = useState(false);
  const [signupErr, setSignupErr]   = useState(null);
  const [checkoutBusy, setCheckoutBusy] = useState(null);

  // data
  const [cleaning, setCleaning] = useState([]);
  const [films,    setFilms]    = useState([]);
  const [events,   setEvents]   = useState([]);
  const [weather,  setWeather]  = useState(null);
  const [asp,      setAsp]      = useState(null);

  const today = todayAbbr();

  // Load all data for a resolved location
  const loadAll = useCallback(async (loc) => {
    setLocData(loc);
    setCoords({ lat: loc.lat, lng: loc.lng });
    setPhase("loading");

    const [c, f, ev, wx, a] = await Promise.allSettled([
      getCleaning(loc.street),
      getFilms(loc.street),
      getEvents(loc.borough),
      getWeather(loc.lat, loc.lng),
      getASP(),
    ]);

    setCleaning(c.status === "fulfilled" ? c.value : []);
    setFilms   (f.status === "fulfilled" ? f.value : []);
    setEvents  (ev.status === "fulfilled" ? ev.value : []);
    setWeather (wx.status === "fulfilled" ? wx.value : null);
    setAsp     (a.status === "fulfilled" ? a.value : null);
    setPhase("dash");
  }, []);

  // Search handler — accepts anything
  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setErr(null);
    setPhase("loading");
    try {
      const loc = await geocode(q);
      await loadAll(loc);
    } catch (e) {
      setErr(e.message);
      setPhase("home");
    }
  }, [query, loadAll]);

  // GPS handler
  const handleGPS = useCallback(() => {
    setErr(null);
    if (!navigator.geolocation) { setErr("Geolocation not available. Enter a street below."); return; }
    setPhase("loading");
    navigator.geolocation.getCurrentPosition(
      async ({ coords: { latitude: lat, longitude: lng } }) => {
        try {
          const loc = await reverseGeocode(lat, lng);
          await loadAll(loc);
        } catch (e) { setErr(e.message); setPhase("home"); }
      },
      (e) => {
        const msg = e.code === 1
          ? "Location blocked. Allow location access in Safari → Settings → Privacy, or type a street below."
          : "Could not get location. Enter a street below.";
        setErr(msg); setPhase("home");
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }, [loadAll]);

  // Signup
  const handleSignup = async () => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) { setSignupErr("Enter a valid US phone number"); return; }
    setSignupBusy(true); setSignupErr(null);
    try {
      const r = await fetch(`${API}/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, street: locData?.street || "", borough: locData?.borough || "", lat: coords?.lat, lng: coords?.lng }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Signup failed");
      setSignedUp(true);
    } catch (e) { setSignupErr(e.message); }
    finally { setSignupBusy(false); }
  };

  // Checkout
  const handleCheckout = async (plan) => {
    setCheckoutBusy(plan);
    try {
      const r = await fetch(`${API}/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, phone, street: locData?.street || "" }),
      });
      const d = await r.json();
      if (d.url) window.location.href = d.url;
    } catch (e) { console.error(e); }
    finally { setCheckoutBusy(null); }
  };

  const cleaningToday  = cleaning.some(c => c.days?.includes(today));
  const aspSuspended   = asp?.suspended;
  const wxCurrent      = weather?.current;
  const wxDaily        = weather?.daily;
  const severeToday    = wxCurrent?.weather_code && SEVERE_CODES.has(wxCurrent.weather_code);

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{css}</style>

      <nav className="nav">
        <div className="logo">STREET PARK <span>INFO</span></div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span className="pill">NYC</span>
          {phase === "dash" && (
            <button className="pill ghost" onClick={() => { setPhase("home"); setLocData(null); setSignedUp(false); }}>↺ CHANGE</button>
          )}
        </div>
      </nav>

      {/* ── HOME ── */}
      {phase === "home" && (
        <div className="home">
          <h1 className="h1">KNOW BEFORE<br /><em>YOU PARK.</em></h1>
          <p className="sub">
            Street cleaning · Film shoots · Public events · Severe weather<br />
            <strong>Every reason NYC will ticket or tow you — in one place.</strong>
          </p>

          <div className="search-wrap">
            <div className="search-box">
              <input
                type="text"
                placeholder="Broadway, 200 5th Ave, The Leonard, W 72nd St…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                autoFocus
              />
              <button onClick={handleSearch}>LOOK UP</button>
            </div>
            <div className="or">— or —</div>
            <button className="gps-btn" onClick={handleGPS}>
              📍 Use my current location
            </button>
            {err && <div className="err">⚠ {err}</div>}
          </div>
        </div>
      )}

      {/* ── LOADING ── */}
      {phase === "loading" && (
        <div className="loading">
          <div className="spin" />
          <div className="loading-lbl">Scanning NYC databases…</div>
        </div>
      )}

      {/* ── DASHBOARD ── */}
      {phase === "dash" && locData && (
        <div className="dash">

          {/* Location header */}
          <div className="loc-bar">
            <div>
              <div className="loc-eyebrow">📍 Your location</div>
              <div className="loc-name">{locData.street}</div>
              <div className="loc-meta">
                {[locData.neighborhood, locData.borough].filter(Boolean).join(" · ")}
                {locData.neighborhood || locData.borough ? " · " : ""}Updated just now
              </div>
            </div>
            <button className="re-btn" onClick={() => loadAll(locData)}>↻ REFRESH</button>
          </div>

          {/* Status cards */}
          <div className="cards">
            <div className={`card ${aspSuspended ? "ok" : cleaningToday ? "alert" : "ok"}`}>
              <div className="card-lbl">Street Cleaning</div>
              <div className="card-val">{aspSuspended ? "SUSPENDED" : cleaningToday ? "TODAY" : "NOT TODAY"}</div>
              <div className="card-sub">{aspSuspended ? "ASP holiday" : cleaningToday ? "Move your car!" : "You're good"}</div>
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
            <div className={`card ${severeToday ? "warn" : "ok"}`}>
              <div className="card-lbl">Weather</div>
              <div className="card-val">{wxCurrent ? `${Math.round(wxCurrent.temperature_2m)}°F` : "—"}</div>
              <div className="card-sub">{severeToday ? WX_LABELS[wxCurrent.weather_code] : wxCurrent ? `Wind ${Math.round(wxCurrent.wind_speed_10m)}mph` : "—"}</div>
            </div>
          </div>

          {/* Street Cleaning */}
          <div className="sec">
            <div className="sec-hd">🧹 Street Cleaning {cleaning.length > 0 && <span className="badge">{cleaning.length}</span>}</div>
            {cleaning.length === 0
              ? <div className="empty">No street cleaning regulations found for this block.</div>
              : cleaning.map((c, i) => (
                <div key={i} className={`clean-card ${c.days?.includes(today) ? "today" : ""}`}>
                  {c.days?.includes(today) && <span className="today-tag">⚠ CLEANING TODAY</span>}
                  {c.side && <div className="side-tag">{c.side === "L" ? "Left / Even side" : c.side === "R" ? "Right / Odd side" : c.side}</div>}
                  <div className="chips">
                    {DAYS.map(d => <span key={d} className={`chip ${c.days?.includes(d) ? "on" : ""}`}>{d}</span>)}
                  </div>
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
                  <div className="ev-meta">
                    {fmtDT(f.start)} → {fmtDT(f.end)}
                    {f.parkingHeld && <><br />Parking held: {f.parkingHeld.substring(0, 140)}{f.parkingHeld.length > 140 ? "…" : ""}</>}
                  </div>
                  <span className="ev-impact">⚠ Parking restricted during shoot</span>
                </div>
              ))}
          </div>

          {/* Events */}
          <div className="sec">
            <div className="sec-hd">📅 Public Events {events.length > 0 && <span className="badge">{events.length}</span>}</div>
            {events.length === 0
              ? <div className="empty">No permitted public events in your borough this week.</div>
              : events.slice(0, 5).map((ev, i) => (
                <div key={i} className="ev-card">
                  <div className="ev-type">📅 {ev.type}</div>
                  <div className="ev-name">{ev.name}</div>
                  <div className="ev-meta">
                    {ev.start && `Starts: ${ev.start}`}
                    {ev.location && ` · ${ev.location}`}
                    {ev.borough && ` · ${ev.borough}`}
                  </div>
                  {ev.parkingImpacted && <span className="ev-impact">⚠ Parking may be impacted</span>}
                </div>
              ))}
          </div>

          {/* Weather */}
          <div className="sec">
            <div className="sec-hd">🌤 Weather Forecast</div>
            {!weather
              ? <div className="empty">Weather data unavailable.</div>
              : (
                <>
                  {severeToday && (
                    <div className="ev-card severe" style={{marginBottom:8}}>
                      <div className="ev-type">⚠ WEATHER ALERT</div>
                      <div className="ev-name">{WX_LABELS[wxCurrent.weather_code]}</div>
                      <div className="ev-meta">Current conditions may affect parking rules and street cleaning enforcement.</div>
                    </div>
                  )}
                  <div className="wx-row">
                    {(wxDaily?.time || []).slice(0, 3).map((dateStr, i) => {
                      const code  = wxDaily.weather_code?.[i];
                      const rain  = wxDaily.precipitation_sum?.[i];
                      const snow  = wxDaily.snowfall_sum?.[i];
                      const d     = new Date(dateStr + "T12:00:00");
                      const label = i === 0 ? "Today" : i === 1 ? "Tomorrow"
                        : d.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" });
                      return (
                        <div key={i} className="wx-day">
                          <div className="wx-date">{label}</div>
                          <div className="wx-icon">{wxIcon(code)}</div>
                          <div className="wx-lbl">{WX_LABELS[code] || "Clear"}</div>
                          {(rain > 0.05 || snow > 0.1) && (
                            <div className="wx-precip">
                              {snow > 0.1 ? `❄ ${snow.toFixed(1)}" snow` : `💧 ${rain?.toFixed(2)}" rain`}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
          </div>

          {/* Signup */}
          <div className="signup">
            <div className="signup-title">GET TEXTED BEFORE IT MATTERS</div>
            <div className="signup-sub">Street cleaning · Film shoots · Snowstorms · Events · FREE 30-day trial</div>
            {!signedUp ? (
              <>
                <div className="phone-row">
                  <input type="tel" placeholder="+1 (917) 555-0100" value={phone}
                    onChange={e => setPhone(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleSignup()} />
                  <button onClick={handleSignup} disabled={signupBusy}>{signupBusy ? "…" : "SIGN ME UP →"}</button>
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
              { key:"monthly", name:"Monthly", price:"$2.99", per:"/month",
                features:["SMS alerts before every sweep","1 address monitored","Film & event alerts","ASP suspension alerts"] },
              { key:"annual", name:"Annual · Best Value", price:"$19", per:"/year · save 47%",
                features:["SMS alerts before every sweep","3 addresses monitored","Film & event alerts","Priority weather alerts"],
                featured: true },
            ].map(p => (
              <div key={p.key} className={`price ${p.featured ? "feat" : ""}`}>
                <div className="p-name">{p.name}</div>
                <div className="p-num">{p.price}</div>
                <div className="p-per">{p.per}</div>
                {p.features.map(f => <div key={f} className="p-feat">{f}</div>)}
                <button className="p-cta" disabled={!!checkoutBusy} onClick={() => handleCheckout(p.key)}>
                  {checkoutBusy === p.key ? "LOADING…" : "START FREE TRIAL →"}
                </button>
              </div>
            ))}
          </div>

        </div>
      )}
    </>
  );
}
