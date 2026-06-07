import { iso2ForCode } from "@/lib/flags";

/**
 * A small country flag. Prefers the API-provided `url` (every synced country
 * has one) and falls back to a flagcdn image derived from the country code.
 * Renders nothing if neither is available, so it's safe to drop in next to
 * any country name. Plain <img> so it works in server and client components;
 * alt="" because the country name is always adjacent.
 */
export function Flag({
  code,
  url,
  className = "",
}: {
  code?: string | null;
  url?: string | null;
  className?: string;
}) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        width={20}
        height={15}
        className={`inline-block h-[15px] w-auto shrink-0 object-contain ${className}`}
      />
    );
  }
  const iso2 = iso2ForCode(code);
  if (!iso2) return null;
  return (
    <img
      src={`https://flagcdn.com/20x15/${iso2}.png`}
      srcSet={`https://flagcdn.com/40x30/${iso2}.png 2x`}
      width={20}
      height={15}
      alt=""
      loading="lazy"
      className={`inline-block shrink-0 rounded-[2px] ${className}`}
    />
  );
}
