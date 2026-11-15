// New records persist their waking-day label. Legacy records deliberately fall
// back to their original calendar-day interpretation, never the new cutoff.
export const PRODUCTIVITY_TIME_ZONE = "America/Los_Angeles";
export const DAY_START_HOUR = 4;

function parts(date: Date) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: PRODUCTIVITY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(values.map(({ type, value }) => [type, value]));
}

export function calendarDateKey(value: string | Date) {
  const p = parts(new Date(value));
  return `${p.year}-${p.month}-${p.day}`;
}

export function shiftDateKey(key: string, days: number) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function wakingDateKey(value: string | Date = new Date()) {
  const date = new Date(value);
  const key = calendarDateKey(date);
  return Number(parts(date).hour) < DAY_START_HOUR ? shiftDateKey(key, -1) : key;
}

export function recordDateKey(timestamp: string, activityDate?: string | null) {
  return activityDate ?? calendarDateKey(timestamp);
}

export function dateKeyOffset(key: string, today = wakingDateKey()) {
  return Math.round((Date.parse(`${key}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}

export function pacificWallTime(key: string, hour = 12, minute = 0, second = 0, millis = 0) {
  const [year, month, day] = key.split("-").map(Number);
  const wanted = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  let candidate = wanted;
  for (let attempt = 0; attempt < 3; attempt++) {
    const p = parts(new Date(candidate));
    const shown = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second), millis);
    const correction = wanted - shown;
    if (!correction) break;
    candidate += correction;
  }
  return new Date(candidate);
}

export function pacificClock(date: Date) {
  const p = parts(date);
  return [Number(p.hour), Number(p.minute), Number(p.second), date.getMilliseconds()] as const;
}
