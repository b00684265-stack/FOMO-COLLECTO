// FOMO · connexion Strava pour tous les utilisateurs, y compris depuis l'app installée sur l'écran d'accueil.
// Sur iPhone, la page d'autorisation Strava s'ouvre dans Safari et ne peut pas revenir directement dans l'app :
// ce serveur reçoit donc la réponse de Strava, calcule un résumé, le garde 15 minutes sous un code à usage unique
// (Netlify Blobs), et l'app vient le chercher dès qu'on y revient.
// Le « Client Secret » Strava reste ici (variables d'environnement Netlify). Aucun jeton Strava n'est conservé.
import { getStore } from "@netlify/blobs";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const page = (title, text) => new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FOMO</title><style>body{font-family:-apple-system,system-ui,sans-serif;background:#15162B;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}
h1{font-size:26px;margin:0 0 12px}p{color:#C9CBE0;font-size:17px;line-height:1.5;max-width:340px;margin:0 auto 22px}a{display:inline-block;background:#FF2E63;color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:999px}</style></head>
<body><div><h1>${title}</h1><p>${text}</p><a href="/">Ouvrir FOMO</a></div>
<script>try{if(window.opener){window.opener.postMessage({fomoStrava:1},"*");setTimeout(()=>window.close(),1200);}}catch(e){}</script></body></html>`,
  { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
const okKey = k => /^[A-Za-z0-9_-]{12,40}$/.test(k || "");

async function summarize(token) {
  const H = { Authorization: "Bearer " + token };
  let acts = [];
  try { const r = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=200", { headers: H }); if (r.ok) acts = await r.json(); } catch (e) { /* résumé vide */ }
  // on rend l'accès : FOMO n'a plus aucun droit sur le compte Strava
  fetch("https://www.strava.com/oauth/deauthorize", { method: "POST", headers: H }).catch(() => {});
  const counts = {}, runs = [], trailDplus = [];
  for (const a of Array.isArray(acts) ? acts : []) {
    const t = a.sport_type || a.type || "Autre";
    counts[t] = (counts[t] || 0) + 1;
    if (/Run/.test(t)) { runs.push((a.distance || 0) / 1000); if (t === "TrailRun") trailDplus.push(a.total_elevation_gain || 0); }
  }
  const sorted = runs.slice().sort((a, b) => a - b);
  return { n: Array.isArray(acts) ? acts.length : 0, counts,
    maxRunKm: runs.length ? Math.round(Math.max(...runs)) : 0,
    medRunKm: sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10 : 0,
    avgDplus: trailDplus.length ? Math.round(trailDplus.reduce((a, b) => a + b, 0) / trailDplus.length) : null };
}

export default async (req) => {
  const id = process.env.STRAVA_CLIENT_ID, secret = process.env.STRAVA_CLIENT_SECRET;
  const u = new URL(req.url), q = u.searchParams, store = getStore("strava");

  // 1. retour de Strava après « Autoriser »
  if (q.has("state") && (q.has("code") || q.has("error"))) {
    const k = (q.get("state") || "").replace(/^st/, "");
    if (!okKey(k)) return page("Oups", "Lien de connexion invalide. Recommence depuis FOMO.");
    if (q.has("error")) { await store.setJSON(k, { error: "Connexion annulée sur Strava.", at: Date.now() }); return page("Connexion annulée", "Tu peux revenir dans FOMO et réessayer quand tu veux."); }
    if (!id || !secret) return page("Bientôt", "La connexion Strava n'est pas encore activée sur FOMO.");
    const tr = await fetch("https://www.strava.com/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id, client_secret: secret, code: q.get("code") || "", grant_type: "authorization_code" }) });
    const tok = await tr.json().catch(() => ({}));
    if (!tr.ok || !tok.access_token) {
      const why = JSON.stringify(tok.errors || tok.message || tr.status);
      const msg = /limit|capacity|athlete/i.test(why) ? "Strava n'accepte pas encore de nouveaux comptes sur FOMO (validation en cours). Réessaie dans quelques jours." : "Strava a refusé la connexion, recommence.";
      await store.setJSON(k, { error: msg, at: Date.now() });
      return page("Pas encore", msg);
    }
    const sum = await summarize(tok.access_token);
    sum.name = (tok.athlete && tok.athlete.firstname) || "";
    await store.setJSON(k, { ...sum, at: Date.now() });
    return page("Strava est connecté ✓", "Reviens dans l'app FOMO : tes sorties y sont déjà.");
  }
  // 2. l'app vient chercher le résumé (une seule fois, valable 15 minutes)
  if (q.has("k")) {
    const k = q.get("k");
    if (!okKey(k)) return json({ error: "Code invalide" }, 400);
    const v = await store.get(k, { type: "json" });
    if (!v) return json({ pending: true }, 404);
    await store.delete(k);
    if (Date.now() - (v.at || 0) > 15 * 60e3) return json({ error: "Connexion expirée, recommence." }, 410);
    return v.error ? json({ error: v.error }, 400) : json(v);
  }
  // 3. l'identifiant public de l'app Strava FOMO (pour construire le lien d'autorisation)
  return json({ client_id: id || null });
};
