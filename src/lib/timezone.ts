const DEFAULT_TIMEZONE = "America/Chicago";

/**
 * Append the correct UTC offset for a given IANA timezone to a naive datetime string.
 *
 * Input:  "2026-04-03T09:00:00", "America/Chicago"
 * Output: "2026-04-03T09:00:00-05:00"
 *
 * WordPress REST API accepts ISO 8601 dates with offset, so this ensures
 * scheduled posts land at the intended local time regardless of server timezone.
 */
export function toISOWithTimezone(
  naiveDatetime: string,
  timezone?: string | null
): string {
  const tz = timezone || DEFAULT_TIMEZONE;

  // Parse as UTC to get a Date object at approximately the right moment
  // (only used to determine which DST rule applies)
  const utcDate = new Date(
    naiveDatetime.endsWith("Z") ? naiveDatetime : `${naiveDatetime}Z`
  );

  if (isNaN(utcDate.getTime())) {
    // If parsing fails, return the original string unchanged
    return naiveDatetime;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "longOffset",
  });

  const parts = formatter.formatToParts(utcDate);
  const tzPart = parts.find((p) => p.type === "timeZoneName");
  // "GMT-05:00" or "GMT+05:30" or "GMT" (for UTC)
  const match = tzPart?.value?.match(/GMT([+-]\d{2}:\d{2})/);
  const offset = match ? match[1] : "+00:00";

  // Strip any existing seconds-less format, ensure seconds are present
  const base = naiveDatetime.replace(/Z$/, "");
  const withSeconds =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(base) ? `${base}:00` : base;

  return `${withSeconds}${offset}`;
}
