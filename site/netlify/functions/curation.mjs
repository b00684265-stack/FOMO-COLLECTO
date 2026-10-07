// FOMO · corrections du fondateur, appliquées à tous les utilisateurs (ex. « ce concert est complet »).
// GET : la liste publique. POST : réservé au fondateur, avec la clé FOMO_ADMIN_KEY (variable d'environnement Netlify).
import { getStore } from "@netlify/blobs";
const H = { "Content-Type": "application/json" };
export default async (req) => {
  const store = getStore("curation");
  const cur = (await store.get("list", { type: "json" }).catch(() => null)) || { soldout: {}, hidden: {} };
  if (req.method === "GET") return new Response(JSON.stringify(cur), { headers: { ...H, "Cache-Control": "public, max-age=120" } });
  if (req.method !== "POST") return new Response("{}", { status: 405, headers: H });
  const key = process.env.FOMO_ADMIN_KEY || "";
  if (!key) return new Response(JSON.stringify({ error: "FOMO_ADMIN_KEY n'est pas configurée sur Netlify." }), { status: 500, headers: H });
  if ((req.headers.get("x-fomo-key") || "") !== key) return new Response(JSON.stringify({ error: "Clé fondateur incorrecte." }), { status: 403, headers: H });
  let b = {}; try { b = await req.json(); } catch { /* vide */ }
  const k = String(b.key || "").slice(0, 80), list = b.list === "hidden" ? "hidden" : "soldout";
  if (!k) return new Response(JSON.stringify({ error: "clé d'événement manquante" }), { status: 400, headers: H });
  cur[list] = cur[list] || {};
  if (b.off) delete cur[list][k]; else cur[list][k] = { t: String(b.t || "").slice(0, 120), at: new Date().toISOString() };
  await store.setJSON("list", cur);
  return new Response(JSON.stringify(cur), { headers: H });
};
