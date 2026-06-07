import { iso2ForCode } from "@/lib/flags";

/**
 * A small country flag image (flagcdn.com). Renders nothing if we don't
 * have an ISO-2 mapping for the code, so call sites can drop it in next to
 * any country name safely. Plain <img> so it works in both server and
 * client components; alt="" because the country name is always adjacent.
 */
export function Flag({
  code,
  className = "",
}: {
  code: string | null | undefined;
  className?: string;
}) {
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
