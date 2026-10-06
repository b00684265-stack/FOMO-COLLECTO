// FOMO · connexion Strava pour tous les utilisateurs.
// Le « Client Secret » de l'application Strava FOMO reste ici, côté serveur Netlify (variables d'environnement),
// jamais dans l'app. On lit une seule fois les 200 dernières activités, on n'en garde qu'un résumé
// (types de sorties, distances), puis on rend l'accès à Strava : FOMO ne conserve aucun jeton.
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default async (req) => {
  const id = process.env.STRAVA_CLIENT_ID, secret = process.env.STRAVA_CLIENT_SECRET;
  if (req.method === "GET") return json({ client_id: id || null });
  if (req.method !== "POST") return json({ error: "Méthode non prise en charge" }, 405);
  if (!id || !secret) return json({ error: "Strava n'est pas encore configuré sur le serveur FOMO." }, 503);
  let code = "";
  try { code = String((await req.json()).code || ""); } catch (e) { /* corps invalide */ }
  if (!/^[\w-]{10,200}$/.test(code)) return json({ error: "Code de connexion invalide, recommence." }, 400);

  const tr = await fetch("https://www.strava.com/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, code, grant_type: "authorization_code" }) });
  const tok = await tr.json().catch(() => ({}));
  if (!tr.ok || !tok.access_token) {
    const why = JSON.stringify(tok.errors || tok.message || tr.status);
    return json({ error: /limit|capacity|athlete/i.test(why)
      ? "Strava n'accepte pas encore de nouveaux comptes sur FOMO (validation en cours). Réessaie dans quelques jours."
      : "Strava a refusé la connexion, recommence." }, 502);
  }
  const H = { Authorization: "Bearer " + tok.access_token };
  let acts = [];
  try {
    const r = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=200", { headers: H });
    if (r.ok) acts = await r.json();
  } catch (e) { /* on renvoie un résumé vide */ }
  // on rend l'accès : FOMO n'a plus aucun droit sur le compte Strava
  fetch("https://www.strava.com/oauth/deauthorize", { method: "POST", headers: H }).catch(() => {});

  const counts = {}, runs = [], trailDplus = [];
  for (const a of Array.isArray(acts) ? acts : []) {
    const t = a.sport_type || a.type || "Autre";
    counts[t] = (counts[t] || 0) + 1;
    if (/Run/.test(t)) {
      runs.push((a.distance || 0) / 1000);
      if (t === "TrailRun") trailDplus.push(a.total_elevation_gain || 0);
    }
  }
  const sorted = runs.slice().sort((a, b) => a - b);
  return json({
    n: Array.isArray(acts) ? acts.length : 0, counts,
    maxRunKm: runs.length ? Math.round(Math.max(...runs)) : 0,
    medRunKm: sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10 : 0,
    avgDplus: trailDplus.length ? Math.round(trailDplus.reduce((a, b) => a + b, 0) / trailDplus.length) : null,
    name: (tok.athlete && tok.athlete.firstname) || ""
  });
};
