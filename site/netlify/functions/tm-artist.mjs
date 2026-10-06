// FOMO · prochaines dates en France d'un artiste (Ticketmaster), pour « l'artiste que tu rêves de voir ».
// La clé Ticketmaster reste ici (variable d'environnement Netlify TM_KEY), jamais dans l'app.
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" } });
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export default async (req) => {
  const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 80);
  const key = process.env.TM_KEY;
  if (!q) return json({ events: [] });
  if (!key) return json({ events: [], note: "TM_KEY manquante" });
  const u = "https://app.ticketmaster.com/discovery/v2/events.json?size=50&sort=date,asc&countryCode=FR&classificationName=music&locale=*&apikey="
    + encodeURIComponent(key) + "&keyword=" + encodeURIComponent(q);
  let evs = [];
  try { const r = await fetch(u); if (r.ok) evs = ((await r.json())._embedded || {}).events || []; } catch (e) { /* aucune date */ }
  const a = norm(q), now = new Date().toISOString(), out = [];
  for (const e of evs) {
    const names = (((e._embedded || {}).attractions) || []).map(x => norm(x.name));
    if (!names.includes(a) && !norm(e.name).startsWith(a)) continue;
    const st = (e.dates || {}).start || {};
    const d = st.dateTime || (st.localDate && st.localDate + "T" + (st.localTime || "20:00:00"));
    if (!d) continue;
    const v = (((e._embedded || {}).venues) || [{}])[0], loc = v.location || {}, sales = e.sales || {};
    const pub = (sales.public || {}).startDateTime;
    const pres = (sales.presales || []).map(p => p.startDateTime).filter(x => x && x > now).sort();
    const img = ((e.images || []).filter(i => i.ratio === "16_9").sort((x, y) => y.width - x.width).find(i => i.width <= 1100) || {}).url || "";
    const pr = (e.priceRanges || [])[0] || {};
    out.push({ id: "tm-" + e.id, src: "tm", kind: /festival/i.test(e.name) ? "festival" : "concert", t: e.name, d, end: null,
      v: v.name || "", a: [v.postalCode, (v.city || {}).name].filter(Boolean).join(" "), city: (v.city || {}).name || "", country: (v.country || {}).countryCode || "FR",
      lat: loc.latitude ? +loc.latitude : null, lon: loc.longitude ? +loc.longitude : null, p: pr.min ? Math.round(pr.min) : null,
      sale_at: pub && pub > now ? pub : null, presale_at: pres[0] || null, img, link: e.url || "",
      lineup: (((e._embedded || {}).attractions) || []).map(x => x.name), desc: "" });
  }
  return json({ events: out });
};
