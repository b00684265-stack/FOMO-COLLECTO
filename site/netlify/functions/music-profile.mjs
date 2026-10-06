// FOMO · goûts musicaux depuis un lien public Spotify ou SoundCloud (aucun compte développeur, aucune connexion).
// /.netlify/functions/music-profile?url=<lien de profil ou de playlist>
// On ne lit que des pages publiques autorisées par les robots.txt des deux sites (pas les lecteurs « /embed/ »).
const UA = "Mozilla/5.0 (compatible; FOMO-agenda/1.0; lecture a la demande de l'utilisateur)";
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const unesc = s => String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x2F;/g, "/").trim();

async function get(url, ms = 6000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { "User-Agent": UA, "Accept": "text/html", "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6" } });
    if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
    return await r.text();
  } finally { clearTimeout(t); }
}
const meta = (page, name) => {
  const out = [];
  for (const m of page.matchAll(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, "gi"))) { const c = m[0].match(/content=["']([^"']*)["']/i); if (c) out.push(unesc(c[1])); }
  return out;
};
async function pool(items, n, fn, budgetMs) {
  const t0 = Date.now(); let i = 0; const out = [];
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length && Date.now() - t0 < budgetMs) { const x = items[i++]; try { out.push(await fn(x)); } catch { /* suivant */ } } }));
  return out;
}

/* ---------------- Spotify ---------------- */
// La page publique contient l'état initial de l'application (JSON, parfois encodé en base64) : on y cherche les artistes et les playlists.
function spState(page) {
  const blobs = [];
  for (const m of page.matchAll(/<script[^>]*id=["'](?:initial-state|__NEXT_DATA__|initialState)["'][^>]*>([\s\S]*?)<\/script>/g)) {
    const raw = m[1].trim();
    for (const txt of [raw, (() => { try { return Buffer.from(raw, "base64").toString("utf8"); } catch { return ""; } })()]) {
      try { blobs.push(JSON.parse(txt)); break; } catch { /* autre format */ }
    }
  }
  return blobs;
}
function walk(o, f, depth = 0) {
  if (!o || typeof o !== "object" || depth > 40) return;
  f(o);
  for (const k in o) walk(o[k], f, depth + 1);
}
function spArtistsFrom(page) {
  const names = new Map(), lists = new Set();
  const add = (n, w = 1) => { n = unesc(n); if (n && n.length < 80) names.set(n, (names.get(n) || 0) + w); };
  for (const st of spState(page)) walk(st, o => {
    const uri = String(o.uri || "");
    if (uri.startsWith("spotify:artist:") && (o.profile?.name || o.name)) add(o.profile?.name || o.name);
    if (uri.startsWith("spotify:playlist:")) lists.add(uri.split(":")[2]);
  });
  // repli : liens d'artistes rendus dans la page
  for (const m of page.matchAll(/href="\/(?:intl-[a-z-]+\/)?artist\/[A-Za-z0-9]{22}"[^>]*>([^<]{1,80})<\/a>/g)) add(m[1]);
  for (const m of page.matchAll(/\/playlist\/([A-Za-z0-9]{22})/g)) lists.add(m[1]);
  return { names, lists: [...lists], songs: meta(page, "music:song").map(u => (u.match(/track\/([A-Za-z0-9]{22})/) || [])[1]).filter(Boolean) };
}
async function spotify(url, dbg) {
  const m = url.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(user|playlist|artist)\/([A-Za-z0-9._-]+)/);
  if (!m) throw new Error("Colle le lien de ton profil Spotify ou d'une de tes playlists (Partager → Copier le lien).");
  const [, type, id] = m, art = new Map(); let name = "", nPl = 0;
  const merge = (mp, w) => mp.forEach((v, k) => art.set(k, (art.get(k) || 0) + v * w));
  const readPlaylist = async (pid, w) => {
    const page = await get(`https://open.spotify.com/playlist/${pid}`);
    const r = spArtistsFrom(page), title = meta(page, "og:title")[0] || ""; nPl++;
    if (r.names.size >= 3) { merge(r.names, w); return title; }
    // repli : chaque titre de la playlist donne son artiste dans sa description (« Artiste · Titre · Titre · 2024 »)
    const got = await pool(r.songs.slice(0, 30), 6, async tid => {
      const p = await get(`https://open.spotify.com/track/${tid}`, 4000);
      return (meta(p, "og:description")[0] || "").split(" · ")[0];
    }, 6500);
    got.filter(Boolean).forEach(n => art.set(n, (art.get(n) || 0) + w));
    if (dbg) dbg.push({ pid, state: r.names.size, songs: r.songs.length, viaTracks: got.length });
    return title;
  };
  if (type === "playlist") name = await readPlaylist(id, 1);
  else if (type === "artist") throw new Error("C'est le lien d'un artiste : colle plutôt celui de ton profil ou d'une playlist.");
  else {
    const page = await get(`https://open.spotify.com/user/${id}`);
    name = (meta(page, "og:title")[0] || "").replace(/\s*\|\s*Spotify.*$/, "");
    const r = spArtistsFrom(page); merge(r.names, 1.5);
    if (dbg) dbg.push({ profile: id, artists: r.names.size, playlists: r.lists.length });
    const t0 = Date.now();
    for (const pid of r.lists.slice(0, 5)) { if (Date.now() - t0 > 4500) break; await readPlaylist(pid, 1).catch(() => {}); }
    if (!art.size) throw new Error("Spotify ne montre pas tes playlists publiques sur ce lien. Colle plutôt le lien d'une de tes playlists (Partager → Copier le lien) : tu peux en ajouter plusieurs.");
  }
  if (!art.size) throw new Error("Aucun artiste lisible dans cette playlist : vérifie qu'elle est publique.");
  return { src: "sp", name, playlists: nPl, artists: [...art.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200).map(([n, w]) => ({ n, w: Math.round(w * 10) / 10 })) };
}

/* ---------------- SoundCloud ---------------- */
const SC_SKIP = new Set(["", "discover", "stream", "upload", "pages", "imprint", "terms-of-use", "you", "search", "charts", "mobile", "people", "jobs", "pro", "popular", "sets", "tags", "community-guidelines", "settings", "notifications", "messages", "logout", "signin", "go", "getstarted", "company", "creators", "artists", "connect", "press", "legal", "cookies", "privacy", "help"]);
function scLinks(page, me) {
  const zone = [...page.matchAll(/<noscript>([\s\S]*?)<\/noscript>/g)].map(m => m[1]).join("\n") || page;
  const out = [];
  for (const m of zone.matchAll(/<a[^>]+href="(?:https:\/\/soundcloud\.com)?\/([A-Za-z0-9_-]+)"[^>]*>([^<]{1,80})<\/a>/g)) {
    const slug = m[1].toLowerCase(); if (SC_SKIP.has(slug) || slug === me) continue;
    out.push({ slug, n: unesc(m[2]) });
  }
  return out;
}
async function soundcloud(url) {
  const m = url.match(/soundcloud\.com\/([A-Za-z0-9_-]+)/);
  if (!m || SC_SKIP.has(m[1].toLowerCase())) throw new Error("Colle le lien de ton profil SoundCloud (ton profil → Partager → Copier le lien).");
  const me = m[1].toLowerCase(), art = new Map();
  const [fol, lik, home] = await Promise.all(["following", "likes", ""].map(p => get(`https://soundcloud.com/${me}${p ? "/" + p : ""}`).catch(e => e.status === 404 ? "404" : "")));
  if (home === "404") throw new Error("Profil SoundCloud introuvable : vérifie le lien.");
  const name = ((home.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i) || [])[1] || me);
  const fl = scLinks(fol, me), lk = scLinks(lik, me);
  fl.forEach(x => art.set(x.n, (art.get(x.n) || 0) + 2));
  lk.forEach(x => art.set(x.n, (art.get(x.n) || 0) + 1));
  if (!art.size) throw new Error("Aucun artiste visible : ton profil SoundCloud doit être public et suivre quelques artistes.");
  return { src: "sc", name: unesc(name), following: new Set(fl.map(x => x.slug)).size, likes: lk.length,
    artists: [...art.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200).map(([n, w]) => ({ n, w })) };
}

export default async (req) => {
  const p = new URL(req.url).searchParams, url = (p.get("url") || "").trim().slice(0, 300), dbg = p.has("debug") ? [] : null;
  try {
    let link = url;
    // liens courts de partage (spotify.link, on.soundcloud.com) : on suit la redirection
    if (/^https?:\/\/(spotify\.link|on\.soundcloud\.com|link\.deezer\.com|deezer\.page\.link)\//.test(link)) {
      const r = await fetch(link, { redirect: "follow", headers: { "User-Agent": UA } });
      link = r.url || link;
      if (/deezer\.com\/[a-z]{2}\/?(profile|user)\/\d+/.test(link) || /deezer\.com\/(?:[a-z]{2}\/)?(profile|user)\/\d+/.test(link)) return json({ resolved: link });
      if (/deezer/.test(link)) { const t = await r.text().catch(() => ""), m = t.match(/deezer\.com\/(?:[a-z]{2}\/)?(?:profile|user)\/(\d+)/); return json(m ? { resolved: "https://www.deezer.com/profile/" + m[1] } : { error: "Ce lien Deezer ne mène pas à un profil." }); }
    }
    if (p.has("resolve")) return json({ resolved: link });
    const out = /spotify\.com/.test(link) ? await spotify(link, dbg) : /soundcloud\.com/.test(link) ? await soundcloud(link) : null;
    if (!out) return json({ error: "Colle un lien Spotify ou SoundCloud." }, 400);
    if (dbg) out.debug = dbg;
    return json(out);
  } catch (e) {
    return json({ error: e.status === 429 || e.status === 403 ? "Le site refuse la lecture pour l'instant, réessaie plus tard." : String(e.message || e), debug: dbg || undefined }, 200);
  }
};
