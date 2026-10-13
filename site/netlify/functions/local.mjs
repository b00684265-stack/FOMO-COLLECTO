// FOMO · ce qui se passe autour d'un lieu, partout en France (ville choisie en haut de l'app, séjour, ta position)
// Sources : DATAtourisme (fêtes, brocantes, animations, visites : la base nationale des offices de tourisme, Licence Ouverte)
// et Ticketmaster (concerts, spectacles, théâtre ; clé TM_KEY déjà utilisée par FOMO).
// /.netlify/functions/local?lat=49.42&lon=0.23&r=10   (r en km, 30 au plus)
// La clé DATAtourisme reste ici (variable d'environnement Netlify DATATOURISME_KEY), jamais dans l'app.
// Les réponses sont gardées 6 h par le cache de Netlify : un même coin de France n'est demandé qu'une fois pour tout le monde.
const json = (body, status = 200, cache = true) => new Response(JSON.stringify(body), { status, headers: {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": cache ? "public, max-age=3600" : "no-store",
  ...(cache ? { "Netlify-CDN-Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400, durable" } : {}) } });

const lbl = x => {
  if (x && typeof x === "object" && !Array.isArray(x)) { const v = x.fr ?? x["@value"] ?? Object.values(x)[0] ?? ""; return Array.isArray(v) ? (v[0] || "") : (typeof v === "string" ? v : ""); }
  if (Array.isArray(x)) return x.length ? lbl(x[0]) : "";
  return typeof x === "string" ? x : "";
};
function find(o, keys, depth = 0) {
  if (depth > 6 || o == null) return null;
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, keys, depth + 1); if (r != null) return r; } return null; }
  if (typeof o === "object") {
    for (const k of keys) if (k in o && o[k] != null && o[k] !== "" && !(Array.isArray(o[k]) && !o[k].length)) return o[k];
    for (const v of Object.values(o)) { const r = find(v, keys, depth + 1); if (r != null) return r; }
  }
  return null;
}
function periods(o) {
  let tp = o.takesPlaceAt || find(o, ["takesPlaceAt"]) || [];
  if (!Array.isArray(tp)) tp = [tp];
  const out = [];
  for (const p of tp) {
    if (!p || typeof p !== "object") continue;
    const st = lbl(p.startDate || p["schema:startDate"]), en = lbl(p.endDate || p["schema:endDate"]) || st;
    if (st && st.length >= 10) out.push([st, en && en.length >= 10 ? en : st, lbl(p.startTime || "")]);
  }
  return out.sort((a, b) => a[0] < b[0] ? -1 : 1);
}
function geo(o) {
  let la = find(o, ["latitude", "schema:latitude", "lat"]), lo = find(o, ["longitude", "schema:longitude", "lon", "lng"]);
  if (la == null || lo == null) {
    const gp = find(o, ["geoPoint", "geo"]);
    if (typeof gp === "string" && gp.includes(",")) [la, lo] = gp.split(",");
    else if (gp && typeof gp === "object") { la = gp.lat ?? gp.latitude; lo = gp.lon ?? gp.longitude; }
  }
  const a = parseFloat(typeof la === "number" ? la : lbl(la)), b = parseFloat(typeof lo === "number" ? lo : lbl(lo));
  return isNaN(a) || isNaN(b) ? [null, null] : [a, b];
}

// Ticketmaster autour du lieu (même forme que la collecte de la nuit)
const TM_SEG = "KZFzniwnSyZfZ7v7nJ,KZFzniwnSyZfZ7v7na"; // musique, arts et spectacles (le sport vient du calendrier officiel)
const strip = s => String(s || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
function tmNorm(e) {
  const st = (e.dates || {}).start || {};
  const d = st.dateTime || (st.localDate && st.localDate + "T" + (st.localTime || "20:00:00"));
  if (!d) return null;
  const code = ((e.dates || {}).status || {}).code;
  if (code === "cancelled") return null;
  const cl = (e.classifications || [{}])[0] || {};
  const seg = (cl.segment || {}).name || "", gen = (cl.genre || {}).name || "", sub = (cl.subGenre || {}).name || "", name = e.name || "";
  if (/sport/i.test(seg)) return null;
  const txt = (name + " " + gen + " " + sub).toLowerCase();
  let kind;
  if (/music/i.test(seg)) kind = txt.includes("festival") ? "festival" : "concert";
  else if (/arts|theatre/i.test(seg)) kind = /comed|humou?r/.test(txt) ? "humour" : "theatre";
  else return null;
  const v = ((e._embedded || {}).venues || [{}])[0] || {}, loc = v.location || {}, sales = e.sales || {}, now = new Date().toISOString();
  const pub = (sales.public || {}).startDateTime;
  const pres = (sales.presales || []).filter(p => (p.startDateTime || "") > now).sort((a, b) => a.startDateTime < b.startDateTime ? -1 : 1);
  const imgs = (e.images || []).filter(i => i.ratio === "16_9").sort((a, b) => (b.width || 0) - (a.width || 0));
  const img = (imgs.find(i => (i.width || 0) <= 1100) || imgs[0] || {}).url || "";
  const pr = (e.priceRanges || [{}])[0] || {};
  const att = ((e._embedded || {}).attractions || []).map(a => a.name).filter(Boolean);
  return { id: "tm-" + e.id, src: "tm", kind, tmg: [gen, sub].filter(x => x && x !== "Undefined").join(" / "), t: name, d, end: null,
    v: v.name || "", a: [v.postalCode, (v.city || {}).name].filter(Boolean).join(" "), city: (v.city || {}).name || "", country: (v.country || {}).countryCode || "FR",
    lat: loc.latitude ? +loc.latitude : null, lon: loc.longitude ? +loc.longitude : null, p: pr.min ? Math.round(pr.min) : null,
    genres: [gen, sub].filter(x => x && !["Undefined", "Other"].includes(x)), sale_at: pub && pub > now ? pub : null,
    presale_at: pres[0] ? pres[0].startDateTime : null, presale_name: pres[0] ? pres[0].name : null,
    soldout: code === "offsale" && !(pub && pub > now), img, link: e.url || "", lineup: att, desc: strip(e.description || e.info).slice(0, 400) };
}
async function tmAround(lat, lon, r) {
  const key = (process.env.TM_KEY || "").trim();
  if (!key) return [];
  const iso = d => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const a = new Date(), b = new Date(Date.now() + 120 * 864e5), out = [];
  for (let page = 0; page < 2; page++) {
    try {
      const u = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${encodeURIComponent(key)}&countryCode=FR&latlong=${lat.toFixed(3)},${lon.toFixed(3)}`
        + `&radius=${Math.max(15, r * 2)}&unit=km&segmentId=${TM_SEG}&size=200&page=${page}&sort=date,asc&locale=*&startDateTime=${iso(a)}&endDateTime=${iso(b)}`;
      const res = await fetch(u); if (!res.ok) break;
      const j = await res.json(), evs = (j._embedded || {}).events || [];
      for (const e of evs) { const x = tmNorm(e); if (x) out.push(x); }
      if (((j.page || {}).totalPages || 1) <= page + 1) break;
    } catch (e) { break; }
  }
  return out;
}

export default async (req) => {
  const key = (process.env.DATATOURISME_KEY || "").trim();
  const q = new URL(req.url).searchParams;
  const lat = +q.get("lat"), lon = +q.get("lon"), r = Math.min(30, Math.max(1, +q.get("r") || 10));
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json({ error: "Position invalide" }, 400, false);
  const tmP = q.get("tm") === "1" ? tmAround(lat, lon, r) : Promise.resolve([]);
  if (!key) { const tm = await tmP; return json({ events: tm, n: tm.length, note: "DATATOURISME_KEY manquante sur Netlify" }, 200, tm.length > 0); }
  const today = new Date().toISOString().slice(0, 10);
  const base = `https://api.datatourisme.fr/v1/entertainmentAndEvent?geo_distance=${lat.toFixed(3)},${lon.toFixed(3)},${r}km&page_size=100`
    + "&fields=uuid,label,type,takesPlaceAt,isLocatedAt,hasDescription,hasContact,hasMainRepresentation";
  let url = base + `&takesPlaceAt.endDate%5Bgte%5D=${today}`, pages = 0, retried = false;
  const out = [], seen = new Set(), t0 = Date.now();
  while (url && pages < 5 && Date.now() - t0 < 8000) {
    pages++;
    let j;
    try {
      const res = await fetch(url, { headers: { "X-API-Key": key, Accept: "application/json" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      j = await res.json();
    } catch (e) {
      // certains comptes n'acceptent pas le filtre de date : on filtre nous-mêmes
      if (pages === 1 && !retried) { retried = true; url = base; pages = 0; continue; }
      break;
    }
    const items = Array.isArray(j) ? j : (j.objects || j.results || j.data || []);
    for (const o of items) {
      const per = periods(o).filter(p => p[1].slice(0, 10) >= today);
      if (!per.length) continue;
      const [start, end, st] = per[0];
      const t = lbl(o.label || o["rdfs:label"] || find(o, ["label", "rdfs:label"]));
      if (!t) continue;
      const id = "dt-" + String(o.uuid || o["@id"] || (t + start)).slice(-40);
      if (seen.has(id)) continue; seen.add(id);
      const [la, lo] = geo(o);
      const town = lbl(find(o, ["addressLocality", "schema:addressLocality"])) || "";
      const types = o.type || o["@type"] || [];
      const tags = (Array.isArray(types) ? types : [types]).filter(x => typeof x === "string").map(x => x.split("#").pop().split(":").pop());
      let d = start.slice(0, 10) + "T" + (/^\d\d:\d\d/.test(st) ? st.slice(0, 5) : "10:00");
      if (d.slice(0, 10) < today) d = today + "T10:00";
      out.push({ id, src: "datatourisme", kind: "local", t, d, end: end.slice(0, 10) !== start.slice(0, 10) ? end.slice(0, 10) : null,
        v: town, a: town, city: town, lat: la, lon: lo, p: null, tags,
        desc: (lbl(find(o, ["shortDescription", "dc:description", "description"])) || "").slice(0, 300), img: "", lineup: [],
        link: lbl(find(o, ["homepage", "foaf:homepage", "url", "website"])) || "" });
    }
    const nxt = (j && j.meta && j.meta.next) || null;
    url = nxt ? (nxt.startsWith("/") ? "https://api.datatourisme.fr" + nxt : nxt) : null;
  }
  const tm = await tmP;
  return json({ events: out.concat(tm), n: out.length + tm.length, dt: out.length, tm: tm.length, at: new Date().toISOString() });
};
