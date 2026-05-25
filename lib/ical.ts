import ical, { type VEvent } from "node-ical";

/**
 * Generic Localist-style iCal puller. Returns parsed VEVENT entries that fall
 * within (now, now + horizonDays). Recurring events are expanded; cancelled
 * EXDATE instances are excluded.
 */
export async function fetchICalEvents(
  url: string,
  opts: { horizonDays?: number } = {},
): Promise<VEvent[]> {
  const horizonDays = opts.horizonDays ?? 365;
  const resp = await fetch(url, {
    headers: { "User-Agent": "sf-events-aggregator/0.1 (+contact via repo)" },
    redirect: "follow",
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} fetching ${url}`);
  }
  const body = await resp.text();
  const parsed = ical.sync.parseICS(body);

  const now = new Date();
  const horizon = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);

  const out: VEvent[] = [];
  for (const key of Object.keys(parsed)) {
    const entry = parsed[key];
    if (!entry || entry.type !== "VEVENT") continue;
    const ev = entry as VEvent;

    // Recurring event — expand into instances within window
    if (ev.rrule) {
      const occurrences = ev.rrule.between(now, horizon, true);
      const exDates = new Set(
        Object.keys(ev.exdate ?? {}).map((k) =>
          new Date(k).toISOString().slice(0, 10),
        ),
      );
      for (const occ of occurrences) {
        if (exDates.has(occ.toISOString().slice(0, 10))) continue;
        const duration = ev.end
          ? ev.end.getTime() - ev.start.getTime()
          : null;
        out.push({
          ...ev,
          start: occ,
          end: duration != null ? new Date(occ.getTime() + duration) : ev.end,
        });
      }
      continue;
    }

    if (!ev.start) continue;
    if (ev.start < now || ev.start > horizon) continue;
    out.push(ev);
  }
  return out;
}

/**
 * Heuristic split of iCal LOCATION into venue name + address.
 * "Lecture Hall A, 513 Parnassus Ave, San Francisco, CA 94143" →
 *   name: "Lecture Hall A", address: "513 Parnassus Ave, San Francisco, CA 94143"
 * "Online" → name: "Online", address: null
 */
export function splitLocation(loc: string | undefined): {
  name: string;
  address: string | null;
} {
  if (!loc || !loc.trim()) return { name: "Unknown venue", address: null };
  const trimmed = loc.trim();
  const commaIdx = trimmed.indexOf(",");
  if (commaIdx === -1) return { name: trimmed, address: null };
  return {
    name: trimmed.slice(0, commaIdx).trim(),
    address: trimmed.slice(commaIdx + 1).trim(),
  };
}
