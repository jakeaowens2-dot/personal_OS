const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

function localCalendarSerial(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

export function getDayOffsetFromTimestamp(isoTimestamp: string) {
  const target = new Date(isoTimestamp);
  const today = new Date();
  return Math.round((localCalendarSerial(target) - localCalendarSerial(today)) / MILLIS_PER_DAY);
}

export function getDateForDayOffset(dayOffset: number, timeSource = new Date()) {
  const date = new Date();
  date.setHours(
    timeSource.getHours(),
    timeSource.getMinutes(),
    timeSource.getSeconds(),
    timeSource.getMilliseconds(),
  );
  date.setDate(date.getDate() + dayOffset);
  return date;
}

export function getTimestampForDayOffset(dayOffset: number, timeSource?: string) {
  return getDateForDayOffset(
    dayOffset,
    timeSource ? new Date(timeSource) : new Date(),
  ).toISOString();
}

export function getLocalMiddayTimestampForDayOffset(dayOffset: number) {
  const date = getDateForDayOffset(dayOffset);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

export function formatDayOffset(dayOffset: number) {
  if (dayOffset === 0) {
    return "Today";
  }

  if (dayOffset === -1) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(getDateForDayOffset(dayOffset));
}
