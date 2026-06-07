// Map our 3-letter country codes (FIFA/IOC style) to ISO-3166 alpha-2 codes
// for flagcdn.com flag images. Used as a fallback when a country has no
// API-provided flag_url. The UK home nations use flagcdn subdivision codes.
const CODE_TO_ISO2: Record<string, string> = {
  // UEFA
  ALB: "al", AND: "ad", ARM: "am", AUT: "at", AZE: "az", BLR: "by", BEL: "be",
  BIH: "ba", BUL: "bg", CRO: "hr", CYP: "cy", CZE: "cz", DEN: "dk", ENG: "gb-eng",
  EST: "ee", FRO: "fo", FIN: "fi", FRA: "fr", GEO: "ge", GER: "de", GIB: "gi",
  GRE: "gr", HUN: "hu", ISL: "is", ISR: "il", ITA: "it", KVX: "xk", KOS: "xk",
  LVA: "lv", LIE: "li", LTU: "lt", LUX: "lu", MLT: "mt", MDA: "md", MNE: "me",
  NED: "nl", MKD: "mk", NIR: "gb-nir", NOR: "no", POL: "pl", POR: "pt", IRL: "ie",
  ROU: "ro", RUS: "ru", SMR: "sm", SCO: "gb-sct", SRB: "rs", SVK: "sk", SVN: "si",
  ESP: "es", SWE: "se", SUI: "ch", TUR: "tr", UKR: "ua", WAL: "gb-wls",
  // CONMEBOL
  ARG: "ar", BOL: "bo", BRA: "br", CHI: "cl", COL: "co", ECU: "ec", PAR: "py",
  PER: "pe", URU: "uy", VEN: "ve",
  // CONCACAF
  CAN: "ca", CRC: "cr", CUB: "cu", CUW: "cw", SLV: "sv", GUA: "gt", HAI: "ht",
  HON: "hn", JAM: "jm", MEX: "mx", PAN: "pa", TRI: "tt", USA: "us", SUR: "sr",
  NCA: "ni", GLP: "gp", MTQ: "mq",
  // CAF
  ALG: "dz", ANG: "ao", BEN: "bj", BFA: "bf", CMR: "cm", CPV: "cv", CIV: "ci",
  COD: "cd", CGO: "cg", COG: "cg", EGY: "eg", GAB: "ga", GHA: "gh", GNB: "gw",
  GUI: "gn", KEN: "ke", MAD: "mg", MLI: "ml", MAR: "ma", MOZ: "mz", MTN: "mr",
  NGA: "ng", NIG: "ne", RSA: "za", SEN: "sn", SLE: "sl", TAN: "tz", TOG: "tg",
  TUN: "tn", UGA: "ug", ZAM: "zm", ZIM: "zw", EQG: "gq", GAM: "gm", LBR: "lr",
  LBY: "ly", SUD: "sd", ETH: "et", BDI: "bi", MWI: "mw", NAM: "na", BOT: "bw",
  // AFC
  AUS: "au", BHR: "bh", CHN: "cn", IND: "in", IRN: "ir", IRQ: "iq", JPN: "jp",
  JOR: "jo", KSA: "sa", KOR: "kr", PRK: "kp", KUW: "kw", LBN: "lb", MAS: "my",
  OMA: "om", PLE: "ps", QAT: "qa", SYR: "sy", THA: "th", UAE: "ae", UZB: "uz",
  VIE: "vn", TKM: "tm", KGZ: "kg", TJK: "tj", IDN: "id", PHI: "ph", HKG: "hk",
  // OFC
  NZL: "nz", FIJ: "fj", SOL: "sb", NCL: "nc", TAH: "pf", PNG: "pg", VAN: "vu",
};

/** ISO-3166 alpha-2 (flagcdn) code for one of our country codes, or null. */
export function iso2ForCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return CODE_TO_ISO2[code.toUpperCase()] ?? null;
}
