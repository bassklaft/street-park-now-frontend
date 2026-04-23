import { useState, useCallback, useEffect, useRef } from "react";

const API = import.meta.env?.VITE_BACKEND_URL || "https://street-park-info-backend.onrender.com";
const GOOGLE_KEY = import.meta.env?.VITE_GOOGLE_MAPS_KEY || "";

// ─── GOOGLE PLACES AUTOCOMPLETE INPUT ────────────────────────────────────────
function PlacesInput({ value, onChange, onPlaceSelect, onFocus, onBlur, onEnter, onGPSClick, showDropdown }) {
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);

  useEffect(() => {
    if (!GOOGLE_KEY || !inputRef.current) return;

    const loadGoogle = () => {
      if (window.google?.maps?.places) {
        initAutocomplete();
        return;
      }
      if (document.querySelector('script[src*="maps.googleapis"]')) {
        // Wait for existing script to load
        const wait = setInterval(() => {
          if (window.google?.maps?.places) { clearInterval(wait); initAutocomplete(); }
        }, 100);
        return;
      }
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_KEY}&libraries=places&loading=async`;
      script.async = true;
      script.defer = true;
      script.onload = initAutocomplete;
      document.head.appendChild(script);
    };

    const initAutocomplete = () => {
      if (!inputRef.current || !window.google?.maps?.places) return;
      const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: "us" },
        fields: ["formatted_address", "geometry", "name", "address_components"],
        types: ["geocode", "establishment"],
      });
      ac.addListener("place_changed", () => {
        const place = ac.getPlace();
        if (place.geometry?.location) {
          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          const label = place.name || place.formatted_address || "";
          onPlaceSelect({ lat, lng, label, formatted: place.formatted_address });
        }
      });
      autocompleteRef.current = ac;
    };

    loadGoogle();
  }, []);

  return (
    <div style={{position:"relative",flex:1}}>
      <input
        ref={inputRef}
        type="text"
        placeholder="Street, Neighborhood, Landmark, Address…"
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={e => e.key === "Enter" && onEnter()}
        style={{width:"100%",background:"transparent",border:"none",outline:"none",color:"var(--white)",fontFamily:"var(--mono)",fontSize:".9rem",padding:"16px 20px",letterSpacing:".04em",boxSizing:"border-box"}}
      />
      {/* GPS dropdown option — shows when focused and no query typed */}
      {showDropdown && (
        <div className="search-dropdown">
          <div className="search-dropdown-item" onMouseDown={onGPSClick}>
            <span style={{marginRight:10,fontSize:"1.1rem"}}>📍</span>
            <div>
              <div className="search-dropdown-label">Use my current location</div>
              <div className="search-dropdown-sub">Automatically find streets near you</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
const Auth = {
  getToken:    () => localStorage.getItem("spn_token"),
  setToken:    (t) => localStorage.setItem("spn_token", t),
  getUser:     () => { try { return JSON.parse(localStorage.getItem("spn_user") || "null"); } catch { return null; } },
  setUser:     (u) => localStorage.setItem("spn_user", JSON.stringify(u)),
  clear:       () => { ["spn_token","spn_user","spn_count"].forEach(k => localStorage.removeItem(k)); },
  getTier:     () => { try { return JSON.parse(localStorage.getItem("spn_user")||"{}").tier || "anonymous"; } catch { return "anonymous"; } },
  getCount:    () => parseInt(localStorage.getItem("spn_count") || "0"),
  incCount:    () => { const n = Auth.getCount()+1; localStorage.setItem("spn_count", String(n)); return n; },
  isLoggedIn:  () => !!localStorage.getItem("spn_token"),
  isPaid:      () => ["basic","premium","unlimited"].includes(Auth.getTier()),
  canSearch:   (count) => {
    if (Auth.isPaid()) return true;
    if (Auth.isLoggedIn()) return count < 8;
    return count < 1;
  },
  authHeader:  () => ({ "Authorization": `Bearer ${Auth.getToken()}`, "Content-Type": "application/json" }),
};

// ─── STORAGE (kept for backwards compat) ─────────────────────────────────────
const Storage = {
  getCount:     () => Auth.getCount(),
  incCount:     () => Auth.incCount(),
  isSubscribed: () => Auth.isPaid(),
  getSaved:     () => { try { return JSON.parse(localStorage.getItem("spn_saved") || "[]"); } catch { return []; } },
  saveSearch:   (loc) => {
    const entry = {
      id: Date.now(), label: loc.label || loc.street, street: loc.street,
      borough: loc.borough || "", neighborhood: loc.neighborhood || "",
      lat: loc.lat, lng: loc.lng,
      type: loc.isEstablishment ? "establishment" : loc.isPark ? "park" : loc.isZip ? "zip" : "location",
      ts: new Date().toLocaleString("en-US", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }),
    };
    const prev = Storage.getSaved();
    const updated = [entry, ...prev.filter(s => s.label !== entry.label)].slice(0, 20);
    localStorage.setItem("spn_saved", JSON.stringify(updated));
    return updated;
  },
  clearSaved: () => localStorage.removeItem("spn_saved"),
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

// Batch version for neighborhoods/zips — one API call instead of N
async function getCleaningBatch(streets, lat, lng, borough) {
  try {
    const p = new URLSearchParams({ streets: streets.join(",") });
    if (lat && lng) { p.set("lat", lat); p.set("lng", lng); }
    if (borough) p.set("borough", borough);
    const r = await fetch(`${API}/api/cleaning-batch?${p}`);
    if (!r.ok) return [];
    const data = await r.json();
    // Convert object to flat array with street labels
    return streets.flatMap(s => (data[s] || []).map(c => ({ ...c, street: s })));
  } catch { return []; }
}
async function getFilms(street, borough, lat, lng) {
  try {
    const p = new URLSearchParams({ street: street || "" });
    if (borough) p.set("borough", borough);
    if (lat && lng) { p.set("lat", lat); p.set("lng", lng); }
    const r = await fetch(`${API}/api/films?${p}`);
    return r.ok ? r.json() : [];
  } catch { return []; }
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
function ParkMap({ destLat, destLng, userLat, userLng, label, history = [], isGPS = false }) {
  const ref = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    let alive = true;

    const initMap = () => {
      if (!alive || !ref.current || !window.google?.maps) return;
      const cLat = userLat ? (destLat + userLat) / 2 : destLat;
      const cLng = userLng ? (destLng + userLng) / 2 : destLng;

      const map = new window.google.maps.Map(ref.current, {
        center: { lat: cLat, lng: cLng },
        zoom: userLat ? 15 : 16,
        mapTypeId: "roadmap",
        zoomControl: true,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
        styles: [
          { elementType:"geometry", stylers:[{color:"#1a1a1a"}] },
          { elementType:"labels.text.stroke", stylers:[{color:"#242424"}] },
          { elementType:"labels.text.fill", stylers:[{color:"#888888"}] },
          { featureType:"road", elementType:"geometry", stylers:[{color:"#2c2c2c"}] },
          { featureType:"road.highway", elementType:"geometry", stylers:[{color:"#3c3c3c"}] },
          { featureType:"water", elementType:"geometry", stylers:[{color:"#000000"}] },
          { featureType:"poi", stylers:[{visibility:"off"}] },
          { featureType:"transit", stylers:[{visibility:"off"}] },
        ],
      });

      // Red destination pin — only for non-GPS searches
      if (!isGPS) {
        new window.google.maps.Marker({
          position: { lat: destLat, lng: destLng },
          map,
          icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: 10, fillColor:"#E53E3E", fillOpacity:1, strokeColor:"#fff", strokeWeight:2 },
          title: label,
        });
      }

      // Blue user pin
      if (userLat && userLng) {
        new window.google.maps.Marker({
          position: { lat: userLat, lng: userLng },
          map,
          icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: 8, fillColor:"#3182CE", fillOpacity:1, strokeColor:"#fff", strokeWeight:2 },
          title: "You",
        });
        new window.google.maps.Polyline({
          path: [{ lat: userLat, lng: userLng }, { lat: destLat, lng: destLng }],
          strokeColor: "#F7C948", strokeOpacity: 0.7, strokeWeight: 2,
          icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 4 }, offset: "0", repeat: "20px" }],
          map,
        });
        const bounds = new window.google.maps.LatLngBounds();
        bounds.extend({ lat: userLat, lng: userLng });
        bounds.extend({ lat: destLat, lng: destLng });
        map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
      }

      mapRef.current = map;
    };

    if (window.google?.maps) { initMap(); return; }
    if (document.querySelector('script[src*="maps.googleapis"]')) {
      const wait = setInterval(() => { if (window.google?.maps) { clearInterval(wait); initMap(); } }, 100);
      return () => clearInterval(wait);
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_KEY}&libraries=places&loading=async`;
    script.async = true; script.defer = true;
    script.onload = () => { if (alive) initMap(); };
    document.head.appendChild(script);
    return () => { alive = false; };
  }, [destLat, destLng, userLat, userLng, label]);

  return <div ref={ref} style={{width:"100%", height:"260px", border:"1px solid #2a2a2a"}} />;
}

// ─── HEAT MAP ────────────────────────────────────────────────────────────────
function HeatMap({ userLat, userLng, onStreetClick }) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [streets, setStreets] = useState([]);

  // Fetch heatmap data
  useEffect(() => {
    if (!userLat || !userLng) return;
    fetch(`${API}/api/heatmap?lat=${userLat}&lng=${userLng}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { setStreets(data); setStatus("ready"); })
      .catch(() => setStatus("ready"));
  }, [userLat, userLng]);

  // Init map
  useEffect(() => {
    if (!userLat || !userLng || !ref.current) return;
    let alive = true;

    const initMap = () => {
      if (!alive || !ref.current || !window.google?.maps) return;

      const map = new window.google.maps.Map(ref.current, {
        center: { lat: userLat, lng: userLng },
        zoom: 16,
        mapTypeId: "roadmap",
        disableDefaultUI: false,
        zoomControl: true,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
        styles: [
          { elementType: "geometry", stylers: [{ color: "#1a1a1a" }] },
          { elementType: "labels.text.stroke", stylers: [{ color: "#242424" }] },
          { elementType: "labels.text.fill", stylers: [{ color: "#888888" }] },
          { featureType: "road", elementType: "geometry", stylers: [{ color: "#2c2c2c" }] },
          { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212121" }] },
          { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3c3c3c" }] },
          { featureType: "road.arterial", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
          { featureType: "water", elementType: "geometry", stylers: [{ color: "#000000" }] },
          { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3d3d3d" }] },
          { featureType: "poi", stylers: [{ visibility: "off" }] },
          { featureType: "transit", stylers: [{ visibility: "off" }] },
        ],
      });

      new window.google.maps.Marker({
        position: { lat: userLat, lng: userLng },
        map,
        icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: 8, fillColor:"#3182CE", fillOpacity:1, strokeColor:"#ffffff", strokeWeight:2 },
        title: "You are here",
      });

      mapRef.current = map;
    };

    const loadGoogleMaps = () => {
      if (window.google?.maps) { initMap(); return; }
      if (document.querySelector('script[src*="maps.googleapis"]')) {
        const wait = setInterval(() => { if (window.google?.maps) { clearInterval(wait); initMap(); } }, 100);
        return;
      }
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_KEY}&libraries=places&loading=async`;
      script.async = true;
      script.defer = true;
      script.onload = () => { if (alive) initMap(); };
      script.onerror = () => setStatus("error");
      document.head.appendChild(script);
    };

    const timer = setTimeout(loadGoogleMaps, 100);
    return () => { alive = false; clearTimeout(timer); };
  }, [userLat, userLng]);

  // Draw polylines whenever streets OR map changes
  useEffect(() => {
    if (!mapRef.current || !streets.length || !window.google?.maps) return;
    const colorMap = { red: "#E53E3E", yellow: "#F7C948", green: "#38A169", gray: "#666666" };
    const weightMap = { red: 6, yellow: 5, green: 4, gray: 3 };
    streets.forEach(s => {
      if (!s.coords || s.coords.length < 2) return;
      const path = s.coords.map(c => Array.isArray(c) ? { lat: c[0], lng: c[1] } : c);
      const line = new window.google.maps.Polyline({
        path, geodesic: true,
        strokeColor: colorMap[s.urgency] || colorMap.gray,
        strokeOpacity: s.urgency === "gray" ? 0.6 : 0.9,
        strokeWeight: weightMap[s.urgency] || 3,
        map: mapRef.current,
        zIndex: s.urgency === "red" ? 3 : s.urgency === "yellow" ? 2 : 1,
      });
      const infoWindow = new window.google.maps.InfoWindow({
        content: `<div style="font-family:monospace;font-size:12px;color:#000;padding:4px"><b>${s.street}</b><br/>${s.nextClean || "No restrictions"}</div>`,
      });
      line.addListener("click", (e) => {
        infoWindow.setPosition(e.latLng);
        infoWindow.open(mapRef.current);
        if (onStreetClick) onStreetClick(s.street);
      });
    });
  }, [streets, mapRef.current]);

  return (
    <div style={{position:"relative",marginBottom:16}}>
      <div ref={ref} style={{width:"100%",height:"300px",border:"1px solid #2a2a2a",background:"#111",display:"block"}} />
      {status === "loading" && (
        <div style={{position:"absolute",inset:0,background:"rgba(8,8,8,.85)",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:8,pointerEvents:"none"}}>
          <div style={{width:24,height:24,border:"2px solid #333",borderTopColor:"var(--yellow)",borderRadius:"50%",animation:"spin .8s linear infinite"}} />
          <span style={{fontFamily:"var(--mono)",fontSize:".6rem",color:"var(--yellow)",letterSpacing:".1em"}}>LOADING MAP…</span>
        </div>
      )}
      {status === "error" && (
        <div style={{position:"absolute",inset:0,background:"#111",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <span style={{fontFamily:"var(--mono)",fontSize:".6rem",color:"var(--muted)"}}>Map unavailable</span>
        </div>
      )}
      <div style={{display:"flex",gap:16,padding:"8px 12px",background:"var(--g2)",borderTop:"1px solid #222",flexWrap:"wrap"}}>
        {[["#E53E3E","Move Today/Tomorrow"],["#F7C948","Move In 2-3 Days"],["#38A169","Safe 4+ Days"],["#444","No Data"]].map(([c,l]) => (
          <div key={l} style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:24,height:4,background:c,borderRadius:2}} />
            <span style={{fontFamily:"var(--mono)",fontSize:".58rem",color:"var(--white)"}}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
const css = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@400;500&family=Barlow+Condensed:wght@400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--black:#080808;--yellow:#F7C948;--yd:#c9a010;--white:#EDEBE4;--g1:#141414;--g2:#1e1e1e;--muted:#aaaaaa;--red:#E53E3E;--green:#38A169;--blue:#3182CE;--orange:#DD6B20;--mono:'IBM Plex Mono',monospace;--display:'Bebas Neue',sans-serif;--body:'Barlow Condensed',sans-serif}
html,body{background:var(--black);color:var(--white);font-family:var(--body);min-height:100vh;overflow-x:hidden}
.nav{position:sticky;top:0;z-index:100;background:var(--black);border-bottom:2px solid var(--yellow);display:flex;align-items:center;justify-content:space-between;padding:0 20px;height:60px}
.logo{font-family:var(--display);font-size:1.9rem;letter-spacing:.06em;color:var(--yellow);cursor:pointer;transition:opacity .15s}
.logo:hover{opacity:.8}
.logo span{color:var(--white)}
.pill{font-family:var(--mono);font-size:.85rem;letter-spacing:.12em;padding:4px 9px;background:var(--yellow);color:var(--black)}
.pill.ghost{background:none;border:1px solid #333;color:#777;cursor:pointer;transition:all .15s}
.pill.ghost:hover{border-color:#666;color:var(--white)}
.home{min-height:calc(100vh - 90px);display:flex;flex-direction:column;align-items:center;padding:0 0 60px;animation:up .4s ease;overflow:hidden}
.hero-section{width:100%;background:linear-gradient(135deg,#0a0a0a 0%,#111 100%);padding:40px 24px 48px;text-align:center;border-bottom:1px solid #1f1f1f}
.h1{font-family:var(--display);font-size:clamp(3.2rem,10vw,5.5rem);letter-spacing:.04em;line-height:.95;margin-bottom:12px;white-space:nowrap}
.h1 em{color:var(--yellow);font-style:normal}
.app-tagline{font-family:var(--body);font-size:1.5rem;color:var(--white);letter-spacing:.06em;margin-bottom:28px}
.search-section{width:100%;max-width:560px;padding:0 20px;margin:0 auto}
.gate-note{font-family:var(--mono);font-size:.82rem;letter-spacing:.08em;text-align:center;margin-bottom:10px}
.search-box{display:flex;border:2px solid var(--yellow);background:var(--g2);border-radius:4px;overflow:visible;position:relative}
.search-box input{flex:1;background:none;border:none;outline:none;color:var(--white);font-family:var(--mono);font-size:1.5rem;padding:14px 18px;letter-spacing:.04em}
.search-box input::placeholder{color:#444}
.search-box button{background:var(--yellow);border:none;cursor:pointer;font-family:var(--display);font-size:1.5rem;letter-spacing:.1em;padding:0 22px;transition:background .15s;white-space:nowrap}
.search-box button:hover{background:var(--yd)}
/* CAROUSEL */
.carousel-section{width:100%;padding:24px 0;border-bottom:1px solid #1f1f1f;overflow:hidden}
.carousel-label{font-family:var(--mono);font-size:.72rem;color:var(--yellow);letter-spacing:.08em;text-transform:uppercase;text-align:center;margin-bottom:14px;white-space:nowrap;overflow:hidden}
.carousel-track{display:flex;gap:12px;width:max-content;padding:0 12px;cursor:grab;user-select:none;will-change:transform}
.carousel-track.dragging{cursor:grabbing}
.carousel-card{background:var(--g2);border:1px solid #2a2a2a;border-radius:8px;padding:20px 24px;min-width:240px;flex-shrink:0}
.carousel-card-city{font-family:var(--mono);font-size:.9rem;color:var(--white);letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px}
.carousel-card-num{font-family:var(--display);font-size:2.4rem;color:var(--red);line-height:1;margin-bottom:4px}
.carousel-card-meta{font-family:var(--mono);font-size:.85rem;color:var(--white);line-height:1.6}
.carousel-card-meta strong{color:var(--white)}
@keyframes scrollLeft{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
/* FEATURES */
.features-section{width:100%;padding:32px 24px;max-width:560px}
.feature-row{display:flex;gap:16px;align-items:flex-start;margin-bottom:28px}
.feature-icon{font-size:2rem;flex-shrink:0;width:48px;text-align:center}
.feature-text-title{font-family:var(--body);font-size:1.5rem;font-weight:700;color:var(--white);margin-bottom:4px}
.feature-text-sub{font-family:var(--mono);font-size:.82rem;color:var(--muted);line-height:1.6;letter-spacing:.03em}
/* MOVE CAR BANNER */
.move-car-banner{width:100%;max-width:560px;margin:0 24px;background:linear-gradient(135deg,#0a0a1a 0%,#0a0a0a 100%);border:1px solid #3a3a6a;border-radius:8px;padding:20px;position:relative;overflow:hidden}
.move-car-badge{position:absolute;top:0;right:0;background:#3a3a6a;color:#aaaaff;font-family:var(--mono);font-size:1.5rem;letter-spacing:.12em;padding:3px 10px;border-radius:0 8px 0 8px}
.move-car-title{font-family:var(--display);font-size:1.6rem;letter-spacing:.06em;color:#aaaaff;margin-bottom:6px;margin-top:8px}
.move-car-sub{font-family:var(--mono);font-size:.82rem;color:#666;letter-spacing:.04em;line-height:1.6}
.cities-sub{font-family:var(--mono);font-size:.85rem;color:var(--yellow);letter-spacing:.1em;margin-bottom:24px}
.loading{min-height:calc(100vh - 60px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px}
.spin{width:44px;height:44px;border:3px solid #222;border-top-color:var(--yellow);border-radius:50%;animation:spin .7s linear infinite}
.loading-lbl{font-family:var(--mono);font-size:1.5rem;color:var(--muted);letter-spacing:.15em;text-transform:uppercase}
.dash{padding:0 20px 80px;max-width:800px;margin:0 auto}
.loc-bar{padding:18px 0 14px;display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid #1f1f1f;margin-bottom:18px;animation:up .3s ease}
.loc-eyebrow{font-family:var(--mono);font-size:.78rem;color:var(--yellow);letter-spacing:.15em;text-transform:uppercase;margin-bottom:3px}
.loc-name{font-family:var(--display);font-size:1.9rem;letter-spacing:.04em;line-height:1}
.loc-meta{font-family:var(--mono);font-size:.85rem;color:var(--muted);margin-top:3px}
.re-btn{background:none;border:1px solid #2a2a2a;color:#555;font-family:var(--mono);font-size:.78rem;letter-spacing:.1em;padding:6px 11px;cursor:pointer;transition:all .15s;white-space:nowrap;margin-top:4px}
.re-btn:hover{border-color:#555;color:var(--white)}
.map-wrap{margin-bottom:8px;border:1px solid #2a2a2a;animation:up .3s ease}
.map-legend{display:flex;gap:16px;padding:8px 12px;background:var(--g2);border-top:1px solid #222;flex-wrap:wrap}
.map-legend-item{display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:.85rem;color:var(--muted)}
.map-dot{width:10px;height:10px;border-radius:50%}
.history-wrap{padding:10px 0;margin-bottom:12px}
.htoggle{display:flex;align-items:center;gap:10px;cursor:pointer}
.htoggle input{width:16px;height:16px;accent-color:var(--yellow);cursor:pointer}
.htoggle-label{font-family:var(--mono);font-size:.68rem;color:var(--white);letter-spacing:.06em;cursor:pointer}
.hsub{font-family:var(--mono);font-size:.78rem;color:var(--muted);margin-top:4px;margin-left:26px;cursor:pointer}
.hlist{margin-top:10px}
.hitem{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--g1);border:1px solid #1f1f1f;margin-bottom:4px;cursor:pointer;transition:border-color .15s}
.hitem:hover{border-color:#333}
.hdot{width:8px;height:8px;border-radius:50%;background:var(--green);flex-shrink:0}
.hdot.area{background:none;border:2px solid var(--green)}
.hitem-label{font-family:var(--mono);font-size:.75rem;color:var(--white)}
.hitem-meta{font-family:var(--mono);font-size:.65rem;color:var(--muted)}
.hitem-ts{font-family:var(--mono);font-size:.65rem;color:#666}
.hclear{font-family:var(--mono);font-size:.85rem;color:#444;background:none;border:none;cursor:pointer;padding:6px 0;display:block}
.hclear:hover{color:var(--red)}
.gps-prompt{background:var(--g2);border:1px solid #2a2a2a;border-left:3px solid var(--yellow);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.gps-prompt-text{font-family:var(--mono);font-size:.85rem;color:var(--muted);line-height:1.5}
.gps-prompt-btn{background:var(--yellow);color:var(--black);border:none;cursor:pointer;font-family:var(--mono);font-size:.85rem;letter-spacing:.1em;padding:7px 14px;white-space:nowrap}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:2px;margin-bottom:20px;animation:up .3s .05s ease both}
.card{background:var(--g2);padding:14px 16px;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:#2a2a2a}
.card.ok::before{background:var(--green)}.card.warn::before{background:var(--yellow)}.card.alert::before{background:var(--red)}.card.info::before{background:var(--blue)}.card.orange::before{background:var(--orange)}
.card-lbl{font-family:var(--mono);font-size:1.5rem;letter-spacing:.12em;color:var(--muted);text-transform:uppercase;margin-bottom:5px}
.card-val{font-family:var(--display);font-size:1.25rem;letter-spacing:.04em;line-height:1.1}
.card-sub{font-family:var(--mono);font-size:.78rem;color:var(--muted);margin-top:3px}
.sec{margin-bottom:26px;animation:up .3s .1s ease both}
.sec-hd{display:flex;align-items:center;gap:10px;font-family:var(--mono);font-size:.82rem;letter-spacing:.15em;color:var(--yellow);text-transform:uppercase;margin-bottom:10px}
.sec-hd::after{content:'';flex:1;height:1px;background:#1f1f1f}
.badge{background:var(--yellow);color:var(--black);font-size:1.5rem;padding:2px 6px;font-weight:500}
.sec-note{font-family:var(--mono);font-size:.82rem;color:var(--muted);margin-bottom:10px}
.clean-card{background:var(--g2);border:1px solid #222;padding:15px 18px;margin-bottom:8px;position:relative}
.clean-card.today{border-color:var(--red);background:#120808}
.today-tag{position:absolute;top:0;right:0;background:var(--red);color:var(--white);font-family:var(--mono);font-size:.52rem;letter-spacing:.12em;padding:3px 9px;text-transform:uppercase}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}
.chip{font-family:var(--mono);font-size:.78rem;padding:3px 8px;border:1px solid #2a2a2a;color:#555}
.chip.on{background:var(--yellow);color:var(--black);border-color:var(--yellow)}
.clean-time{font-family:var(--display);font-size:1.45rem;letter-spacing:.04em}
.clean-raw{font-family:var(--mono);font-size:.78rem;color:var(--white);margin-top:3px;line-height:1.4}
.side-tag{display:inline-block;font-family:var(--mono);font-size:.92rem;padding:2px 7px;border:1px solid #2a2a2a;color:var(--yellow);margin-bottom:6px}
.street-lbl{font-family:var(--mono);font-size:.82rem;color:var(--yellow);letter-spacing:.1em;margin-bottom:6px;text-transform:uppercase}
.ev-card{background:var(--g2);border:1px solid #222;border-left:3px solid var(--blue);padding:13px 16px;margin-bottom:8px}
.ev-card.film{border-left-color:var(--orange)}.ev-card.severe{border-left-color:var(--red);background:#12100a}
.ev-type{font-family:var(--mono);font-size:.76rem;letter-spacing:.12em;color:var(--muted);text-transform:uppercase;margin-bottom:3px}
.ev-name{font-family:var(--body);font-size:1.05rem;font-weight:700;margin-bottom:3px}
.ev-meta{font-family:var(--mono);font-size:.85rem;color:var(--muted);line-height:1.5}
.ev-impact{display:inline-block;margin-top:5px;font-family:var(--mono);font-size:.76rem;padding:2px 8px;background:#0a0a0a;border:1px solid #2a2a2a;color:var(--muted)}
.estab-card{background:var(--g2);border:1px solid #222;padding:14px 18px;margin-bottom:8px;cursor:pointer;transition:border-color .15s}
.estab-card:hover{border-color:#444}.estab-card.sel{border-color:var(--yellow)}
.estab-name{font-family:var(--body);font-size:1.5rem;font-weight:700}
.estab-dist{font-family:var(--mono);font-size:.78rem;color:var(--muted)}
.estab-meta{font-family:var(--mono);font-size:.85rem;color:var(--muted);margin-top:2px}
.estab-street{font-family:var(--mono);font-size:.82rem;color:var(--yellow);margin-top:3px}
.estab-hint{font-family:var(--mono);font-size:.78rem;color:#444;margin-top:4px}
.wx-row{display:flex;gap:2px;flex-wrap:wrap}
.wx-day{background:var(--g2);padding:13px 15px;flex:1;min-width:90px}
.wx-date{font-family:var(--mono);font-size:.76rem;color:var(--muted);margin-bottom:5px}
.wx-icon{font-size:1.5rem;margin-bottom:3px}
.wx-lbl{font-family:var(--mono);font-size:.85rem;color:#888;margin-bottom:3px}
.wx-precip{font-family:var(--mono);font-size:.82rem;color:var(--yellow)}
.signup{background:linear-gradient(135deg,#141000,#0c0c0c);border:2px solid var(--yellow);padding:22px 20px;margin-top:8px}
.signup-title{font-family:var(--display);font-size:1.7rem;letter-spacing:.04em;margin-bottom:3px}
.signup-sub{font-family:var(--mono);font-size:.82rem;color:var(--muted);margin-bottom:14px}
.phone-row{display:flex;border:1px solid #333;max-width:440px}
.phone-row input{flex:1;background:var(--g1);border:none;outline:none;color:var(--white);font-family:var(--mono);font-size:.85rem;padding:12px 14px}
.phone-row input::placeholder{color:#444}
.phone-row button{background:var(--yellow);color:var(--black);border:none;cursor:pointer;font-family:var(--display);font-size:1.5rem;letter-spacing:.08em;padding:0 16px;transition:background .15s;white-space:nowrap}
.phone-row button:hover{background:var(--yd)}.phone-row button:disabled{opacity:.5;cursor:not-allowed}
.signup-fine{font-family:var(--mono);font-size:.76rem;color:#333;margin-top:9px}
.ok-msg{font-family:var(--mono);font-size:1.5rem;color:var(--green)}
.prices{display:flex;gap:2px;margin-top:28px}
.price{background:var(--g2);padding:18px 16px;flex:1}
.price.feat{background:var(--yellow);color:var(--black)}
.p-name{font-family:var(--mono);font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:7px}
.price.feat .p-name{color:#8a6c00}
.p-num{font-family:var(--display);font-size:2.2rem;line-height:1;margin-bottom:2px}
.p-per{font-family:var(--mono);font-size:.78rem;color:var(--muted);margin-bottom:11px}
.price.feat .p-per{color:#8a6c00}
.p-feat{font-family:var(--mono);font-size:.85rem;color:#666;line-height:1.9}
.price.feat .p-feat{color:#5a4500}
.p-feat::before{content:'✓  ';color:var(--yellow)}
.price.feat .p-feat::before{color:var(--black)}
.p-cta{margin-top:13px;display:block;width:100%;text-align:center;background:var(--black);color:var(--yellow);font-family:var(--display);font-size:1.5rem;letter-spacing:.1em;padding:10px;border:none;cursor:pointer;transition:opacity .15s}
.p-cta:hover{opacity:.8}
.empty{font-family:var(--mono);font-size:.68rem;color:#444;padding:14px 0}
.app-tagline{font-family:var(--body);font-size:1.5rem;color:var(--muted);letter-spacing:.06em;margin-bottom:12px;font-weight:400}
.cities-sub{font-family:var(--mono);font-size:.85rem;color:var(--yellow);letter-spacing:.1em;margin-bottom:24px}
.search-dropdown{position:absolute;top:100%;left:0;right:0;background:var(--g2);border:1px solid var(--yellow);border-top:none;z-index:9999}
.search-dropdown-item{display:flex;align-items:center;padding:14px 16px;cursor:pointer;transition:background .15s}
.search-dropdown-item:hover{background:#2a2a2a}
.search-dropdown-label{font-family:var(--body);font-size:1.5rem;font-weight:600;color:var(--white)}
.search-dropdown-sub{font-family:var(--mono);font-size:.78rem;color:var(--muted);margin-top:2px}
/* Google Places autocomplete dark theme */
.pac-container{background:var(--g2)!important;border:1px solid var(--yellow)!important;border-top:none!important;font-family:var(--mono)!important;z-index:9999!important;box-shadow:none!important}
.pac-item{background:var(--g2)!important;color:var(--white)!important;border-top:1px solid #222!important;padding:10px 16px!important;cursor:pointer!important;font-size:1.5rem!important}
.pac-item:hover,.pac-item-selected{background:#2a2a2a!important}
.pac-item-query{color:var(--yellow)!important;font-size:.85rem!important}
.pac-matched{color:var(--yellow)!important}
.pac-icon{display:none!important}
.stats-section{width:100%;max-width:540px;margin-top:32px;padding-top:24px;border-top:1px solid #1f1f1f}
.stats-eyebrow{font-family:var(--mono);font-size:1.5rem;color:var(--yellow);letter-spacing:.1em;margin-bottom:16px}
.stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:2px}
.stat-card{background:var(--g2);padding:12px 14px}
.stat-city{font-family:var(--mono);font-size:.78rem;color:var(--muted);letter-spacing:.08em;margin-bottom:4px;text-transform:uppercase}
.stat-num{font-family:var(--display);font-size:1.5rem;color:var(--red);letter-spacing:.02em;line-height:1}
.stat-meta{font-family:var(--mono);font-size:.52rem;color:var(--muted);letter-spacing:.03em;margin-top:3px;line-height:1.4}
.home-btn{background:none;border:1px solid #333;color:#888;font-family:var(--mono);font-size:.85rem;letter-spacing:.1em;padding:5px 20px;cursor:pointer;transition:all .15s}
.home-btn:hover{border-color:var(--yellow);color:var(--yellow)}
.hero-eyebrow{font-family:var(--mono);font-size:.92rem;letter-spacing:.1em;color:var(--yellow);margin-bottom:12px;display:block}
.ticket-stat{background:var(--g2);border:1px solid #2a2a2a;border-left:3px solid var(--red);padding:14px 18px;margin-bottom:20px;max-width:540px}
.ticket-stat-num{font-family:var(--display);font-size:2.4rem;color:var(--red);letter-spacing:.04em;line-height:1}
.ticket-stat-label{font-family:var(--mono);font-size:.82rem;color:var(--muted);letter-spacing:.04em;margin-top:4px;line-height:1.5}
.ticket-stat-label strong{color:var(--white)}
.move-car-banner{max-width:540px;margin-top:28px;background:linear-gradient(135deg,#0a0a1a 0%,#0a0a0a 100%);border:1px solid #3a3a6a;padding:20px;position:relative;overflow:hidden}
.move-car-badge{position:absolute;top:0;right:0;background:#3a3a6a;color:#aaaaff;font-family:var(--mono);font-size:1.5rem;letter-spacing:.12em;padding:3px 10px}
.move-car-title{font-family:var(--display);font-size:1.6rem;letter-spacing:.06em;color:#aaaaff;margin-bottom:6px}
.move-car-sub{font-family:var(--mono);font-size:.82rem;color:#666;letter-spacing:.04em;line-height:1.6}
.ambiguous-wrap{min-height:calc(100vh - 60px);padding:32px 24px;max-width:600px;margin:0 auto;animation:up .3s ease;}
.ambiguous-title{font-family:var(--display);font-size:2rem;letter-spacing:.04em;margin-bottom:6px;}
.ambiguous-sub{font-family:var(--mono);font-size:.85rem;color:var(--muted);letter-spacing:.06em;margin-bottom:24px;}
.ambiguous-category{font-family:var(--mono);font-size:.85rem;color:var(--yellow);letter-spacing:.15em;text-transform:uppercase;margin-bottom:8px;margin-top:20px;}
.ambiguous-option{display:flex;align-items:center;justify-content:space-between;background:var(--g2);border:1px solid #2a2a2a;padding:14px 18px;margin-bottom:6px;cursor:pointer;transition:border-color .15s;}
.ambiguous-option:hover{border-color:var(--yellow);}
.ambiguous-option-label{font-family:var(--body);font-size:1.05rem;font-weight:600;color:var(--white);}
.ambiguous-option-meta{font-family:var(--mono);font-size:.85rem;color:var(--muted);margin-top:2px;}
.ambiguous-arrow{font-family:var(--mono);font-size:1.5rem;color:var(--muted);}
inset:0;background:rgba(0,0,0,.92);z-index:500;display:flex;align-items:flex-end;justify-content:center}
.auth-overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px}
.paywall-overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:200;display:flex;align-items:flex-end;justify-content:center}
.auth-modal{background:var(--g2);border:1px solid var(--yellow);padding:32px 28px;width:100%;max-width:420px;animation:slideUp .25s ease;position:relative}
.auth-title{font-family:var(--display);font-size:2rem;letter-spacing:.06em;margin-bottom:4px}
.auth-sub{font-family:var(--mono);font-size:.85rem;color:var(--muted);margin-bottom:24px;letter-spacing:.06em;line-height:1.6}
.auth-input{width:100%;background:#111;border:1px solid #333;color:var(--white);font-family:var(--mono);font-size:1.5rem;padding:12px 14px;margin-bottom:10px;outline:none;box-sizing:border-box;transition:border-color .15s}
.auth-input:focus{border-color:var(--yellow)}
.auth-btn{width:100%;background:var(--yellow);color:#000;border:none;font-family:var(--display);font-size:1.5rem;letter-spacing:.1em;padding:14px;cursor:pointer;margin-top:4px;transition:background .15s}
.auth-btn:hover{background:var(--yd)}
.auth-btn:disabled{opacity:.6;cursor:not-allowed}
.auth-switch{font-family:var(--mono);font-size:.82rem;color:var(--muted);margin-top:14px;text-align:center}
.auth-switch span{color:var(--yellow);cursor:pointer;text-decoration:underline}
.auth-err{font-family:var(--mono);font-size:.82rem;color:var(--red);margin-bottom:10px}
.auth-divider{display:flex;align-items:center;gap:12px;margin:14px 0}
.auth-divider::before,.auth-divider::after{content:"";flex:1;height:1px;background:#2a2a2a}
.auth-divider span{font-family:var(--mono);font-size:.78rem;color:var(--muted)}
.menu-item{font-family:var(--mono);font-size:1.5rem;letter-spacing:.06em;padding:12px 16px;cursor:pointer;color:var(--white);border-bottom:1px solid #1a1a1a;transition:background .15s}
.menu-item:last-child{border-bottom:none}
.menu-item:hover{background:#2a2a2a}
.user-pill{background:#1a1a1a;border:1px solid #2a2a2a;color:var(--white);font-family:var(--mono);font-size:1.5rem;padding:5px 12px;cursor:pointer}
.user-pill:hover{border-color:var(--yellow)}
.tier-badge{font-size:.5rem;padding:1px 5px;border-radius:2px;font-weight:700;letter-spacing:.05em}
.tier-free{background:#2a2a2a;color:#777}
.tier-basic{background:#1a3a1a;color:#38A169}
.tier-premium{background:#1a1a3a;color:#aaaaff}
.tier-unlimited{background:#3a1a3a;color:#cc88ff}
.paywall-icon{font-size:2.5rem;margin-bottom:12px}
.paywall-title{font-family:var(--display);font-size:2.2rem;letter-spacing:.04em;margin-bottom:8px}
.paywall-sub{font-family:var(--mono);font-size:.92rem;color:var(--muted);line-height:1.7;margin-bottom:20px}
.paywall-plans{display:flex;gap:8px;margin-bottom:12px}
.paywall-plan{flex:1;background:var(--g1);border:1px solid #2a2a2a;padding:16px 12px;cursor:pointer;text-align:center;transition:border-color .15s}
.paywall-plan:hover{border-color:#555}.paywall-plan.best{border-color:var(--yellow)}
.pp-name{font-family:var(--mono);font-size:.85rem;letter-spacing:.1em;color:var(--muted);text-transform:uppercase;margin-bottom:6px}
.paywall-plan.best .pp-name{color:var(--yellow)}
.pp-price{font-family:var(--display);font-size:1.8rem}
.pp-per{font-family:var(--mono);font-size:.78rem;color:var(--muted)}
.pp-tag{font-family:var(--mono);font-size:1.5rem;background:var(--yellow);color:var(--black);padding:2px 6px;margin-top:4px;display:inline-block}
.paywall-cta{display:block;width:100%;background:var(--yellow);color:var(--black);border:none;cursor:pointer;font-family:var(--display);font-size:1.5rem;letter-spacing:.1em;padding:16px;margin-bottom:10px}
.paywall-apple{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:#000;color:#fff;border:none;cursor:pointer;font-family:var(--body);font-size:1.5rem;font-weight:600;padding:14px;margin-bottom:8px;border-radius:8px}
.paywall-dismiss{display:block;width:100%;background:none;border:none;color:#555;font-family:var(--mono);font-size:.85rem;cursor:pointer;padding:8px}
.paywall-dismiss:hover{color:var(--white)}
@keyframes up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
@media(max-width:520px){.cards{grid-template-columns:1fr 1fr}.prices{flex-direction:column}.wx-row{flex-direction:column}}
`;

// ─── DRAGGABLE CAROUSEL ───────────────────────────────────────────────────────
const CITY_STATS = [
  { city:"New York City", tickets:"16,092,421", avg:"$65", total:"$1B+" },
  { city:"Los Angeles", tickets:"3,800,000+", avg:"$73", total:"$280M+" },
  { city:"Chicago", tickets:"3,200,000+", avg:"$60", total:"$192M+" },
  { city:"San Francisco", tickets:"1,900,000+", avg:"$85", total:"$162M+" },
  { city:"Boston", tickets:"800,000+", avg:"$60", total:"$48M+" },
  { city:"Philadelphia", tickets:"900,000+", avg:"$51", total:"$46M+" },
  { city:"Washington DC", tickets:"1,200,000+", avg:"$100", total:"$120M+" },
  { city:"Seattle", tickets:"500,000+", avg:"$47", total:"$24M+" },
  { city:"Miami", tickets:"1,100,000+", avg:"$40", total:"$44M+" },
  { city:"Atlanta", tickets:"600,000+", avg:"$35", total:"$21M+" },
  { city:"Toronto", tickets:"2,800,000+", avg:"$60", total:"$168M+" },
  { city:"Denver", tickets:"400,000+", avg:"$50", total:"$20M+" },
  { city:"Portland", tickets:"300,000+", avg:"$42", total:"$13M+" },
  { city:"Nashville", tickets:"250,000+", avg:"$35", total:"$9M+" },
  { city:"Austin", tickets:"350,000+", avg:"$45", total:"$16M+" },
  { city:"Minneapolis", tickets:"280,000+", avg:"$40", total:"$11M+" },
  { city:"Dallas", tickets:"1,500,000+", avg:"$40", total:"$60M+" },
  { city:"Sacramento", tickets:"500,000+", avg:"$58", total:"$29M+" },
  { city:"New Jersey", tickets:"2,100,000+", avg:"$54", total:"$113M+" },
  { city:"San Diego", tickets:"900,000+", avg:"$63", total:"$57M+" },
];

function DraggableCarousel() {
  const trackRef = useRef(null);
  const posRef = useRef(0);
  const halfWidthRef = useRef(0);
  const dragRef = useRef({ active: false, startX: 0, startPos: 0 });
  const animRef = useRef(null);
  const pausedRef = useRef(false);
  const SPEED = 0.4;

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    // Wait for layout then measure half width
    const measure = () => { halfWidthRef.current = track.scrollWidth / 2; };
    measure();
    window.addEventListener("resize", measure);

    const animate = () => {
      if (!pausedRef.current) {
        posRef.current -= SPEED;
        // Seamless loop — when we've scrolled one full copy, reset silently
        if (halfWidthRef.current > 0 && Math.abs(posRef.current) >= halfWidthRef.current) {
          posRef.current += halfWidthRef.current;
        }
        track.style.transform = `translateX(${posRef.current}px)`;
      }
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", measure);
    };
  }, []);

  const startDrag = (x) => {
    pausedRef.current = true;
    dragRef.current = { active: true, startX: x, startPos: posRef.current };
    trackRef.current?.classList.add("dragging");
  };

  const moveDrag = (x) => {
    if (!dragRef.current.active) return;
    const dx = x - dragRef.current.startX;
    let newPos = dragRef.current.startPos + dx;
    // Keep within bounds for seamless loop
    if (halfWidthRef.current > 0) {
      while (newPos > 0) newPos -= halfWidthRef.current;
      while (newPos < -halfWidthRef.current) newPos += halfWidthRef.current;
    }
    posRef.current = newPos;
    if (trackRef.current) trackRef.current.style.transform = `translateX(${posRef.current}px)`;
  };

  const endDrag = () => {
    dragRef.current.active = false;
    trackRef.current?.classList.remove("dragging");
    // Resume from current position — no jump
    pausedRef.current = false;
  };

  return (
    <div
      style={{overflow:"hidden",width:"100%",cursor:"grab"}}
      onMouseDown={e => startDrag(e.clientX)}
      onMouseMove={e => moveDrag(e.clientX)}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      onTouchStart={e => startDrag(e.touches[0].clientX)}
      onTouchMove={e => { e.preventDefault(); moveDrag(e.touches[0].clientX); }}
      onTouchEnd={endDrag}
    >
      <div ref={trackRef} className="carousel-track">
        {[...CITY_STATS, ...CITY_STATS].map((s, i) => (
          <div key={i} className="carousel-card">
            <div className="carousel-card-city">{s.city}</div>
            <div style={{display:"flex",alignItems:"baseline",gap:6,marginBottom:3}}>
              <div className="carousel-card-num">{s.tickets}</div>
              <div className="carousel-card-meta" style={{whiteSpace:"nowrap"}}>tickets/yr</div>
            </div>
            <div className="carousel-card-meta">avg <strong>{s.avg}</strong> · <strong>{s.total}</strong></div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  const [searchCount,    setSearchCount]    = useState(() => Auth.getCount());
  const [isSubscribed]                      = useState(() => Auth.isPaid());
  const [savedSearches,  setSavedSearches]  = useState(() => Storage.getSaved());
  const [showHistory,    setShowHistory]    = useState(false);
  const [homeMapCoords,  setHomeMapCoords]  = useState(null);
  const [searchFocused,  setSearchFocused]  = useState(false);
  const [locationAllowed, setLocationAllowed] = useState(null);
  const [scrolled,       setScrolled]       = useState(false);
  // Auth state
  const [user,           setUser]           = useState(() => Auth.getUser());
  const [showAuthModal,  setShowAuthModal]  = useState(false);
  const [authMode,       setAuthMode]       = useState("signup"); // "signup" | "login"
  const [authEmail,      setAuthEmail]      = useState("");
  const [authPassword,   setAuthPassword]   = useState("");
  const [authName,       setAuthName]       = useState("");
  const [authLastName,   setAuthLastName]   = useState("");
  const [authErr,        setAuthErr]        = useState(null);
  const [authBusy,       setAuthBusy]       = useState(false);
  const [showUserMenu,   setShowUserMenu]   = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showFAQ,        setShowFAQ]        = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // All useCallback hooks next — defined in dependency order
  const resetHome = useCallback(() => {
    setPhase("home"); setLocData(null); setSignedUp(false);
    setQuery(""); setSelectedEstab(null); setErr(null);
  }, []);

  const canSearch = useCallback(() => {
    const count = Auth.getCount();
    if (Auth.isPaid()) return true;
    if (Auth.isLoggedIn() && count < 8) return true;
    if (!Auth.isLoggedIn() && count < 1) return true;
    // Maxed out
    if (!Auth.isLoggedIn()) { setShowAuthModal(true); return false; }
    setShowPaywall(true); return false;
  }, []);

  const handleAuthSubmit = useCallback(async () => {
    setAuthBusy(true); setAuthErr(null);
    try {
      const endpoint = authMode === "signup" ? "/auth/signup" : "/auth/login";
      const body = authMode === "signup"
        ? { email: authEmail, password: authPassword, name: `${authName} ${authLastName}`.trim() }
        : { email: authEmail, password: authPassword };
      const r = await fetch(`${API}${endpoint}`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Something went wrong");
      Auth.setToken(d.token);
      Auth.setUser(d.user);
      setUser(d.user);
      setShowAuthModal(false);
      setAuthEmail(""); setAuthPassword(""); setAuthName("");
    } catch(e) { setAuthErr(e.message); }
    finally { setAuthBusy(false); }
  }, [authMode, authEmail, authPassword, authName]);

  const handleLogout = useCallback(() => {
    Auth.clear(); setUser(null); setSearchCount(0);
  }, []);

  const tickSearch = useCallback(() => {
    setSearchCount(Auth.incCount());
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
    const streets = 
      loc.isPark && loc.parkStreets?.length ? loc.parkStreets : 
      (loc.isZip || loc.isNeighborhood) && loc.zipStreets?.length ? loc.zipStreets :
      loc.isGPS && loc.nearbyStreets?.length ? loc.nearbyStreets :
      loc.street ? [loc.street] : [];

    if (!streets.length) { setPhase("dash"); return; }

    // Use batch for multiple streets — one Claude call instead of N, much faster
    const cleaningCall = streets.length > 1
      ? getCleaningBatch(streets, loc.lat, loc.lng, loc.borough)
      : loadCleaningForStreets(streets, loc.lat, loc.lng);

    const [cR, fR, evR, wxR, aR] = await Promise.allSettled([
      cleaningCall,
      getFilms(loc.street, loc.borough, loc.lat, loc.lng), getEvents(loc.borough),
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
      console.log("Geocode result:", loc.type, "isNeighborhood:", loc.isNeighborhood, "zipStreets:", loc.zipStreets?.length);
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

  // When Google Places Autocomplete selects a place directly
  const handlePlaceSelect = useCallback(async ({ lat, lng, label, formatted }) => {
    if (!canSearch()) return;
    tickSearch();
    setErr(null); setPhase("loading");
    try {
      // Use our backend to get nearby streets for this location
      const r = await fetch(`${API}/api/reverse-geocode?lat=${lat}&lng=${lng}`);
      const loc = await r.json();
      if (!r.ok) throw new Error("Could not find streets near this location");
      await loadAll({ ...loc, lat, lng, label: label || formatted || loc.label });
    } catch(e) { setErr(e.message); setPhase("home"); }
  }, [canSearch, tickSearch, loadAll]);

  const handleSearchFocus = useCallback(() => {
    setSearchFocused(true);
    // Request location when user taps search bar if not yet determined
    if (locationAllowed === null && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        ({ coords: { latitude, longitude } }) => {
          setLocationAllowed(true);
          setHomeMapCoords({ lat: latitude, lng: longitude });
        },
        () => {
          setLocationAllowed(false);
          if (!homeMapCoords) 
        }
      );
    }
  }, [locationAllowed, homeMapCoords]);

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

  // Show top bar when scrolling up, hide when scrolling down
  useEffect(() => {
    let lastY = 0;
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > lastY && y > 60);
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // useEffect last — after all useCallback
  useEffect(() => {
    if (window.__AUTO_GPS__) { window.__AUTO_GPS__ = false; setTimeout(handleGPS, 500); }
  }, [handleGPS]);

  // Check location permission on load — set coords for heatmap, don't auto-navigate away
  useEffect(() => {
    if (!navigator.geolocation) {
      
      return;
    }
    navigator.permissions?.query({ name: "geolocation" }).then(perm => {
      if (perm.state === "granted") {
        setLocationAllowed(true);
        navigator.geolocation.getCurrentPosition(
          ({ coords: { latitude: lat, longitude: lng } }) => {
            setHomeMapCoords({ lat, lng });
          },
          () => setHomeMapCoords({ lat: 40.7580, lng: -73.9855 })
        );
      } else if (perm.state === "denied") {
        setLocationAllowed(false);
        
      } else {
        // Not yet determined — show NYC by default
        
      }
    }).catch(() => {
      navigator.geolocation.getCurrentPosition(
        ({ coords: { latitude: lat, longitude: lng } }) => {
          setLocationAllowed(true);
          setHomeMapCoords({ lat, lng });
        },
        () => { setLocationAllowed(false);  }
      );
    });
  }, []);

  // Derived values (not hooks)
  const today        = todayAbbr();
  const cleanToday   = cleaning.some(c => c.days?.includes(today));
  const aspOff       = asp?.suspended;
  const wxNow        = weather?.current;
  const wxDaily      = weather?.daily;
  const severeNow    = wxNow?.weather_code && SEVERE.has(wxNow.weather_code);
  const isMulti      = locData?.isPark || locData?.isZip || locData?.isNeighborhood || locData?.isGPS;
  const histPins     = showHistory && isSubscribed ? savedSearches.filter(s => s.label !== (locData?.label || locData?.street)) : [];
  const limit      = Auth.isLoggedIn() ? 8 : 1;
  const remaining  = Math.max(0, limit - searchCount);

  return (
    <>
      <style>{css}</style>

      {/* TOP BAR */}
      <div style={{
        position:"sticky",top:0,zIndex:100,background:"var(--black)",
        transform: scrolled ? "translateY(-100%)" : "translateY(0)",
        transition:"transform .25s ease",
      }}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 16px 0"}}>
        <div style={{width:110,display:"flex",justifyContent:"flex-start",position:"relative"}} ref={menuRef}>
          <button 
            className="user-pill" 
            onClick={() => setShowUserMenu(v => !v)}
            style={{whiteSpace:"nowrap",fontSize:"1rem",letterSpacing:".05em",padding:"4px 12px"}}
          >☰</button>
          {showUserMenu && (
              <div style={{position:"absolute",top:"100%",left:0,marginTop:6,background:"var(--g2)",border:"1px solid var(--yellow)",minWidth:160,zIndex:300}}>
                {!user && (
                  <div className="menu-item" onClick={() => { setShowUserMenu(false); setAuthMode("signup"); setShowAuthModal(true); }}>Sign Up</div>
                )}
                {!user && (
                  <div className="menu-item" onClick={() => { setShowUserMenu(false); setAuthMode("login"); setShowAuthModal(true); }}>Sign In</div>
                )}
                {user && (
                  <div className="menu-item" onClick={() => { setShowUserMenu(false); setPhase("account"); }}>Account</div>
                )}
                {user && (
                  <div className="menu-item" onClick={() => { setShowUserMenu(false); setShowPaywall(true); }}>Upgrade</div>
                )}
                <div className="menu-item" onClick={() => { setShowUserMenu(false); setPhase("faq"); }}>FAQ</div>
                {user && (
                  <div className="menu-item" style={{color:"var(--red)"}} onClick={() => { setShowUserMenu(false); handleLogout(); }}>Sign Out</div>
                )}
              </div>
            )}
          </div>
          <button className="home-btn" onClick={resetHome}>
            H<svg viewBox="0 0 10 11" style={{width:"0.6em",height:"0.75em",verticalAlign:"-0.05em",display:"inline-block",marginLeft:"0.08em",marginRight:"0.04em"}} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="miter" strokeLinecap="square"><polyline points="0.5,6 5,0.8 9.5,6"/><polyline points="2,5 2,10.5 8,10.5 8,5"/></svg>ME
          </button>
          <div style={{width:110,display:"flex",justifyContent:"flex-end"}}>
            {user && (
              <span className={`tier-badge tier-${user.tier}`} style={{fontSize:".65rem",padding:"3px 8px",whiteSpace:"nowrap"}}>
                Tier: {user.tier === "unlimited" ? "UNLIMITED+SAVE" : user.tier === "premium" ? "PREMIUM" : user.tier === "basic" ? "BASIC" : "FREE"}
              </span>
            )}
          </div>
        </div>
        <div style={{borderBottom:"2px solid var(--yellow)",marginTop:10}} />
      </div>

      {/* HOME */}
      {phase === "home" && (
        <div className="home">

          {/* HERO */}
          <div className="hero-section">
            <h1 className="h1">STREET PARK <em>NOW.</em></h1>
            <p className="app-tagline">Know When To Park & When To Move</p>
            <div className="search-section">
              {searchCount > 0 && (
                <div className="gate-note" style={{color: Auth.isPaid() ? "var(--yellow)" : remaining === 0 ? "var(--red)" : "var(--yellow)"}}>
                  {Auth.getTier() === "unlimited" ? "✓ Unlimited Searches + Save Feature" :
                   Auth.getTier() === "premium"   ? "✓ Unlimited Searches" :
                   Auth.getTier() === "basic"     ? `✓ ${Math.max(0, 999 - searchCount)} Searches Remaining` :
                   remaining === 0
                     ? Auth.isLoggedIn() ? "⚠ Free Searches Used — Subscribe To Continue" : "⚠ Sign Up Free To Get 8 Searches"
                     : `${remaining} Free Search${remaining === 1 ? "" : "es"} Remaining`}
                </div>
              )}
              <div style={{position:"relative"}}>
                <div className="search-box">
                  <PlacesInput
                    value={query}
                    onChange={setQuery}
                    onPlaceSelect={handlePlaceSelect}
                    onFocus={handleSearchFocus}
                    onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                    onEnter={handleSearch}
                    onGPSClick={handleGPS}
                    showDropdown={searchFocused && !query}
                  />
                  <button onClick={handleSearch}>GO</button>
                </div>
              </div>
              {err && <div className="err">⚠ {err}</div>}
            </div>
          </div>

          {/* HEAT MAP — shows once location is known */}
          {homeMapCoords && (
          <div style={{width:"100%",maxWidth:560,padding:"20px 24px 0"}}>
            <div style={{fontFamily:"var(--mono)",fontSize:".6rem",color:"var(--yellow)",letterSpacing:".12em",textTransform:"uppercase",marginBottom:8,textAlign:"center"}}>
              TAP THE LIVE PARKING HEAT MAP 🔥🗺 · OR SEARCH BAR
            </div>
            <HeatMap
              userLat={homeMapCoords.lat}
              userLng={homeMapCoords.lng}
              onStreetClick={(street) => { setQuery(street); handleSearch(); }}
            />
          </div>
          )}

          {/* SCROLLING STATS CAROUSEL */}
          <div className="carousel-section">
            <div className="carousel-label">😖 TIRED OF PARKING TICKETS? SO ARE WE. 😤</div>
            <DraggableCarousel />
          </div>

          {/* FEATURES */}
          <div className="features-section">
            {[
              { icon:"🗺", title:"Live Parking Heat Map", sub:"Color-coded streets show where parking is safest near you right now." },
              { icon:"🧹", title:"Street Cleaning Schedules", sub:"Know exactly when to move your car — with upcoming dates so you're never caught off guard." },
              { icon:"🎬", title:"Film & TV Shoot Schedules", sub:"No parking signs stapled to poles are easy to miss. We surface shoot permits before you even arrive." },
              { icon:"📅", title:"Public Events & Closures", sub:"Marathons, parades, street fairs — any permitted event that could impact your parking." },
              { icon:"🌤", title:"Weather Alerts", sub:"Snow emergencies and heavy rain trigger special parking rules. We flag them in advance." },
            ].map((f, i) => (
              <div key={i} className="feature-row">
                <div className="feature-icon">{f.icon}</div>
                <div>
                  <div className="feature-text-title">{f.title}</div>
                  <div className="feature-text-sub">{f.sub}</div>
                </div>
              </div>
            ))}
          </div>

          {/* WE'LL MOVE YOUR CAR */}
          <div className="move-car-banner">
            <span className="move-car-badge">COMING SOON</span>
            <div className="move-car-title">🚗 WE'LL MOVE YOUR CAR</div>
            <div className="move-car-sub">
              Can't move your car in time? We'll send a trusted driver.<br/>
              Smart key access only · Insured, background-checked drivers.
              <span style={{color:"#aaaaff",marginTop:6,display:"block",cursor:"pointer"}}>Join the waitlist →</span>
            </div>
          </div>

        </div>
      )}

      {/* LOADING */}
      {phase === "loading" && (
        <div className="loading"><div className="spin" /><div className="loading-lbl">Scanning NYC databases…</div></div>
      )}

      {/* FAQ PAGE */}
      {phase === "faq" && (
        <div className="dash" style={{maxWidth:600,paddingBottom:60}}>
          <div style={{display:"flex",alignItems:"center",gap:12,padding:"20px 0 16px",borderBottom:"1px solid #1f1f1f",marginBottom:24}}>
            <button onClick={resetHome} style={{background:"none",border:"1px solid #333",color:"var(--white)",fontFamily:"var(--mono)",fontSize:".6rem",padding:"5px 12px",cursor:"pointer"}}>← BACK</button>
            <div style={{fontFamily:"var(--display)",fontSize:"1.8rem",letterSpacing:".06em"}}>FAQ</div>
          </div>
          {[
            { q:"Will this prevent me from ever getting a ticket again?", a:"We can't guarantee that — and no app can. Street parking rules are complex, change frequently, and enforcement varies. What we can promise is that we work hard to surface the most accurate, up-to-date information available so you have the best possible chance of moving your car on time. Street Park Now is a tool to help you stay informed, not a substitute for reading posted signs. Always check the signs on your block — they are the legal authority." },
            { q:"How accurate is the data?", a:"We pull from official city databases, permit records, and real-time sources wherever possible. However, data can lag, cities update rules without notice, and special circumstances like holidays or emergency orders may not always be reflected immediately. We update our data regularly and are always working to improve coverage." },
            { q:"Which cities are supported?", a:"NYC, Los Angeles, Chicago, San Francisco, Boston, Philadelphia, Washington DC, Seattle, Miami, Atlanta, Toronto, Denver, Portland, Nashville, Austin, Dallas, Sacramento, Minneapolis, and New Jersey (Hoboken, Jersey City, Newark) — with more cities being added regularly." },
            { q:"What does the heat map show?", a:"The live parking heat map color-codes streets near you based on how soon street cleaning is scheduled. Red = move today or tomorrow. Yellow = move in 2-3 days. Green = safe for 4+ days. Gray = no data available." },
            { q:"What's included in each plan?", a:"Free Account: 8 searches total. Basic ($4.20/mo or $45/yr): 999 searches, last 2 searches shown on map. Premium ($5.79/mo or $58.99/yr): unlimited searches, last 2 on map. Unlimited+Save ($6.49/mo or $69.99/yr): unlimited searches + save up to 10 locations for one-tap access." },
            { q:"How do I cancel my subscription?", a:"You can cancel anytime. On iOS, go to Settings → Apple ID → Subscriptions → Street Park Now → Cancel. On the web, manage your subscription through your Stripe billing portal. Cancellations take effect at the end of your current billing period — you keep access until then." },
            { q:"Can I get a refund?", a:"We offer refunds within 48 hours of purchase if you haven't used more than 5 searches in that period. Contact us at support@streetparknow.app and we'll take care of you. Annual plans are refundable within 7 days of purchase." },
            { q:"How do I upgrade or downgrade my plan?", a:"Tap the ☰ menu → Upgrade to see all plans and select a new one. Upgrades take effect immediately. Downgrades take effect at the start of your next billing period." },
            { q:"Is my payment information secure?", a:"Yes. All payments are processed by Stripe, a PCI-compliant payment processor trusted by millions of businesses. We never see or store your credit card information." },
            { q:"Is my location data stored?", a:"Your location is used only to show nearby parking information in the moment. We do not store your location history or share it with third parties. See our Privacy Policy for full details." },
            { q:"What is the Unlimited+Save feature?", a:"With Unlimited+Save, you can save up to 10 locations and access them instantly from your home screen with one tap. Each saved location runs a full search including the live heat map. You manage which locations are saved using checkboxes — unchecked locations are removed when you return." },
            { q:"Does the app work offline?", a:"No — Street Park Now requires an internet connection to fetch live parking data, permits, and the heat map. We recommend checking before you park, not while you're parked with no signal." },
            { q:"How do I contact support?", a:"Email us at support@streetparknow.app. We typically respond within 24 hours on business days." },
          ].map((item, i, arr) => (
            <div key={i} style={{marginBottom:24,paddingBottom:24,borderBottom:i<arr.length-1?"1px solid #1f1f1f":"none"}}>
              <div style={{fontFamily:"var(--body)",fontWeight:700,fontSize:"1.05rem",color:"var(--yellow)",marginBottom:10,lineHeight:1.3}}>{item.q}</div>
              <div style={{fontFamily:"var(--mono)",fontSize:".65rem",color:"var(--muted)",lineHeight:1.8,letterSpacing:".02em"}}>{item.a}</div>
            </div>
          ))}
          <div style={{fontFamily:"var(--mono)",fontSize:".55rem",color:"#444",lineHeight:1.7,marginTop:16,paddingTop:20,borderTop:"1px solid #1f1f1f"}}>
            Street Park Now is provided for informational purposes only. We make no warranties regarding the accuracy, completeness, or timeliness of any information. Street Park Now is not liable for any parking fines, towing charges, or other penalties. Always check posted street signs — they are the legal authority.
          </div>
        </div>
      )}

      {/* ACCOUNT PAGE */}
      {phase === "account" && user && (
        <div className="dash" style={{maxWidth:600,paddingBottom:60}}>
          <div style={{display:"flex",alignItems:"center",gap:12,padding:"20px 0 16px",borderBottom:"1px solid #1f1f1f",marginBottom:24}}>
            <button onClick={resetHome} style={{background:"none",border:"1px solid #333",color:"var(--white)",fontFamily:"var(--mono)",fontSize:".6rem",padding:"5px 12px",cursor:"pointer"}}>← BACK</button>
            <div style={{fontFamily:"var(--display)",fontSize:"1.8rem",letterSpacing:".06em"}}>MY ACCOUNT</div>
          </div>

          {/* Profile */}
          <div style={{background:"var(--g1)",padding:"16px",marginBottom:2,borderRadius:2}}>
            <div style={{fontFamily:"var(--mono)",fontSize:".55rem",color:"var(--muted)",letterSpacing:".1em",marginBottom:4}}>NAME</div>
            <div style={{fontFamily:"var(--body)",fontSize:"1.1rem",color:"var(--white)",fontWeight:600}}>{user.name}</div>
          </div>
          <div style={{background:"var(--g1)",padding:"16px",marginBottom:20,borderRadius:2}}>
            <div style={{fontFamily:"var(--mono)",fontSize:".55rem",color:"var(--muted)",letterSpacing:".1em",marginBottom:4}}>EMAIL</div>
            <div style={{fontFamily:"var(--body)",fontSize:"1rem",color:"var(--white)"}}>{user.email}</div>
          </div>

          {/* Plan */}
          <div style={{background:"var(--g1)",border:"1px solid #2a2a2a",padding:"16px",marginBottom:2,borderRadius:2}}>
            <div style={{fontFamily:"var(--mono)",fontSize:".55rem",color:"var(--muted)",letterSpacing:".1em",marginBottom:8}}>CURRENT PLAN</div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontFamily:"var(--display)",fontSize:"1.4rem",color:"var(--yellow)",letterSpacing:".06em"}}>
                  {user.tier==="unlimited"?"UNLIMITED+SAVE":user.tier==="premium"?"PREMIUM":user.tier==="basic"?"BASIC":"FREE"}
                </div>
                <div style={{fontFamily:"var(--mono)",fontSize:".6rem",color:"var(--muted)",marginTop:4}}>
                  {user.tier==="unlimited"?"Unlimited searches + saved locations":user.tier==="premium"?"Unlimited searches":user.tier==="basic"?"999 searches per period":"8 free searches total"}
                </div>
              </div>
              {user.tier !== "unlimited" && (
                <button onClick={() => setShowPaywall(true)} style={{background:"var(--yellow)",color:"#000",border:"none",fontFamily:"var(--mono)",fontSize:".6rem",padding:"8px 14px",cursor:"pointer",letterSpacing:".06em",whiteSpace:"nowrap"}}>
                  UPGRADE →
                </button>
              )}
            </div>
          </div>

          {/* Billing */}
          {user.tier !== "free" && (
            <div style={{background:"var(--g1)",padding:"16px",marginBottom:2,cursor:"pointer",borderRadius:2}}
              onClick={() => window.open("https://billing.stripe.com/p/login/4gM9AVer46RF0vifvAaEE00","_blank")}>
              <div style={{fontFamily:"var(--mono)",fontSize:".55rem",color:"var(--muted)",letterSpacing:".1em",marginBottom:4}}>BILLING & PAYMENT</div>
              <div style={{fontFamily:"var(--mono)",fontSize:".72rem",color:"var(--yellow)"}}>Manage billing, invoices & cancel →</div>
            </div>
          )}

          {/* Usage */}
          <div style={{background:"var(--g1)",padding:"16px",marginBottom:24,borderRadius:2}}>
            <div style={{fontFamily:"var(--mono)",fontSize:".55rem",color:"var(--muted)",letterSpacing:".1em",marginBottom:6}}>SEARCHES USED</div>
            <div style={{fontFamily:"var(--display)",fontSize:"2rem",color:"var(--white)",lineHeight:1}}>
              {searchCount}
              <span style={{fontFamily:"var(--mono)",fontSize:".7rem",color:"var(--muted)",marginLeft:8}}>
                {user.tier==="unlimited"||user.tier==="premium"?"/ unlimited":user.tier==="basic"?"/ 999":"/ 8 free"}
              </span>
            </div>
          </div>

          {/* Support */}
          <div style={{fontFamily:"var(--mono)",fontSize:".62rem",color:"var(--muted)",lineHeight:2}}>
            Questions? <a href="mailto:support@streetparknow.app" style={{color:"var(--yellow)"}}>support@streetparknow.app</a><br/>
            <a href="https://streetparknow.vercel.app/privacy.html" target="_blank" rel="noreferrer" style={{color:"var(--muted)"}}>Privacy Policy</a>
          </div>
        </div>
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
                <div key={i} className="ambiguous-option" onClick={async () => {
                  if (opt.type === "neighborhood" || category === "Neighborhood") {
                    setPhase("loading");
                    try {
                      // Strip borough suffix for cleaner neighborhood lookup
                      const cleanLabel = opt.label.replace(/,\s*(Brooklyn|Manhattan|Queens|Bronx|Staten Island)$/i, "").trim();
                      const full = await geocode(cleanLabel, coords?.lat, coords?.lng);
                      await loadAll(full);
                    } catch(e) {
                      await loadAll(opt);
                    }
                  } else {
                    await loadAll(opt);
                  }
                }}>
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
                userLat={coords?.lat}
                userLng={coords?.lng}
                isGPS={locData.isGPS}
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
              <div className="sec" style={{position:"relative"}}>
                <div className="sec-hd">🧹 Street Cleaning {cleaning.length > 0 && <span className="badge">{cleaning.length}</span>}</div>
                {isMulti && <div className="sec-note">Showing {locData.isPark ? "all bordering streets" : locData.isNeighborhood ? "all streets in this neighborhood" : locData.isGPS ? "nearby streets · closest first" : "streets in this zip"}</div>}
                {cleaning.length === 0 ? <div className="empty">No street cleaning regulations found for this block.</div>
                  : cleaning.map((c, i) => {
                    const isBlurred = !Auth.isLoggedIn() && i >= 2;
                    return (
                      <div key={i} style={{position:"relative"}}>
                        <div className={`clean-card ${c.days?.includes(today) ? "today" : ""}`} style={isBlurred ? {filter:"blur(4px)",userSelect:"none",pointerEvents:"none"} : {}}>
                          {c.days?.includes(today) && <span className="today-tag">⚠ CLEANING TODAY</span>}
                          {isMulti && c.street && <div className="street-lbl">{c.street}</div>}
                          {c.side && <div className="side-tag">{c.side === "L" ? "Left / Even" : c.side === "R" ? "Right / Odd" : c.side}</div>}
                          <div className="chips">{DAYS.map(d => <span key={d} className={`chip ${c.days?.includes(d) ? "on" : ""}`}>{d}</span>)}</div>
                          {c.time && <div className="clean-time">{c.time}</div>}
                          {c.upcomingDates?.length > 0 && (
                            <div style={{marginTop:8,display:"flex",flexWrap:"wrap",gap:5}}>
                              {c.upcomingDates.map((d, di) => (
                                <span key={di} style={{fontFamily:"var(--mono)",fontSize:".56rem",padding:"2px 7px",background:di===0&&c.days?.includes(today)?"var(--red)":"var(--g1)",color:di===0&&c.days?.includes(today)?"var(--white)":"var(--muted)",border:"1px solid #2a2a2a",letterSpacing:".03em"}}>{d}</span>
                              ))}
                            </div>
                          )}
                          <div className="clean-raw">{c.raw}</div>
                        </div>
                        {isBlurred && i === 2 && (
                          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,background:"rgba(8,8,8,0.7)",cursor:"pointer"}} onClick={() => setShowAuthModal(true)}>
                            <div style={{fontFamily:"var(--display)",fontSize:"1.1rem",color:"var(--yellow)",letterSpacing:".06em",textAlign:"center"}}>CREATE A FREE ACCOUNT</div>
                            <div style={{fontFamily:"var(--mono)",fontSize:".6rem",color:"var(--white)",letterSpacing:".08em",textAlign:"center"}}>TO UNLOCK ALL RESULTS</div>
                            <div style={{background:"var(--yellow)",color:"#000",fontFamily:"var(--display)",fontSize:"1rem",padding:"6px 20px",letterSpacing:".08em",marginTop:4}}>SIGN UP FREE →</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>

              {/* Film permits */}
              <div className="sec">
                <div className="sec-hd">🎬 Film & TV Permits {films.length > 0 && <span className="badge">{films.length}</span>}</div>
                {films.length === 0 ? <div className="empty">No active film permits on your street this week.</div>
                  : films.map((f, i) => (
                    <div key={i} className="ev-card film">
                      <div className="ev-type">🎬 {f.type}{f.subtype && f.subtype !== f.type ? ` · ${f.subtype}` : ""}</div>
                      <div className="ev-name">{f.address || "Film Permit"}</div>
                      <div className="ev-meta">
                        {fmtDT(f.start)} → {fmtDT(f.end)}
                        {f.borough && ` · ${f.borough}`}
                        {f.parkingHeld && <><br />🚫 No parking: {f.parkingHeld.substring(0,160)}{f.parkingHeld.length>160?"…":""}</>}
                      </div>
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

      {/* AUTH MODAL */}
      {showAuthModal && (
        <div className="auth-overlay" onClick={() => setShowAuthModal(false)}>
          <div className="auth-modal" onClick={e => e.stopPropagation()}>
            <div className="auth-title">{authMode === "signup" ? "CREATE ACCOUNT" : "WELCOME BACK"}</div>
            <div className="auth-sub">
              {authMode === "signup"
                ? "Sign up for 8 free searches — no credit card needed."
                : "Sign in to continue searching."}
            </div>
            {authErr && <div className="auth-err">⚠ {authErr}</div>}
            {authMode === "signup" && (
              <div style={{display:"flex",gap:8}}>
                <input className="auth-input" style={{flex:1}} type="text" placeholder="First name" value={authName} onChange={e => setAuthName(e.target.value)} />
                <input className="auth-input" style={{flex:1}} type="text" placeholder="Last name" value={authLastName} onChange={e => setAuthLastName(e.target.value)} />
              </div>
            )}
            <input className="auth-input" type="email" placeholder="Email address" value={authEmail} onChange={e => setAuthEmail(e.target.value)} />
            <input className="auth-input" type="password" placeholder="Password" value={authPassword} onChange={e => setAuthPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAuthSubmit()} />
            <button className="auth-btn" onClick={handleAuthSubmit} disabled={authBusy}>
              {authBusy ? "..." : authMode === "signup" ? "CREATE FREE ACCOUNT →" : "SIGN IN →"}
            </button>
            <div className="auth-switch">
              {authMode === "signup" ? <>Already have an account? <span onClick={() => { setAuthMode("login"); setAuthErr(null); }}>Sign in</span></> : <>New here? <span onClick={() => { setAuthMode("signup"); setAuthErr(null); }}>Create account</span></>}
            </div>
            <button style={{position:"absolute",top:12,right:16,background:"none",border:"none",color:"var(--muted)",fontSize:"1.2rem",cursor:"pointer"}} onClick={() => setShowAuthModal(false)}>✕</button>
          </div>
        </div>
      )}

      {/* PAYWALL */}
      {showPaywall && (
        <div className="paywall-overlay" onClick={() => setShowPaywall(false)}>
          <div className="paywall-sheet" onClick={e => e.stopPropagation()} style={{maxHeight:"90vh",overflowY:"auto",width:"100%",maxWidth:560,background:"#0e0e0e",position:"relative"}}>
            <button style={{position:"absolute",top:12,right:16,background:"none",border:"none",color:"var(--muted)",fontSize:"1.2rem",cursor:"pointer"}} onClick={() => setShowPaywall(false)}>✕</button>
            <div className="paywall-title" style={{marginBottom:4}}>CHOOSE YOUR PLAN</div>
            <div className="paywall-sub" style={{marginBottom:20}}>All plans include the live parking heat map, street cleaning schedules, film permits, events & weather.</div>

            {/* Feature comparison table */}
            <div style={{overflowX:"auto",marginBottom:20,background:"#141414",border:"1px solid #2a2a2a",borderRadius:4}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"var(--mono)",fontSize:".62rem"}}>
                <thead>
                  <tr style={{background:"#1a1a1a"}}>
                    <th style={{textAlign:"left",padding:"12px 12px 12px 14px",color:"var(--white)",fontWeight:600,borderBottom:"1px solid #2a2a2a"}}>Feature</th>
                    <th style={{padding:"12px 8px",color:"var(--white)",fontWeight:700,borderBottom:"1px solid #2a2a2a",textAlign:"center"}}>Basic</th>
                    <th style={{padding:"12px 8px",color:"#aaaaff",fontWeight:700,borderBottom:"1px solid #2a2a2a",textAlign:"center"}}>Premium</th>
                    <th style={{padding:"12px 8px",color:"var(--yellow)",fontWeight:700,borderBottom:"1px solid #2a2a2a",textAlign:"center"}}>Unlimited<br/>+Save</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Searches",         "999/period",  "Unlimited",  "Unlimited"],
                    ["Live Heat Map",    "✓",           "✓",          "✓"],
                    ["Street Cleaning",  "✓",           "✓",          "✓"],
                    ["Film Permits",     "✓",           "✓",          "✓"],
                    ["Events & Weather", "✓",           "✓",          "✓"],
                    ["Recent 2 on Map",  "✓",           "✓",          "✓"],
                    ["Saved Locations",  "✗",           "✗",          "Up to 10"],
                    ["One-Tap Rerun",    "✗",           "✗",          "✓"],
                  ].map(([feat, b, p, u], ri) => (
                    <tr key={feat} style={{background: ri%2===0?"#141414":"#121212"}}>
                      <td style={{padding:"11px 12px 11px 14px",color:"var(--white)",borderBottom:"1px solid #1f1f1f",fontWeight:500}}>{feat}</td>
                      <td style={{padding:"11px 8px",textAlign:"center",borderBottom:"1px solid #1f1f1f",
                        color:b==="✓"?"#38A169":b==="✗"?"#E53E3E":b.includes("999")?"var(--white)":"var(--white)",
                        fontWeight:b==="✓"||b==="✗"?"700":"400",fontSize:b==="✓"||b==="✗"?"1rem":".62rem"}}>{b}</td>
                      <td style={{padding:"11px 8px",textAlign:"center",borderBottom:"1px solid #1f1f1f",
                        color:p==="✓"?"#38A169":p==="✗"?"#E53E3E":"#aaaaff",
                        fontWeight:p==="✓"||p==="✗"?"700":"400",fontSize:p==="✓"||p==="✗"?"1rem":".62rem"}}>{p}</td>
                      <td style={{padding:"11px 8px",textAlign:"center",borderBottom:"1px solid #1f1f1f",
                        color:u==="✓"?"#38A169":u==="✗"?"#E53E3E":u.includes("Up")?"#38A169":"var(--yellow)",
                        fontWeight:u==="✓"||u==="✗"?"700":"400",fontSize:u==="✓"||u==="✗"?"1rem":".62rem"}}>{u}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pricing cards */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16}}>
              {[
                { tier:"Basic",          color:"var(--white)",  monthly:"$4.20/mo", annual:"$45/yr",    monthlyKey:"basic-monthly",    annualKey:"basic-annual",    save:"Save 11%" },
                { tier:"Premium",        color:"#aaaaff",       monthly:"$5.79/mo", annual:"$58.99/yr", monthlyKey:"premium-monthly",  annualKey:"premium-annual",  save:"Best Value" },
                { tier:"Unlimited+Save", color:"var(--yellow)", monthly:"$6.49/mo", annual:"$69.99/yr", monthlyKey:"unlimited-monthly",annualKey:"unlimited-annual",save:"Save 10%" },
              ].map(p => (
                <div key={p.tier} style={{background:"#141414",border:`1px solid ${p.color}44`,padding:"14px 10px",textAlign:"center"}}>
                  <div style={{fontFamily:"var(--mono)",fontSize:".58rem",color:p.color,letterSpacing:".08em",marginBottom:10,fontWeight:700}}>{p.tier}</div>
                  <button onClick={() => handleCheckout(p.monthlyKey)} style={{width:"100%",background:"transparent",border:`1px solid ${p.color}`,color:p.color,fontFamily:"var(--mono)",fontSize:".6rem",padding:"8px 4px",cursor:"pointer",marginBottom:6}}>
                    {p.monthly}
                  </button>
                  <button onClick={() => handleCheckout(p.annualKey)} style={{width:"100%",background:p.color,border:`1px solid ${p.color}`,color:"#000",fontFamily:"var(--mono)",fontSize:".6rem",padding:"8px 4px",cursor:"pointer",fontWeight:700}}>
                    {p.annual}
                  </button>
                  <div style={{fontFamily:"var(--mono)",fontSize:".5rem",color:"var(--muted)",marginTop:5}}>{p.save}</div>
                </div>
              ))}
            </div>

            <button className="paywall-dismiss" onClick={() => setShowPaywall(false)}>Maybe later</button>
          </div>
        </div>
      )}
    </>
  );
}
