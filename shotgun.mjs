// FOMO · lecture des soirées publiées sur Shotgun (pages publiques ; robots.txt de Shotgun : « Allow: / »).
// Visites espacées, identifiées, et mises en cache : une ville est relue au plus toutes les 3 h,
// chaque fiche d'événement n'est lue qu'une fois.
import { getStore } from "@netlify/blobs";

export const UA = "Mozilla/5.0 (compatible; FOMO-agenda/1.0; agenda personnel d'evenements)";
const LIST_TTL = 3 * 3600e3;
const PAR = 4;

export const slugCity = c => String(c || "paris").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/^(le|la|les)\s+/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "paris";
const unesc = s => String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x2F;/g, "/");
const num = x => { const n = parseFloat(String(x ?? "").replace(",", ".")); return isNaN(n) ? null : n; };

async function get(url, ms = 6000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { "User-Agent": UA, "Accept": "text/html", "Accept-Language": "fr-FR,fr;q=0.9" } });
    if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
    return await r.text();
  } finally { clearTimeout(t); }
}

// ---------- fiches schema.org (méthode principale) ----------
function ldEvents(page) {
  const out = [];
  for (const m of page.matchAll(/<script[^>]*application\/ld(?:\+|&#x2B;)json[^>]*>([\s\S]*?)<\/script>/g)) {
    let j; try { j = JSON.parse(m[1].trim()); } catch { continue; }
    const L = Array.isArray(j) ? j : (j && j["@graph"]) || [j];
    for (const x of L) { const t = x && x["@type"]; if (String(Array.isArray(t) ? t.join(" ") : t || "").includes("Event")) out.push(x); }
  }
  return out;
}
function fromLd(ev, slug, kind, city) {
  let loc = ev.location || {}; if (Array.isArray(loc)) loc = loc[0] || {};
  let addr = loc.address || {}; if (typeof addr === "string") addr = { streetAddress: addr };
  const geo = loc.geo || {};
  let offers = ev.offers || []; if (!Array.isArray(offers)) offers = [offers];
  offers = offers.filter(o => o && typeof o === "object");
  const avail = offers.map(o => String(o.availability || "")).join(" ");
  const live = offers.filter(o => !/SoldOut|Discontinued/.test(String(o.availability || ""))).map(o => num(o.price)).filter(p => p != null);
  const all = offers.map(o => num(o.price)).filter(p => p != null), prices = live.length ? live : all;
  const now = new Date().toISOString();
  const fut = offers.map(o => o.validFrom).filter(v => v && new Date(v).toISOString() > now).sort();
  let img = ev.image; if (Array.isArray(img)) img = img[0]; if (img && typeof img === "object") img = img.url;
  let perf = ev.performer || []; if (!Array.isArray(perf)) perf = [perf];
  return {
    id: "s-" + slug, src: "sg", kind, t: unesc(String(ev.name || "").trim()), d: ev.startDate, end: ev.endDate || null,
    v: unesc(loc.name || ""), a: unesc(addr.streetAddress || [addr.postalCode, addr.addressLocality].filter(Boolean).join(" ")),
    city: addr.addressLocality || city, lat: num(geo.latitude), lon: num(geo.longitude),
    p: prices.length ? Math.round(Math.min(...prices)) : null,
    soldout: offers.length > 0 && !/InStock|LimitedAvailability|PreOrder/.test(avail),
    img: img || "", link: ev.url || "https://shotgun.live/fr/" + (kind === "festival" ? "festivals/" : "events/") + slug,
    lineup: perf.map(p => p && p.name && unesc(p.name)).filter(Boolean).slice(0, 12),
    desc: unesc(String(ev.description || "").replace(/<[^>]+>/g, " ")).slice(0, 600),
    sale_at: fut.length && !/InStock|LimitedAvailability/.test(avail) ? fut[0] : null,
    lottery: /tirage au sort|lottery|ballot/i.test(String(ev.description || "")),
  };
}

// ---------- secours : balises meta et données de la page ----------
const MOIS = { janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, août: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12, décembre: 12 };
function meta(page, name) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, "i"), m = page.match(re);
  if (!m) return "";
  const c = m[0].match(/content=["']([^"']*)["']/i); return c ? unesc(c[1]) : "";
}
function fromPage(page, slug, kind, city) {
  const flat = page.replace(/\\\\"/g, '"').replace(/\\"/g, '"').replace(/\\u0026/g, "&");
  const iso = k => { const m = flat.match(new RegExp(`"${k}"\\s*:\\s*"(\\d{4}-\\d\\d-\\d\\dT[^"]+)"`)); return m ? m[1] : null; };
  let d = iso("startDate") || iso("startTime") || iso("startsAt") || iso("beginsAt") || iso("start_time");
  const end = iso("endDate") || iso("endTime") || iso("endsAt") || iso("end_time");
  const desc = meta(page, "description");
  if (!d) { // « … le 5 octobre 2026 » + heure lue sur la page
    const m = desc.match(/(\d{1,2})(?:er)?\s+([a-zéûô]+)\s+(\d{4})/i), mo = m && MOIS[m[2].toLowerCase()];
    if (!mo) return null;
    let h = 23, mi = 0;
    const tm = page.match(/\bat (\d{1,2})(?::(\d\d))?\s?(AM|PM)\b/i) || page.match(/\b(\d{1,2})[:h](\d\d)\b/);
    if (tm) { h = +tm[1] % 12 + (/PM/i.test(tm[3] || "") ? 12 : 0); if (!tm[3]) h = +tm[1]; mi = +(tm[2] || 0); }
    d = `${m[3]}-${String(mo).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00${mo >= 4 && mo <= 10 ? "+02:00" : "+01:00"}`;
  }
  let t = meta(page, "og:title").replace(/\s*·\s*Billets Shotgun.*$/i, "");
  const c = city && new RegExp(",\\s*" + city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "i"); if (c) t = t.replace(c, "");
  if (!t) return null;
  const ll = flat.match(/lat=(-?\d+\.\d+)&(?:amp;)?lng=(-?\d+\.\d+)/) || flat.match(/"latitude"\s*:\s*(-?\d+\.\d+)\s*,\s*"longitude"\s*:\s*(-?\d+\.\d+)/);
  const ad = flat.match(/(\d{1,4}[^<>"]{3,80},\s*\d{5}\s+[^<>",]{2,40}(?:,\s*France)?)/);
  const pr = [...flat.matchAll(/(\d{1,3}(?:[.,]\d\d)?)\s?€|€\s?(\d{1,3}(?:[.,]\d\d)?)/g)].map(m => num(m[1] || m[2])).filter(x => x != null);
  const vn = flat.match(/"venue"\s*:\s*\{[^{}]*?"name"\s*:\s*"([^"]{2,80})"/) || flat.match(/"location"\s*:\s*\{[^{}]*?"name"\s*:\s*"([^"]{2,80})"/);
  return {
    id: "s-" + slug, src: "sg", kind, t, d, end, v: vn ? unesc(vn[1]) : "", a: ad ? unesc(ad[1]) : "", city,
    lat: ll ? +ll[1] : null, lon: ll ? +ll[2] : null, p: pr.length ? Math.round(Math.min(...pr)) : null, soldout: /complet|sold.?out/i.test(meta(page, "description")),
    img: meta(page, "og:image"), link: "https://shotgun.live/fr/" + (kind === "festival" ? "festivals/" : "events/") + slug, lineup: [], desc: "", sale_at: null, lottery: false, fallback: true,
  };
}
export function parseEvent(page, slug, kind, city) {
  const L = ldEvents(page);
  if (L.length) { const e = fromLd(L[0], slug, kind, city); if (e.t && e.d) return e; }
  return fromPage(page, slug, kind, city);
}
export function listSlugs(page) {
  const ev = [...new Set([...page.matchAll(/\/events\/([a-z0-9][a-z0-9-]+)/g)].map(m => m[1]))].map(s => ["events", s]);
  const fe = [...new Set([...page.matchAll(/\/festivals\/([a-z0-9][a-z0-9-]+)/g)].map(m => m[1]))].filter(s => s !== "-").map(s => ["festivals", s]);
  return ev.concat(fe);
}

// Lit (ou complète) le cache d'une ville en restant sous `budget` millisecondes.
export async function refreshCity(cityName, budget = 7500) {
  const t0 = Date.now(), slug = slugCity(cityName), store = getStore("shotgun");
  const c = (await store.get("city-" + slug, { type: "json" }).catch(() => null)) || { t: 0, slugs: [], ev: {}, miss: {} };
  const nowIso = new Date().toISOString();
  let err = null;
  if (Date.now() - c.t > LIST_TTL) {
    try {
      const page = await get(`https://shotgun.live/fr/cities/${slug}?page=4`);
      c.slugs = listSlugs(page).slice(0, 80); c.t = Date.now(); c.err = null;
    } catch (e) { err = e.status === 404 ? "ville absente de Shotgun" : String(e.message || e); c.err = err; if (!c.t) c.t = Date.now() - LIST_TTL + 3600e3; }
  }
  // on oublie les soirées passées
  for (const k in c.ev) { const e = c.ev[k]; if (new Date(e.end || e.d) < new Date(Date.now() - 6 * 3600e3)) delete c.ev[k]; }
  const todo = c.slugs.filter(([, s]) => !c.ev[s] && !(c.miss[s] > 2));
  let i = 0, blocked = 0;
  const work = async () => {
    while (i < todo.length && Date.now() - t0 < budget - 2500 && blocked < 3) {
      const [pre, s] = todo[i++];
      try {
        const e = parseEvent(await get(`https://shotgun.live/fr/${pre}/${s}`, 5000), s, pre === "festivals" ? "festival" : null, cityName);
        if (e && e.d && new Date(e.end || e.d) > new Date()) c.ev[s] = e; else c.miss[s] = (c.miss[s] || 0) + 1;
      } catch (e) { if (e.status === 403 || e.status === 429) blocked++; c.miss[s] = (c.miss[s] || 0) + 1; }
    }
  };
  await Promise.all(Array.from({ length: PAR }, work));
  if (blocked >= 3) { err = err || "Shotgun refuse les visites pour l'instant"; c.err = err; }
  c.seen = nowIso;
  await store.setJSON("city-" + slug, c).catch(() => {});
  // villes demandées récemment : la tâche planifiée les tient à jour
  try {
    const R = (await store.get("cities", { type: "json" })) || {};
    R[slug] = { name: cityName, at: Date.now() };
    for (const k in R) if (Date.now() - R[k].at > 10 * 864e5) delete R[k];
    await store.setJSON("cities", R);
  } catch { /* sans importance */ }
  const events = Object.values(c.ev).sort((a, b) => String(a.d).localeCompare(String(b.d)));
  return { city: cityName, slug, events, listed: c.slugs.length, pending: c.slugs.filter(([, s]) => !c.ev[s] && !(c.miss[s] > 2)).length, err: err || c.err || null, fallback: events.filter(e => e.fallback).length };
}
