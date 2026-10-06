// FOMO · tâche planifiée : toutes les 2 h, met à jour les soirées Shotgun des villes demandées par l'app (Paris toujours)
import { getStore } from "@netlify/blobs";
import { refreshCity } from "../lib/shotgun.mjs";
export default async () => {
  const R = (await getStore("shotgun").get("cities", { type: "json" }).catch(() => null)) || {};
  const names = [...new Set(["Paris", ...Object.values(R).sort((a, b) => b.at - a.at).map(x => x.name)])].slice(0, 4);
  const t0 = Date.now();
  for (const n of names) { if (Date.now() - t0 > 20000) break; await refreshCity(n, Math.min(9000, 27000 - (Date.now() - t0))).catch(() => {}); }
};
export const config = { schedule: "7 */2 * * *" };
