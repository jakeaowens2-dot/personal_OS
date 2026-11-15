import { dateKeyOffset, pacificClock, pacificWallTime, PRODUCTIVITY_TIME_ZONE, recordDateKey, shiftDateKey, wakingDateKey } from "./activity-day";

export function getDayOffsetFromTimestamp(isoTimestamp: string, activityDate?: string | null, now = new Date()) {
  return dateKeyOffset(recordDateKey(isoTimestamp, activityDate), wakingDateKey(now));
}

export function getDateForDayOffset(dayOffset: number, timeSource = new Date(), now = new Date()) {
  return pacificWallTime(shiftDateKey(wakingDateKey(now), dayOffset), ...pacificClock(timeSource));
}

export function getTimestampForDayOffset(dayOffset: number, timeSource?: string, activityDate?: string | null, now = new Date()) {
  // A duration/note/attribution-only edit must not move a historical timestamp.
  if (timeSource && getDayOffsetFromTimestamp(timeSource, activityDate, now) === dayOffset) return timeSource;
  const clock = pacificClock(timeSource ? new Date(timeSource) : now);
  const day = shiftDateKey(wakingDateKey(now), dayOffset + (clock[0] < 4 ? 1 : 0));
  return pacificWallTime(day, ...clock).toISOString();
}

export function getLocalMiddayTimestampForDayOffset(dayOffset: number) {
  return pacificWallTime(shiftDateKey(wakingDateKey(), dayOffset)).toISOString();
}

export function formatDayOffset(dayOffset: number) {
  if (dayOffset === 0) {
    return "Today";
  }

  if (dayOffset === -1) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: PRODUCTIVITY_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(getDateForDayOffset(dayOffset));
}
