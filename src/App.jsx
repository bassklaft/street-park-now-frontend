import { useState, useEffect, useCallback } from "react";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// Set this to your Render backend URL after deploying
const BACKEND_URL = import.meta.env?.VITE_BACKEND_URL || "https://street-park-info-backend.onrender.com";

const SOCRATA = "https://data.cityofnewyork.us/resource";
const GEO_SEARCH = "https://geosearch.planninglabs.nyc/v2/reverse";
const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";

const SEVERE_WEATHER_CODES = {
  51:"Light drizzle",53:"Moderate drizzle",55:"Dense drizzle",
  61:"Slight rain",63:"Moderate rain",65:"Heavy rain",
  71:"Slight snow",73:"Moderate snow",75:"Heavy snow",77:"Snow grains",
  80:"Rain showers",81:"Moderate showers",82:"Violent showers",
  85:"Snow showers",86:"Heavy snow showers",
  95:"Thunderstorm",96:"Thunderstorm w/ hail",99:"Severe thunderstorm",
};

function getWeatherIcon(code) {
  if (!code) return "☀️";
  if ([95,96,99].includes(code)) return "⛈️";
  if ([71,73,75,77,85,86].includes(code)) return "❄️";
  if ([61,63,65,80,81,82].includes(code)) return "🌧️";
  if ([51,53,55].includes(code)) return "🌦️";
  return "☀️";
}

// ─── SMART GEOCODER ───────────────────────────────────────────────────────────
// Accepts anything: "broadway", "The Leonard", "200 central park west", coords
// Returns { street, borough, neighborhood, label, lat, lng }

async function geocodeInput(input) {
  const q = input.trim();
  // Always append NYC to help geocoder
  const search = q.toLowerCase().includes("new york") || q.toLowerCase().includes("nyc") ? q : `${q}, New York City`;
  const url = `https://geosearch.planninglabs.nyc/v2/search?text=${encodeURIComponent(search)}&size=1&layers=address,street,venue`;
  const res = await fetch(url);
  const data = await res.json();
  const feat = data.features?.[0];
  if (!feat) throw new Error(`Could not find "${input}" in NYC. Try an address or street name.`);
  const p = feat.properties;
  const [lng, lat] = feat.geometry.coordinates;
  return {
    street: p.street || p.name || p.label?.split(",")[0] || q.toUpperCase(),
    borough: p.borough || p.county || "",
    neighborhood: p.neighbourhood || p.locality || "",
    label: p.label || q,
    lat,
    lng,
  };
}

async function reverseGeocode(lat, lng) {
  const url = `${GEO_SEARCH}?point.lat=${lat}&point.lon=${lng}&size=1`;
  const res = await fetch(url);
  const data = await res.json();
  const feat = data.features?.[0];
  if (!feat) throw new Error("Could not determine your street");
  const p = feat.properties;
  return {
    street: p.street || p.name || "",
    borough: p.borough || "",
    neighborhood: p.neighbourhood || p.locality || "",
    label: p.label || "",
    lat,
    lng,
  };
}

// Normalize street name for DOT dataset queries
// Handles: "Broadway" → "BROADWAY", "W 72nd St" → "WEST 72 STREET", etc.
function normalizeStreetName(street) {
  return street.toUpperCase()
    .replace(/\bST\.?$/, "STREET")
    .replace(/\bAVE\.?$/, "AVENUE")
    .replace(/\bBLVD\.?$/, "BOULEVARD")
    .replace(/\bDR\.?$/, "DRIVE")
    .replace(/\bPL\.?$/, "PLACE")
    .replace(/\bRD\.?$/, "ROAD")
    .replace(/\bW\b/, "WEST")
    .replace(/\bE\b/, "EAST")
    .replace(/\bN\b/, "NORTH")
    .replace(/\bS\b/, "SOUTH")
    .replace(/(\d+)(ST|ND|RD|TH)\b/, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchStreetCleaning(street) {
  const name = normalizeStreetName(street);
  const encoded = encodeURIComponent(name);

  // Hit both datasets in parallel:
  // 1. Dedicated ASP signs dataset (purpose-built for street cleaning)
  // 2. DOT parking signs dataset (uses signdesc not description)
  const [aspRes, dotRes] = await Promise.allSettled([
    fetch(`${SOCRATA}/2x64-6f34.json?$where=upper(street) LIKE '%25${encoded}%25'&$limit=50`)
      .then(r => r.ok ? r.json() : []).catch(() => []),
    fetch(`${SOCRATA}/xswq-wnv9.json?$where=upper(street) LIKE '%25${encoded}%25' AND (upper(signdesc) LIKE '%25STREET CLEANING%25' OR upper(signdesc) LIKE '%25NO PARKING%25')&$limit=50`)
      .then(r => r.ok ? r.json() : []).catch(() => []),
  ]);

  const aspData = aspRes.status === "fulfilled" ? aspRes.value : [];
  const dotData = dotRes.status === "fulfilled" ? dotRes.value : [];

  // Normalize both into a common shape our parser understands
  return [
    ...aspData.map(r => ({
      description: r.signdesc || r.sign_text || r.regulation || r.asp_text || "",
      side_of_street: r.side || r.sos || "",
      street: r.street || "",
    })),
    ...dotData.map(r => ({
      description: r.signdesc || r.description || "",
      side_of_street: r.side_of_street || r.sos || "",
      street: r.street || "",
    })),
  ].filter(r => r.description); // remove blanks
}

async function fetchFilmPermits(street) {
  const name = street.trim().toUpperCase();
  const from = new Date(); from.setDate(from.getDate() - 1);
  const to = new Date(); to.setDate(to.getDate() + 5);
  const fmt = d => d.toISOString().split("T")[0] + "T00:00:00.000";
  const url = `${SOCRATA}/tg4x-b46p.json?$where=upper(parkingheld) LIKE %27%25${encodeURIComponent(name)}%25%27 AND startdatetime >= %27${fmt(from)}%27 AND startdatetime <= %27${fmt(to)}%27&$limit=20&$order=startdatetime ASC`;
  try { const r = await fetch(url); return r.ok ? r.json() : []; } catch { return []; }
}

async function fetchPermittedEvents(borough) {
  if (!borough) return [];
  const today = new Date().toISOString().split("T")[0];
  const to = new Date(); to.setDate(to.getDate() + 7);
  const url = `${SOCRATA}/tvpp-9vvx.json?$where=startdate >= %27${today}%27 AND startdate <= %27${to.toISOString().split("T")[0]}%27&$limit=10&$order=startdate ASC`;
  try { const r = await fetch(url); return r.ok ? r.json() : []; } catch { return []; }
}

async function fetchWeather(lat, lng) {
  const url = `${OPEN_METEO}?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,wind_speed_10m,precipitation&daily=weather_code,precipitation_sum,snowfall_sum&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&forecast_days=3&timezone=America%2FNew_York`;
  try { const r = await fetch(url); return r.ok ? r.json() : null; } catch { return null; }
}

async function fetchASPStatus() {
  try {
    const today = new Date().toLocaleDateString("en-CA");
    const r = await fetch(`https://api.nyc.gov/public/api/GetCalendar?calendarTypes=AltSideParking&startDate=${today}&endDate=${today}`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}

function parseCleaningSign(row) {
  const desc = row.description || "";
  if (!desc.toUpperCase().includes("STREET CLEANING") && !desc.toUpperCase().includes("NO PARKING")) return null;
  const days = [];
  [["MON","Mon"],["TUE","Tue"],["WED","Wed"],["THU","Thu"],["FRI","Fri"],["SAT","Sat"],["SUN","Sun"]]
    .forEach(([re,label]) => { if (new RegExp(re,"i").test(desc)) days.push(label); });
  const m = desc.match(/(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\s*[-–TO]+\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)/i);
  return { days, time: m ? `${m[1].trim()} – ${m[2].trim()}` : null, raw: desc, side: row.side_of_street || "" };
}

function getTodayAbbr() { return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date().getDay()]; }
function formatDateTime(s) {
  if (!s) return "";
  try { return new Date(s).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}); } catch { return s; }
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const css = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@400;500&family=Barlow+Condensed:wght@400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{
  --black:#080808;--yellow:#F7C948;--yellow-d:#c9a010;--white:#EDEBE4;
  --gray:#141414;--gray2:#1e1e1e;--gray3:#2c2c2c;--muted:#555;
  --red:#E53E3E;--green:#38A169;--blue:#3182CE;--orange:#DD6B20;
  --mono:'IBM Plex Mono',monospace;--display:'Bebas Neue',sans-serif;--body:'Barlow Condensed',sans-serif;
}
html,body{background:var(--black);color:var(--white);font-family:var(--body);min-height:100vh;overflow-x:hidden;}

.nav{position:sticky;top:0;z-index:100;background:var(--black);border-bottom:2px solid var(--yellow);display:flex;align-items:center;justify-content:space-between;padding:0 20px;height:60px;}
.logo{font-family:var(--display);font-size:1.9rem;letter-spacing:.06em;color:var(--yellow);line-height:1;}
.logo span{color:var(--white);}
.nav-right{display:flex;align-items:center;gap:10px;}
.pill{font-family:var(--mono);font-size:.6rem;letter-spacing:.12em;padding:4px 9px;background:var(--yellow);color:var(--black);font-weight:500;}
.pill.outline{background:none;border:1px solid #333;color:#777;cursor:pointer;transition:all .15s;}
.pill.outline:hover{border-color:#666;color:var(--white);}

.loc-screen{min-height:calc(100vh - 60px);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 24px;text-align:center;animation:fadeUp .4s ease;}
.loc-icon{font-size:3.5rem;margin-bottom:24px;}
.loc-headline{font-family:var(--display);font-size:clamp(2.5rem,8vw,4.5rem);letter-spacing:.04em;line-height:.95;margin-bottom:16px;}
.loc-headline em{color:var(--yellow);font-style:normal;}
.loc-sub{font-family:var(--mono);font-size:.75rem;color:var(--muted);letter-spacing:.08em;line-height:1.7;max-width:400px;margin:0 auto 32px;}
.loc-btn{background:var(--yellow);color:var(--black);border:none;cursor:pointer;font-family:var(--display);font-size:1.5rem;letter-spacing:.1em;padding:14px 36px;transition:background .15s;display:flex;align-items:center;gap:10px;}
.loc-btn:hover{background:var(--yellow-d);}
.loc-btn:disabled{opacity:.5;cursor:not-allowed;}
.loc-or{font-family:var(--mono);font-size:.65rem;color:#444;letter-spacing:.1em;margin:20px 0;}
.manual-row{display:flex;gap:0;border:1px solid #333;max-width:420px;width:100%;}
.manual-input{flex:1;background:var(--gray2);border:none;outline:none;color:var(--white);font-family:var(--mono);font-size:.85rem;padding:12px 16px;letter-spacing:.04em;}
.manual-input::placeholder{color:#444;}
.manual-btn{background:none;border:none;border-left:1px solid #333;color:var(--yellow);font-family:var(--mono);font-size:.72rem;letter-spacing:.1em;padding:0 16px;cursor:pointer;transition:background .15s;}
.manual-btn:hover{background:#1a1a1a;}

.loading-screen{min-height:calc(100vh - 60px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;}
.spinner-big{width:48px;height:48px;border:3px solid #222;border-top-color:var(--yellow);border-radius:50%;animation:spin .8s linear infinite;}
.loading-label{font-family:var(--mono);font-size:.72rem;color:var(--muted);letter-spacing:.15em;text-transform:uppercase;}

.dashboard{padding:0 20px 80px;max-width:800px;margin:0 auto;}
.loc-header{padding:20px 0 16px;display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid #1f1f1f;margin-bottom:20px;animation:fadeUp .35s ease;}
.loc-label{font-family:var(--mono);font-size:.62rem;color:var(--yellow);letter-spacing:.15em;text-transform:uppercase;margin-bottom:4px;}
.loc-address{font-family:var(--display);font-size:1.8rem;letter-spacing:.04em;line-height:1;}
.loc-sub2{font-family:var(--mono);font-size:.65rem;color:var(--muted);letter-spacing:.06em;margin-top:4px;}
.refresh-btn{background:none;border:1px solid #2a2a2a;color:#555;font-family:var(--mono);font-size:.6rem;letter-spacing:.1em;padding:6px 12px;cursor:pointer;transition:all .15s;white-space:nowrap;margin-top:4px;}
.refresh-btn:hover{border-color:#555;color:var(--white);}

.status-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:2px;margin-bottom:20px;animation:fadeUp .35s .05s ease both;}
.status-card{background:var(--gray2);padding:14px 16px;position:relative;overflow:hidden;}
.status-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--gray3);}
.status-card.ok::before{background:var(--green);}
.status-card.warn::before{background:var(--yellow);}
.status-card.alert::before{background:var(--red);}
.status-card.info::before{background:var(--blue);}
.status-card.orange::before{background:var(--orange);}
.sc-label{font-family:var(--mono);font-size:.58rem;letter-spacing:.12em;color:var(--muted);text-transform:uppercase;margin-bottom:6px;}
.sc-value{font-family:var(--display);font-size:1.3rem;letter-spacing:.04em;line-height:1.1;}
.sc-sub{font-family:var(--mono);font-size:.6rem;color:var(--muted);letter-spacing:.05em;margin-top:3px;}

.section{margin-bottom:28px;animation:fadeUp .35s .1s ease both;}
.section-head{display:flex;align-items:center;gap:12px;font-family:var(--mono);font-size:.65rem;letter-spacing:.15em;color:var(--yellow);text-transform:uppercase;margin-bottom:12px;}
.section-head::after{content:'';flex:1;height:1px;background:#1f1f1f;}
.section-count{background:var(--yellow);color:var(--black);font-size:.58rem;padding:2px 7px;font-weight:500;}

.clean-card{background:var(--gray2);border:1px solid #222;padding:16px 18px;margin-bottom:8px;position:relative;transition:border-color .15s;}
.clean-card:hover{border-color:#333;}
.clean-card.today{border-color:var(--red);background:#120808;}
.today-badge{position:absolute;top:0;right:0;background:var(--red);color:var(--white);font-family:var(--mono);font-size:.55rem;letter-spacing:.12em;padding:3px 10px;text-transform:uppercase;}
.day-chips{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;}
.day-chip{font-family:var(--mono);font-size:.6rem;letter-spacing:.06em;padding:3px 8px;border:1px solid #2a2a2a;color:#555;}
.day-chip.active{background:var(--yellow);color:var(--black);border-color:var(--yellow);}
.clean-time{font-family:var(--display);font-size:1.5rem;letter-spacing:.04em;color:var(--white);}
.clean-meta{font-family:var(--mono);font-size:.6rem;color:#444;letter-spacing:.04em;margin-top:4px;line-height:1.4;}
.side-chip{display:inline-block;font-family:var(--mono);font-size:.58rem;letter-spacing:.08em;padding:2px 7px;border:1px solid #2a2a2a;color:var(--muted);margin-bottom:6px;}

.event-card{background:var(--gray2);border:1px solid #222;border-left:3px solid var(--blue);padding:14px 16px;margin-bottom:8px;}
.event-card.film{border-left-color:var(--orange);}
.event-card.severe-weather{border-left-color:var(--red);background:#12100a;}
.ev-type{font-family:var(--mono);font-size:.58rem;letter-spacing:.12em;color:var(--muted);text-transform:uppercase;margin-bottom:4px;}
.ev-title{font-family:var(--body);font-size:1.1rem;font-weight:700;letter-spacing:.02em;margin-bottom:4px;}
.ev-meta{font-family:var(--mono);font-size:.62rem;color:var(--muted);letter-spacing:.04em;line-height:1.5;}
.ev-impact{display:inline-block;margin-top:6px;font-family:var(--mono);font-size:.58rem;letter-spacing:.1em;padding:3px 8px;background:#0a0a0a;border:1px solid #2a2a2a;color:var(--muted);}

.weather-row{display:flex;gap:2px;flex-wrap:wrap;}
.wx-day{background:var(--gray2);padding:14px 16px;flex:1;min-width:100px;}
.wx-date{font-family:var(--mono);font-size:.58rem;letter-spacing:.1em;color:var(--muted);margin-bottom:6px;}
.wx-icon{font-size:1.6rem;margin-bottom:4px;}
.wx-desc{font-family:var(--mono);font-size:.62rem;color:#888;letter-spacing:.04em;margin-bottom:4px;}
.wx-precip{font-family:var(--mono);font-size:.65rem;color:var(--yellow);letter-spacing:.04em;}

.signup-bar{background:linear-gradient(135deg,#141000 0%,#0c0c0c 100%);border:2px solid var(--yellow);padding:24px 20px;margin-top:8px;animation:fadeUp .35s .2s ease both;}
.signup-title{font-family:var(--display);font-size:1.8rem;letter-spacing:.04em;margin-bottom:4px;}
.signup-sub{font-family:var(--mono);font-size:.65rem;color:var(--muted);letter-spacing:.05em;margin-bottom:16px;}
.signup-form{display:flex;gap:0;border:1px solid #333;max-width:440px;}
.signup-input{flex:1;background:var(--gray);border:none;outline:none;color:var(--white);font-family:var(--mono);font-size:.85rem;padding:13px 15px;letter-spacing:.04em;}
.signup-input::placeholder{color:#444;}
.signup-btn{background:var(--yellow);color:var(--black);border:none;cursor:pointer;font-family:var(--display);font-size:1.1rem;letter-spacing:.08em;padding:0 18px;transition:background .15s;white-space:nowrap;}
.signup-btn:hover{background:var(--yellow-d);}
.signup-btn:disabled{opacity:.5;cursor:not-allowed;}
.signup-fine{font-family:var(--mono);font-size:.58rem;color:#333;margin-top:10px;letter-spacing:.04em;}

.pricing-strip{display:flex;gap:2px;margin-top:32px;animation:fadeUp .35s .25s ease both;}
.price-card{background:var(--gray2);padding:20px 18px;flex:1;}
.price-card.featured{background:var(--yellow);color:var(--black);}
.pc-name{font-family:var(--mono);font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;}
.price-card.featured .pc-name{color:#8a6c00;}
.pc-price{font-family:var(--display);font-size:2.4rem;letter-spacing:.02em;line-height:1;margin-bottom:2px;}
.pc-per{font-family:var(--mono);font-size:.6rem;color:var(--muted);margin-bottom:12px;}
.price-card.featured .pc-per{color:#8a6c00;}
.pc-feature{font-family:var(--mono);font-size:.62rem;color:#666;letter-spacing:.03em;line-height:1.9;}
.price-card.featured .pc-feature{color:#5a4500;}
.pc-feature::before{content:'✓  ';color:var(--yellow);}
.price-card.featured .pc-feature::before{color:var(--black);}
.pc-cta{margin-top:14px;display:block;width:100%;text-align:center;background:var(--black);color:var(--yellow);font-family:var(--display);font-size:1.1rem;letter-spacing:.1em;padding:10px;border:none;cursor:pointer;transition:opacity .15s;}
.pc-cta:hover{opacity:.8;}

.empty{font-family:var(--mono);font-size:.7rem;color:#444;letter-spacing:.08em;padding:16px 0;}
.error-bar{border-left:3px solid var(--red);background:#120808;padding:12px 16px;font-family:var(--mono);font-size:.68rem;color:#cc6666;letter-spacing:.04em;margin-bottom:16px;}
.success-msg{font-family:var(--mono);font-size:.75rem;color:var(--green);letter-spacing:.08em;}

.overlay{position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:200;display:flex;align-items:center;justify-content:center;padding:24px;}
.modal{background:var(--gray2);border:2px solid var(--yellow);padding:32px 28px;max-width:420px;width:100%;animation:fadeUp .2s ease;}
.modal-title{font-family:var(--display);font-size:1.8rem;letter-spacing:.04em;margin-bottom:8px;}
.modal-body{font-family:var(--mono);font-size:.7rem;color:var(--muted);letter-spacing:.04em;line-height:1.7;margin-bottom:16px;}
.modal-close{width:100%;background:none;border:none;color:#444;font-family:var(--mono);font-size:.65rem;letter-spacing:.1em;cursor:pointer;margin-top:16px;padding:8px;transition:color .15s;}
.modal-close:hover{color:var(--white);}

@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:520px){.status-row{grid-template-columns:1fr 1fr}.pricing-strip{flex-direction:column}.weather-row{flex-direction:column}}
`;

const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

export default function Street Park Info() {
  const [phase, setPhase] = useState("location");
  const [locationData, setLocationData] = useState(null);
  const [coords, setCoords] = useState(null);
  const [manualStreet, setManualStreet] = useState("");
  const [error, setError] = useState(null);
  const [phone, setPhone] = useState("");
  const [signupLoading, setSignupLoading] = useState(false);
  const [signedUp, setSignedUp] = useState(false);
  const [signupError, setSignupError] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const [cleaning, setCleaning] = useState([]);
  const [films, setFilms] = useState([]);
  const [events, setEvents] = useState([]);
  const [weather, setWeather] = useState(null);
  const [aspSuspended, setAspSuspended] = useState(null);

  const today = getTodayAbbr();

  const loadAllData = useCallback(async (street, borough, lat, lng) => {
    const [cleanData, filmData, eventData, wxData, aspData] = await Promise.allSettled([
      fetchStreetCleaning(street),
      fetchFilmPermits(street),
      fetchPermittedEvents(borough),
      fetchWeather(lat, lng),
      fetchASPStatus(),
    ]);
    setCleaning(cleanData.status === "fulfilled" ? cleanData.value : []);
    setFilms(filmData.status === "fulfilled" ? filmData.value : []);
    setEvents(eventData.status === "fulfilled" ? eventData.value : []);
    setWeather(wxData.status === "fulfilled" ? wxData.value : null);
    if (aspData.status === "fulfilled" && aspData.value) {
      setAspSuspended(JSON.stringify(aspData.value).toLowerCase().includes("suspended"));
    }
    setPhase("dashboard");
  }, []);

  const requestGPS = useCallback(() => {
    setError(null);
    if (!navigator.geolocation) { setError("Geolocation not supported. Enter your street manually."); return; }
    setPhase("loading");
    navigator.geolocation.getCurrentPosition(
      async ({ coords: { latitude, longitude } }) => {
        setCoords({ lat: latitude, lng: longitude });
        try {
          const loc = await reverseGeocode(latitude, longitude);
          setLocationData(loc);
          await loadAllData(loc.street, loc.borough, latitude, longitude);
        } catch (e) { setError(e.message); setPhase("location"); }
      },
      (err) => {
        // Give a helpful message based on why it failed
        if (err.code === 1) {
          setError("Location access was blocked. Please allow location in your browser settings, or enter your street manually below.");
        } else {
          setError("Could not get your location. Enter your street manually.");
        }
        setPhase("location");
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }, [loadAllData]);

  const handleManual = useCallback(async () => {
    const input = manualStreet.trim();
    if (!input) return;
    setPhase("loading"); setError(null);
    try {
      // Geocode whatever they typed — building name, address, street, anything
      const loc = await geocodeInput(input);
      setCoords({ lat: loc.lat, lng: loc.lng });
      setLocationData(loc);
      await loadAllData(loc.street, loc.borough, loc.lat, loc.lng);
    } catch (e) {
      setError(e.message);
      setPhase("location");
    }
  }, [manualStreet, loadAllData]);

  const handleSignup = async () => {
    const normalized = phone.replace(/\D/g, "");
    if (normalized.length < 10) { setSignupError("Enter a valid US phone number"); return; }
    setSignupLoading(true); setSignupError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, street: locationData?.street || "", borough: locationData?.borough || "", lat: coords?.lat, lng: coords?.lng }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Signup failed");
      setSignedUp(true);
    } catch (e) {
      setSignupError(e.message);
    } finally {
      setSignupLoading(false);
    }
  };

  const handleCheckout = async (plan) => {
    setCheckoutLoading(true); setSelectedPlan(plan);
    try {
      const res = await fetch(`${BACKEND_URL}/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, phone, street: locationData?.street || "" }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch (e) {
      console.error("Checkout error:", e);
    } finally {
      setCheckoutLoading(false); setSelectedPlan(null);
    }
  };

  const parsedCleaning = cleaning.map(parseCleaningSign).filter(Boolean);
  const wxCurrent = weather?.current;
  const wxDaily = weather?.daily;
  const wxSevereToday = wxCurrent?.weather_code && SEVERE_WEATHER_CODES[wxCurrent.weather_code];
  const cleaningToday = parsedCleaning.some(c => c.days.includes(today));

  return (
    <>
      <style>{css}</style>

      <nav className="nav">
        <div className="logo">STREET PARK <span>INFO</span></div>
        <div className="nav-right">
          <span className="pill">NYC</span>
          {phase === "dashboard" && (
            <button className="pill outline" onClick={() => { setPhase("location"); setLocationData(null); setSignedUp(false); }}>↺ CHANGE</button>
          )}
        </div>
      </nav>

      {phase === "location" && (
        <div className="loc-screen">
          <div className="loc-icon">🚗</div>
          <h1 className="loc-headline">KNOW BEFORE<br /><em>YOU PARK.</em></h1>
          <p className="loc-sub">Street cleaning · Film shoots · Public events · Severe weather — all the reasons NYC will ticket or tow you, in one place.</p>
          {error && <div className="error-bar" style={{marginBottom:20,textAlign:"left",maxWidth:420,width:"100%"}}>⚠ {error}</div>}
          <button className="loc-btn" onClick={requestGPS}>📍 USE MY LOCATION</button>
          <div className="loc-or">— or enter manually —</div>
          <div className="manual-row">
            <input className="manual-input" type="text" placeholder="broadway, 200 5th ave, Skyline Tower…" value={manualStreet} onChange={e => setManualStreet(e.target.value)} onKeyDown={e => e.key === "Enter" && handleManual()} />
            <button className="manual-btn" onClick={handleManual}>GO →</button>
          </div>
        </div>
      )}

      {phase === "loading" && (
        <div className="loading-screen">
          <div className="spinner-big" />
          <div className="loading-label">Looking up your location…</div>
        </div>
      )}

      {phase === "dashboard" && locationData && (
        <div className="dashboard">
          <div className="loc-header">
            <div>
              <div className="loc-label">📍 Your location</div>
              <div className="loc-address">{locationData.street}</div>
              <div className="loc-sub2">{[locationData.neighborhood, locationData.borough].filter(Boolean).join(" · ")} · Updated just now</div>
            </div>
            <button className="refresh-btn" onClick={() => loadAllData(locationData.street, locationData.borough, coords?.lat || 40.7128, coords?.lng || -74.006)}>↻ REFRESH</button>
          </div>

          <div className="status-row">
            <div className={`status-card ${aspSuspended ? "ok" : cleaningToday ? "alert" : "ok"}`}>
              <div className="sc-label">Street Cleaning</div>
              <div className="sc-value">{aspSuspended ? "SUSPENDED" : cleaningToday ? "TODAY" : "NOT TODAY"}</div>
              <div className="sc-sub">{aspSuspended ? "ASP holiday" : cleaningToday ? "Move your car!" : "You're good"}</div>
            </div>
            <div className={`status-card ${films.length > 0 ? "orange" : "ok"}`}>
              <div className="sc-label">Film Permits</div>
              <div className="sc-value">{films.length > 0 ? `${films.length} NEARBY` : "CLEAR"}</div>
              <div className="sc-sub">{films.length > 0 ? "Parking held" : "No shoots"}</div>
            </div>
            <div className={`status-card ${events.length > 0 ? "info" : "ok"}`}>
              <div className="sc-label">Public Events</div>
              <div className="sc-value">{events.length > 0 ? `${events.length} THIS WEEK` : "CLEAR"}</div>
              <div className="sc-sub">{events.length > 0 ? "May affect parking" : "None listed"}</div>
            </div>
            <div className={`status-card ${wxSevereToday ? "warn" : "ok"}`}>
              <div className="sc-label">Weather</div>
              <div className="sc-value">{wxCurrent ? `${Math.round(wxCurrent.temperature_2m)}°F` : "—"}</div>
              <div className="sc-sub">{wxSevereToday || (wxCurrent ? `Wind ${Math.round(wxCurrent.wind_speed_10m)}mph` : "Loading…")}</div>
            </div>
          </div>

          {/* Street Cleaning */}
          <div className="section">
            <div className="section-head">🧹 Street Cleaning {parsedCleaning.length > 0 && <span className="section-count">{parsedCleaning.length}</span>}</div>
            {parsedCleaning.length === 0 ? <div className="empty">No street cleaning regulations found for this block.</div>
              : parsedCleaning.map((c, i) => (
                <div key={i} className={`clean-card ${c.days.includes(today) ? "today" : ""}`}>
                  {c.days.includes(today) && <span className="today-badge">⚠ CLEANING TODAY</span>}
                  {c.side && <div className="side-chip">{c.side === "L" ? "Left / Even" : c.side === "R" ? "Right / Odd" : c.side}</div>}
                  <div className="day-chips">{DAYS.map(d => <span key={d} className={`day-chip ${c.days.includes(d) ? "active" : ""}`}>{d}</span>)}</div>
                  {c.time && <div className="clean-time">{c.time}</div>}
                  <div className="clean-meta">{c.raw}</div>
                </div>
              ))}
          </div>

          {/* Film Permits */}
          <div className="section">
            <div className="section-head">🎬 Film & TV Permits {films.length > 0 && <span className="section-count">{films.length}</span>}</div>
            {films.length === 0 ? <div className="empty">No active film permits on your street this week.</div>
              : films.map((f, i) => (
                <div key={i} className="event-card film">
                  <div className="ev-type">🎬 {f.category || "Filming"} · {f.subcategoryname || f.eventtype || "Shoot"}</div>
                  <div className="ev-title">{f.eventtype || "Film Permit"}</div>
                  <div className="ev-meta">{formatDateTime(f.startdatetime)} → {formatDateTime(f.enddatetime)}{f.parkingheld && <><br />Parking held: {f.parkingheld.substring(0,120)}{f.parkingheld.length > 120 ? "…" : ""}</>}</div>
                  <span className="ev-impact">⚠ Parking restricted during shoot</span>
                </div>
              ))}
          </div>

          {/* Public Events */}
          <div className="section">
            <div className="section-head">📅 Public Events {events.length > 0 && <span className="section-count">{events.length}</span>}</div>
            {events.length === 0 ? <div className="empty">No permitted public events in your borough this week.</div>
              : events.slice(0,5).map((ev, i) => (
                <div key={i} className="event-card">
                  <div className="ev-type">📅 {ev.eventtype || "Public Event"}</div>
                  <div className="ev-title">{ev.eventname || ev.name || "City Event"}</div>
                  <div className="ev-meta">{ev.startdate && `Starts: ${ev.startdate}`}{ev.eventlocation && ` · ${ev.eventlocation}`}{ev.borough && ` · ${ev.borough}`}</div>
                  {ev.parkingimpacted && <span className="ev-impact">⚠ Parking may be impacted</span>}
                </div>
              ))}
          </div>

          {/* Weather */}
          <div className="section">
            <div className="section-head">🌤 Weather Forecast</div>
            {!weather ? <div className="empty">Weather data unavailable.</div> : (
              <>
                {wxSevereToday && (
                  <div className="event-card severe-weather" style={{marginBottom:8}}>
                    <div className="ev-type">⚠ WEATHER ALERT</div>
                    <div className="ev-title">{wxSevereToday}</div>
                    <div className="ev-meta">Current conditions may affect street cleaning enforcement.</div>
                  </div>
                )}
                <div className="weather-row">
                  {(wxDaily?.time || []).slice(0,3).map((dateStr, i) => {
                    const code = wxDaily.weather_code?.[i];
                    const precip = wxDaily.precipitation_sum?.[i];
                    const snow = wxDaily.snowfall_sum?.[i];
                    const d = new Date(dateStr + "T12:00:00");
                    const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
                    return (
                      <div key={i} className="wx-day">
                        <div className="wx-date">{label}</div>
                        <div className="wx-icon">{getWeatherIcon(code)}</div>
                        <div className="wx-desc">{SEVERE_WEATHER_CODES[code] || "Clear / Partly cloudy"}</div>
                        {(precip > 0.05 || snow > 0.1) && <div className="wx-precip">{snow > 0.1 ? `❄ ${snow.toFixed(1)}" snow` : `💧 ${precip?.toFixed(2)}" rain`}</div>}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Signup */}
          <div className="signup-bar">
            <div className="signup-title">GET TEXTED BEFORE IT MATTERS</div>
            <div className="signup-sub">Street cleaning · Film shoots · Snowstorms · Events · FREE 30-day trial</div>
            {!signedUp ? (
              <>
                <div className="signup-form">
                  <input className="signup-input" type="tel" placeholder="+1 (917) 555-0100" value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSignup()} />
                  <button className="signup-btn" onClick={handleSignup} disabled={signupLoading}>{signupLoading ? "..." : "SIGN ME UP →"}</button>
                </div>
                {signupError && <div style={{fontFamily:"var(--mono)",fontSize:".65rem",color:"var(--red)",marginTop:8,letterSpacing:".04em"}}>⚠ {signupError}</div>}
                <div className="signup-fine">$2.99/mo after trial · Cancel anytime · No spam · Reply STOP to unsubscribe</div>
              </>
            ) : (
              <div className="success-msg">✅ You're in! Check your phone for a confirmation text. Upgrade below to keep alerts after 30 days.</div>
            )}
          </div>

          {/* Pricing */}
          <div className="pricing-strip">
            {[
              { key:"monthly", name:"Monthly", price:"$2.99", per:"/month", features:["SMS alerts before every sweep","1 address monitored","Film & event alerts","ASP suspension alerts"] },
              { key:"annual", name:"Annual · Best Value", price:"$19", per:"/year · save 47%", features:["SMS alerts before every sweep","3 addresses monitored","Film & event alerts","Priority weather alerts"], featured: true },
            ].map(p => (
              <div key={p.key} className={`price-card ${p.featured ? "featured" : ""}`}>
                <div className="pc-name">{p.name}</div>
                <div className="pc-price">{p.price}</div>
                <div className="pc-per">{p.per}</div>
                {p.features.map(f => <div key={f} className="pc-feature">{f}</div>)}
                <button className="pc-cta" disabled={checkoutLoading} onClick={() => handleCheckout(p.key)}>
                  {checkoutLoading && selectedPlan === p.key ? "LOADING…" : "START FREE TRIAL →"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
