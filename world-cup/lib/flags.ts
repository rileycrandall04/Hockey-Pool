// Map our 3-letter country codes (FIFA/IOC style) to the ISO-3166 alpha-2
// codes that flagcdn.com uses for flag images. The UK home nations use
// flagcdn's special subdivision codes.
//
// Keyed by the `code` column seeded in 0002_seed_countries.sql. Extend this
// if the API sync introduces teams with codes not listed here.
const CODE_TO_ISO2: Record<string, string> = {
  ARG: "ar", FRA: "fr", ESP: "es", ENG: "gb-eng", BRA: "br", POR: "pt",
  NED: "nl", BEL: "be", ITA: "it", GER: "de", CRO: "hr", MAR: "ma",
  COL: "co", URU: "uy", USA: "us", MEX: "mx", SUI: "ch", SEN: "sn",
  JPN: "jp", DEN: "dk", IRN: "ir", KOR: "kr", AUS: "au", ECU: "ec",
  AUT: "at", UKR: "ua", CAN: "ca", NGA: "ng", EGY: "eg", POL: "pl",
  SRB: "rs", WAL: "gb-wls", PER: "pe", TUN: "tn", CRC: "cr", GHA: "gh",
  CMR: "cm", ALG: "dz", NOR: "no", PAR: "py", CIV: "ci", KSA: "sa",
  QAT: "qa", PAN: "pa", NZL: "nz", JOR: "jo", UZB: "uz", CPV: "cv",
  // A few extra common qualifiers, in case the API sync adds them:
  SCO: "gb-sct", NIR: "gb-nir", JAM: "jm", HON: "hn", SVN: "si",
  SVK: "sk", CZE: "cz", GRE: "gr", HUN: "hu", ROU: "ro", TUR: "tr",
  RSA: "za", MLI: "ml", BFA: "bf", DRC: "cd", ANG: "ao", UAE: "ae",
  IRQ: "iq", BOL: "bo", VEN: "ve", CHI: "cl", CRC2: "cr",
};

/** ISO-3166 alpha-2 (flagcdn) code for one of our country codes, or null. */
export function iso2ForCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return CODE_TO_ISO2[code.toUpperCase()] ?? null;
}
