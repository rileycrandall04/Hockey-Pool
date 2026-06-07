// FIFA men's world ranking reference, used to seed `countries.fifa_rank`
// (which drives the group-stage upset bonus). API-Football does NOT expose
// FIFA rankings, so we keep this lookup and apply it during the sync.
//
// Values approximate the final pre-tournament ranking (April 2026). They are
// EDITABLE: a commissioner/admin can correct any country's rank in the
// admin country editor, and manual edits are not overwritten by the sync.
//
// Keyed by normalized country name (lowercase, accents/punctuation stripped),
// with aliases for the common API spellings.
const RANKING: string[] = [
  "France", "Spain", "Argentina", "England", "Portugal", "Brazil",
  "Netherlands", "Belgium", "Croatia", "Germany", "Italy", "Morocco",
  "Colombia", "United States", "Mexico", "Uruguay", "Switzerland", "Japan",
  "Senegal", "Denmark", "Iran", "South Korea", "Australia", "Ecuador",
  "Austria", "Ukraine", "Turkey", "Sweden", "Wales", "Serbia", "Poland",
  "Egypt", "Hungary", "Norway", "Nigeria", "Czech Republic", "Greece",
  "Scotland", "Algeria", "Panama", "Peru", "Ivory Coast", "Paraguay",
  "Tunisia", "Canada", "Romania", "Costa Rica", "Cameroon", "Slovakia",
  "Slovenia", "Mali", "Saudi Arabia", "Venezuela", "Ghana", "Qatar",
  "Iraq", "Burkina Faso", "South Africa", "Uzbekistan", "Jordan",
  "Cape Verde", "Jamaica", "DR Congo", "Bosnia and Herzegovina", "Oman",
  "Honduras", "Curacao", "Haiti", "New Zealand", "Bolivia",
];

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

const ALIASES: Record<string, string> = {
  usa: "unitedstates",
  unitedstatesofamerica: "unitedstates",
  korearepublic: "southkorea",
  republicofkorea: "southkorea",
  cotedivoire: "ivorycoast",
  iranislamicrepublic: "iran",
  czechia: "czechrepublic",
  turkiye: "turkey",
  caboverde: "capeverde",
  drcongo: "drcongo",
  democraticrepublicofthecongo: "drcongo",
};

const RANK_BY_NAME = new Map<string, number>();
RANKING.forEach((name, i) => RANK_BY_NAME.set(norm(name), i + 1));

/** Best-effort FIFA rank for a country name, or null if unknown. */
export function fifaRankForName(name: string): number | null {
  const key = norm(name);
  const aliased = ALIASES[key] ?? key;
  return RANK_BY_NAME.get(aliased) ?? RANK_BY_NAME.get(key) ?? null;
}
