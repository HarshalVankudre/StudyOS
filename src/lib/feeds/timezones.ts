/**
 * Time zone resolution for imported calendars.
 *
 * Calendar feeds name zones three ways: IANA names ("America/New_York", what
 * Canvas, Moodle and Google use), Windows names ("Eastern Standard Time",
 * Outlook / Exchange / some Blackboard exports) and decorated forms
 * ("/mozilla.org/20070129_1/Europe/Berlin", "(UTC-05:00) Eastern Time").
 * Conversion runs on the runtime's own Intl time zone data, which every
 * browser and Node ship and keep current, so no zone database is bundled.
 */

const WINDOWS_ZONES: Record<string, string> = {
  "dateline standard time": "Etc/GMT+12",
  "hawaiian standard time": "Pacific/Honolulu",
  "alaskan standard time": "America/Anchorage",
  "pacific standard time": "America/Los_Angeles",
  "pacific standard time (mexico)": "America/Tijuana",
  "us mountain standard time": "America/Phoenix",
  "mountain standard time": "America/Denver",
  "mountain standard time (mexico)": "America/Mazatlan",
  "central standard time": "America/Chicago",
  "central standard time (mexico)": "America/Mexico_City",
  "canada central standard time": "America/Regina",
  "central america standard time": "America/Guatemala",
  "eastern standard time": "America/New_York",
  "us eastern standard time": "America/Indianapolis",
  "sa pacific standard time": "America/Bogota",
  "atlantic standard time": "America/Halifax",
  "venezuela standard time": "America/Caracas",
  "pacific sa standard time": "America/Santiago",
  "newfoundland standard time": "America/St_Johns",
  "e. south america standard time": "America/Sao_Paulo",
  "argentina standard time": "America/Buenos_Aires",
  "greenwich standard time": "Atlantic/Reykjavik",
  "gmt standard time": "Europe/London",
  "utc": "UTC",
  "coordinated universal time": "UTC",
  "morocco standard time": "Africa/Casablanca",
  "w. europe standard time": "Europe/Berlin",
  "central europe standard time": "Europe/Budapest",
  "romance standard time": "Europe/Paris",
  "central european standard time": "Europe/Warsaw",
  "w. central africa standard time": "Africa/Lagos",
  "e. europe standard time": "Europe/Chisinau",
  "gtb standard time": "Europe/Bucharest",
  "fle standard time": "Europe/Kiev",
  "turkey standard time": "Europe/Istanbul",
  "israel standard time": "Asia/Jerusalem",
  "egypt standard time": "Africa/Cairo",
  "south africa standard time": "Africa/Johannesburg",
  "russian standard time": "Europe/Moscow",
  "arab standard time": "Asia/Riyadh",
  "arabic standard time": "Asia/Baghdad",
  "e. africa standard time": "Africa/Nairobi",
  "iran standard time": "Asia/Tehran",
  "arabian standard time": "Asia/Dubai",
  "pakistan standard time": "Asia/Karachi",
  "india standard time": "Asia/Kolkata",
  "sri lanka standard time": "Asia/Colombo",
  "nepal standard time": "Asia/Katmandu",
  "bangladesh standard time": "Asia/Dhaka",
  "myanmar standard time": "Asia/Rangoon",
  "se asia standard time": "Asia/Bangkok",
  "china standard time": "Asia/Shanghai",
  "singapore standard time": "Asia/Singapore",
  "taipei standard time": "Asia/Taipei",
  "w. australia standard time": "Australia/Perth",
  "tokyo standard time": "Asia/Tokyo",
  "korea standard time": "Asia/Seoul",
  "cen. australia standard time": "Australia/Adelaide",
  "aus central standard time": "Australia/Darwin",
  "e. australia standard time": "Australia/Brisbane",
  "aus eastern standard time": "Australia/Sydney",
  "tasmania standard time": "Australia/Hobart",
  "new zealand standard time": "Pacific/Auckland",
};

/**
 * A small least-recently-used cache. The zone caches below are shared by
 * every calendar this process reads, so they must never stop caching once
 * full (a hostile feed could fill them with junk names and leave every later,
 * normal feed paying for a fresh Intl lookup per date): the oldest entry is
 * evicted instead, and a name in use stays cached.
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  constructor(private readonly capacity: number) {}
  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }
  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }
  get size(): number {
    return this.map.size;
  }
}

const validZones = new LruCache<string, boolean>(2_000);

/** True when the runtime knows `zone` as an IANA time zone. */
export function isKnownZone(zone: string): boolean {
  if (!zone || zone.length > 64) return false;
  const cached = validZones.get(zone);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    ok = true;
  } catch {
    ok = false;
  }
  validZones.set(zone, ok);
  return ok;
}

/** A resolved zone: an IANA name, or a fixed offset in minutes east of UTC. */
export type ZoneRef = { zone: string } | { offsetMinutes: number };

/** "+0530" / "-05:00" / "-0500" → minutes east of UTC, or null. */
export function parseOffset(text: string): number | null {
  const m = /^([+-])(\d{2}):?(\d{2})(?::?(\d{2}))?$/.exec(text.trim());
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  if (minutes > 18 * 60) return null;
  return m[1] === "-" ? -minutes : minutes;
}

/**
 * Resolve a TZID parameter to a zone, or null when it cannot be told.
 * `hints` carries what the file itself said about that TZID (its VTIMEZONE's
 * X-LIC-LOCATION, or its standard-time offset as a last resort).
 */
export function resolveZone(
  tzid: string,
  hints?: { location?: string; standardOffset?: number },
): ZoneRef | null {
  const raw = tzid.trim().replace(/^"|"$/g, "");
  if (!raw) return null;
  if (isKnownZone(raw)) return { zone: raw };
  // "/mozilla.org/20070129_1/Europe/Berlin", "/citadel.org/.../America/Chicago"
  const parts = raw.split("/").filter(Boolean);
  for (let take = Math.min(3, parts.length); take >= 2; take -= 1) {
    const tail = parts.slice(-take).join("/");
    if (isKnownZone(tail)) return { zone: tail };
  }
  const last = parts.at(-1) ?? "";
  if (/^(UTC|GMT|Z)$/i.test(last)) return { zone: "UTC" };
  const windows = WINDOWS_ZONES[raw.toLowerCase()];
  if (windows && isKnownZone(windows)) return { zone: windows };
  if (hints?.location && isKnownZone(hints.location)) return { zone: hints.location };
  // "(UTC-05:00) Eastern Time (US & Canada)" / "GMT+0100"
  const decorated = /(?:UTC|GMT)\s*([+-]\d{1,2}(?::?\d{2})?)/i.exec(raw);
  if (decorated) {
    let text = decorated[1];
    if (/^[+-]\d$/.test(text)) text = `${text[0]}0${text[1]}00`;
    else if (/^[+-]\d{2}$/.test(text)) text = `${text}00`;
    const offset = parseOffset(text);
    if (offset !== null) return { offsetMinutes: offset };
  }
  if (hints?.standardOffset !== undefined) return { offsetMinutes: hints.standardOffset };
  return null;
}

const formatters = new LruCache<string, Intl.DateTimeFormat>(600);

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, f);
  }
  return f;
}

/** Offset of `zone` from UTC at instant `utcMs`, in milliseconds. */
export function zoneOffsetMs(utcMs: number, zone: string): number {
  const parts = formatterFor(zone).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour = get("hour") % 24; // some engines print midnight as 24
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  const truncated = Math.floor(utcMs / 1000) * 1000;
  return asUtc - truncated;
}

export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * The UTC instant of a wall-clock time in a zone. Around a daylight-saving
 * change a wall time can occur twice (the earlier is used) or not at all (it
 * is moved forward by the gap), like every calendar app does.
 */
export function wallTimeToUtc(wall: WallTime, ref: ZoneRef): number {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  if ("offsetMinutes" in ref) return naive - ref.offsetMinutes * 60_000;
  const first = zoneOffsetMs(naive, ref.zone);
  let utc = naive - first;
  const second = zoneOffsetMs(utc, ref.zone);
  if (second !== first) {
    const retry = naive - second;
    // Keep whichever candidate actually shows this wall time in the zone.
    utc = zoneOffsetMs(retry, ref.zone) === second ? retry : utc;
  }
  return utc;
}
