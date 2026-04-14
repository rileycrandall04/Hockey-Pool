/**
 * Small red-cross indicator shown next to a player's name when they
 * have an injury_status from the NHL API. Hover/long-press shows the
 * description if present.
 */
export function InjuryBadge({
  status,
  description,
}: {
  status: string | null | undefined;
  description?: string | null;
}) {
  if (!status) return null;
  const tooltip = description ? `${status} — ${description}` : status;
  return (
    <span
      title={tooltip}
      aria-label={`Injured: ${tooltip}`}
      className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-sm bg-white text-red-600"
    >
      <svg
        viewBox="0 0 24 24"
        width="10"
        height="10"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z" />
      </svg>
    </span>
  );
}
