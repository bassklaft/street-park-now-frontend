import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, SafeAreaView, Keyboard } from 'react-native';

const API = 'https://street-park-info-backend.onrender.com';

export default function App() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [ambiguous, setAmbiguous] = useState(null);
  const [cleaning, setCleaning] = useState([]);
  const [error, setError] = useState(null);

  const fetchCleaningForStreets = async (streets, lat, lng) => {
    const results = await Promise.all(streets.map(async s => {
      try {
        const p = new URLSearchParams({ street: s });
        if (lat && lng) { p.set('lat', lat); p.set('lng', lng); }
        const r = await fetch(`${API}/api/cleaning?${p}`);
        const data = r.ok ? await r.json() : [];
        return data.map(c => ({ ...c, street: s }));
      } catch { return []; }
    }));
    return results.flat();
  };

  const loadLocation = async (loc) => {
    const streets =
      loc.isPark && loc.parkStreets?.length ? loc.parkStreets :
      (loc.isZip || loc.isNeighborhood) && loc.zipStreets?.length ? loc.zipStreets :
      [loc.street];
    const data = await fetchCleaningForStreets(streets, loc.lat, loc.lng);
    setResult(loc);
    setCleaning(data);
  };

  const search = async (q) => {
    const searchQuery = (q || query).trim();
    if (!searchQuery) return;
    Keyboard.dismiss();
    setLoading(true); setError(null); setResult(null); setCleaning([]); setAmbiguous(null);
    try {
      const r = await fetch(`${API}/api/geocode?q=${encodeURIComponent(searchQuery)}`);
      const loc = await r.json();
      if (!r.ok) throw new Error(loc.error || 'Not found');
      if (loc.type === 'ambiguous') { setAmbiguous(loc); setLoading(false); return; }
      await loadLocation(loc);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const pickOption = async (opt) => {
    setAmbiguous(null);
    setLoading(true);
    try {
      if (opt.type === 'neighborhood' || !opt.zipStreets?.length) {
        const clean = opt.label.replace(/,\s*(Brooklyn|Manhattan|Queens|Bronx|Staten Island)$/i, '').trim();
        const r = await fetch(`${API}/api/geocode?q=${encodeURIComponent(clean)}`);
        const full = await r.json();
        await loadLocation(full);
      } else {
        await loadLocation(opt);
      }
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const today = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date().getDay()];
  const isMulti = result?.isPark || result?.isZip || result?.isNeighborhood;
  const groupByCategory = (options) => options.reduce((acc, opt) => { const cat = opt.category || 'Other'; if (!acc[cat]) acc[cat] = []; acc[cat].push(opt); return acc; }, {});

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="always">
        <Text style={s.logo}>STREET PARK <Text style={s.accent}>INFO</Text></Text>
        {!result && !ambiguous && <Text style={s.tagline}>KNOW BEFORE{'\n'}YOU PARK.</Text>}
        <View style={s.row}>
          <TextInput style={s.input} placeholder="Broadway, Brooklyn Heights, 11211…" placeholderTextColor="#555" value={query} onChangeText={setQuery} onSubmitEditing={() => search()} returnKeyType="search" autoCapitalize="none" />
          <TouchableOpacity style={s.btn} onPress={() => search()} disabled={loading}>
            {loading ? <ActivityIndicator color="#000" /> : <Text style={s.btnText}>GO</Text>}
          </TouchableOpacity>
        </View>
        {error && <Text style={s.err}>⚠ {error}</Text>}

        {ambiguous && (
          <View>
            <Text style={s.ambigTitle}>Did you mean…</Text>
            <Text style={s.ambigSub}>"{ambiguous.label}" could refer to a few things. Pick one:</Text>
            {Object.entries(groupByCategory(ambiguous.options)).map(([cat, opts]) => (
              <View key={cat}>
                <Text style={s.ambigCat}>{cat}</Text>
                {opts.map((opt, i) => (
                  <TouchableOpacity key={i} style={s.ambigOption} onPress={() => pickOption(opt)}>
                    <View style={{flex:1}}>
                      <Text style={s.ambigLabel}>{opt.label}</Text>
                      <Text style={s.ambigMeta}>{opt.borough}{opt.neighborhood ? ` · ${opt.neighborhood}` : ''}</Text>
                    </View>
                    <Text style={s.ambigArrow}>→</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </View>
        )}

        {result && (
          <View style={s.card}>
            <Text style={s.cardEye}>📍 YOUR LOCATION</Text>
            <Text style={s.cardName}>{result.label || result.street}</Text>
            <Text style={s.cardMeta}>{[result.neighborhood, result.borough].filter(Boolean).join(' · ')}</Text>
            {isMulti && <Text style={s.cardSub}>{cleaning.length} streets · alphabetical</Text>}
          </View>
        )}

        {cleaning.length > 0 && cleaning.map((c, i) => (
          <View key={i} style={[s.cleanCard, c.days?.includes(today) && s.cleanToday]}>
            {c.days?.includes(today) && <Text style={s.todayBadge}>⚠ CLEANING TODAY</Text>}
            {isMulti && c.street && <Text style={s.streetLbl}>{c.street}</Text>}
            {c.side && <Text style={s.sideTag}>{c.side === 'L' ? 'Left / Even' : c.side === 'R' ? 'Right / Odd' : c.side}</Text>}
            <View style={s.chips}>{DAYS.map(d => <Text key={d} style={[s.chip, c.days?.includes(d) && s.chipOn]}>{d}</Text>)}</View>
            {c.time && <Text style={s.cleanTime}>{c.time}</Text>}
            {c.upcomingDates?.length > 0 && (
              <View style={{flexDirection:'row',flexWrap:'wrap',gap:4,marginTop:6}}>
                {c.upcomingDates.map((d,di) => <Text key={di} style={[s.dateChip, di===0&&c.days?.includes(today)&&s.dateChipToday]}>{d}</Text>)}
              </View>
            )}
            <Text style={s.cleanRaw}>{c.raw}</Text>
          </View>
        ))}

        {result && cleaning.length === 0 && !loading && (
          <Text style={s.empty}>No cleaning regulations found.</Text>
        )}

        {(result || ambiguous) && (
          <TouchableOpacity style={s.newSearch} onPress={() => { setResult(null); setCleaning([]); setAmbiguous(null); setQuery(''); }}>
            <Text style={s.newSearchText}>← New Search</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex:1, backgroundColor:'#080808' },
  scroll: { padding:24, paddingBottom:60 },
  logo: { fontSize:22, color:'#F7C948', fontWeight:'700', letterSpacing:1, marginBottom:4, marginTop:8 },
  accent: { color:'#EDEBE4' },
  tagline: { fontSize:40, color:'#EDEBE4', fontWeight:'700', marginBottom:32, lineHeight:44 },
  row: { flexDirection:'row', borderWidth:2, borderColor:'#F7C948', marginBottom:16, backgroundColor:'#1e1e1e' },
  input: { flex:1, color:'#EDEBE4', fontSize:15, padding:14 },
  btn: { backgroundColor:'#F7C948', justifyContent:'center', alignItems:'center', paddingHorizontal:20 },
  btnText: { fontSize:18, fontWeight:'700', color:'#000' },
  err: { color:'#E53E3E', fontSize:13, marginBottom:12 },
  ambigTitle: { fontSize:26, color:'#EDEBE4', fontWeight:'700', marginBottom:6 },
  ambigSub: { fontSize:12, color:'#666', marginBottom:16, lineHeight:18 },
  ambigCat: { fontSize:10, color:'#F7C948', letterSpacing:2, textTransform:'uppercase', marginBottom:6, marginTop:16 },
  ambigOption: { flexDirection:'row', alignItems:'center', backgroundColor:'#1e1e1e', borderWidth:1, borderColor:'#2a2a2a', padding:14, marginBottom:6, borderRadius:6 },
  ambigLabel: { fontSize:16, color:'#EDEBE4', fontWeight:'600', marginBottom:2 },
  ambigMeta: { fontSize:11, color:'#666' },
  ambigArrow: { fontSize:16, color:'#555', marginLeft:8 },
  card: { backgroundColor:'#1e1e1e', borderWidth:1, borderColor:'#2a2a2a', padding:16, marginBottom:12, borderRadius:8 },
  cardEye: { fontSize:10, color:'#F7C948', letterSpacing:2, marginBottom:4 },
  cardName: { fontSize:22, color:'#EDEBE4', fontWeight:'700', marginBottom:4 },
  cardMeta: { fontSize:12, color:'#666' },
  cardSub: { fontSize:11, color:'#F7C948', marginTop:4 },
  cleanCard: { backgroundColor:'#1e1e1e', borderWidth:1, borderColor:'#222', padding:14, marginBottom:8, borderRadius:8 },
  cleanToday: { borderColor:'#E53E3E', backgroundColor:'#120808' },
  todayBadge: { fontSize:10, color:'#E53E3E', letterSpacing:2, marginBottom:8 },
  streetLbl: { fontSize:10, color:'#F7C948', letterSpacing:2, marginBottom:4, textTransform:'uppercase' },
  sideTag: { fontSize:11, color:'#666', marginBottom:6 },
  chips: { flexDirection:'row', flexWrap:'wrap', gap:4, marginBottom:8 },
  chip: { fontSize:11, paddingHorizontal:8, paddingVertical:3, borderWidth:1, borderColor:'#2a2a2a', color:'#555', borderRadius:4 },
  chipOn: { backgroundColor:'#F7C948', borderColor:'#F7C948', color:'#000' },
  cleanTime: { fontSize:22, color:'#EDEBE4', fontWeight:'700', marginBottom:4 },
  dateChip: { fontSize:10, paddingHorizontal:7, paddingVertical:2, backgroundColor:'#141414', borderWidth:1, borderColor:'#2a2a2a', color:'#666', borderRadius:3 },
  dateChipToday: { backgroundColor:'#E53E3E', borderColor:'#E53E3E', color:'#fff' },
  cleanRaw: { fontSize:11, color:'#444', lineHeight:16, marginTop:4 },
  empty: { fontSize:13, color:'#444', marginTop:8 },
  newSearch: { marginTop:24, padding:14, borderWidth:1, borderColor:'#2a2a2a', alignItems:'center', borderRadius:8 },
  newSearchText: { fontSize:13, color:'#666' },
});
