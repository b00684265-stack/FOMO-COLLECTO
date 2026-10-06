// FOMO · soirées Shotgun de ta ville (appelé par l'app) : /.netlify/functions/shotgun?city=Paris
import { refreshCity } from "../lib/shotgun.mjs";
export default async (req) => {
  const city = (new URL(req.url).searchParams.get("city") || "Paris").trim().slice(0, 60);
  let out;
  try { out = await refreshCity(city, 8000); } catch (e) { out = { city, events: [], err: String(e.message || e) }; }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json", "Cache-Control": out.pending ? "no-store" : "public, max-age=900" } });
};
