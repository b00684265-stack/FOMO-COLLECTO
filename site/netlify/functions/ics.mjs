// FOMO · fichier agenda (.ics) pour ajouter un ou plusieurs événements au calendrier du téléphone
// (Calendrier Apple, Google Agenda, Outlook, Samsung…). Rien n'est stocké : tout est dans l'adresse.
// /.netlify/functions/ics?j=<base64url de [{t,s,e,l,u,d}]>
const esc = s => String(s || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1").slice(0, 900);
const stamp = d => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// les lignes de plus de 75 octets sont repliées, comme le veut la norme
const fold = l => { const out = []; let s = l; while (Buffer.byteLength(s) > 74) { let n = 74; while (Buffer.byteLength(s.slice(0, n)) > 74) n--; out.push(s.slice(0, n)); s = " " + s.slice(n); } out.push(s); return out.join("\r\n"); };

export default async (req) => {
  const p = new URL(req.url).searchParams;
  let list = [];
  try { list = JSON.parse(Buffer.from(String(p.get("j") || ""), "base64url").toString("utf8")); } catch { list = []; }
  if (!Array.isArray(list)) list = [list];
  list = list.filter(x => x && x.t && x.s && !isNaN(new Date(x.s))).slice(0, 40);
  if (!list.length) return new Response("Événement introuvable", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const now = stamp(Date.now()), L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FOMO//Agenda//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:FOMO"];
  for (const x of list) {
    const s = new Date(x.s), e = x.e && new Date(x.e) > s ? new Date(x.e) : new Date(+s + 2 * 36e5);
    const uid = (String(x.i || x.t).replace(/[^A-Za-z0-9-]+/g, "-").slice(0, 60) || "evt") + "-" + stamp(s) + "@fomo";
    L.push("BEGIN:VEVENT", "UID:" + uid, "DTSTAMP:" + now, "DTSTART:" + stamp(s), "DTEND:" + stamp(e), "SUMMARY:" + esc(x.t));
    if (x.l) L.push("LOCATION:" + esc(x.l));
    if (x.u && /^https?:\/\//.test(x.u)) L.push("URL:" + String(x.u).slice(0, 500));
    L.push("DESCRIPTION:" + esc([x.d, x.u ? "Billets : " + x.u : "", "Ajouté depuis FOMO"].filter(Boolean).join("\n")));
    // rappel 3 heures avant
    L.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + esc(x.t), "TRIGGER:-PT3H", "END:VALARM", "END:VEVENT");
  }
  L.push("END:VCALENDAR");
  const name = list.length === 1 ? String(list[0].t).replace(/[^A-Za-z0-9À-ÿ -]+/g, "").trim().slice(0, 40) || "fomo" : "fomo-agenda";
  return new Response(L.map(fold).join("\r\n") + "\r\n", { headers: {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `inline; filename="${name.replace(/[^\x20-\x7e]/g, "_")}.ics"; filename*=UTF-8''${encodeURIComponent(name)}.ics`,
    "Cache-Control": "no-store" } });
};
