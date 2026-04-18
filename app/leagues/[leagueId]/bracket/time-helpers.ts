/** Convert a UTC ISO string to a `YYYY-MM-DDTHH:mm` value in MDT. */
export function utcToMdtLocal(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Convert a `YYYY-MM-DDTHH:mm` local MDT value to a UTC ISO string. */
export function mdtToUtcIso(local: string): string {
  return new Date(`${local}:00-06:00`).toISOString();
}
