/** ISO 3166-1 alpha-2 codes for the countries a UK-based shop most often ships to. */
const COUNTRIES: [string, string][] = [
  ["GB", "United Kingdom"], ["IE", "Ireland"], ["US", "United States"], ["CA", "Canada"], ["AU", "Australia"],
  ["NZ", "New Zealand"], ["FR", "France"], ["DE", "Germany"], ["ES", "Spain"], ["IT", "Italy"], ["NL", "Netherlands"],
  ["BE", "Belgium"], ["LU", "Luxembourg"], ["PT", "Portugal"], ["AT", "Austria"], ["CH", "Switzerland"], ["DK", "Denmark"],
  ["SE", "Sweden"], ["NO", "Norway"], ["FI", "Finland"], ["IS", "Iceland"], ["PL", "Poland"], ["CZ", "Czechia"],
  ["SK", "Slovakia"], ["HU", "Hungary"], ["RO", "Romania"], ["BG", "Bulgaria"], ["GR", "Greece"], ["CY", "Cyprus"],
  ["MT", "Malta"], ["HR", "Croatia"], ["SI", "Slovenia"], ["EE", "Estonia"], ["LV", "Latvia"], ["LT", "Lithuania"],
  ["JE", "Jersey"], ["GG", "Guernsey"], ["IM", "Isle of Man"], ["GI", "Gibraltar"], ["JP", "Japan"], ["SG", "Singapore"],
  ["HK", "Hong Kong"], ["AE", "United Arab Emirates"], ["IL", "Israel"], ["ZA", "South Africa"], ["MX", "Mexico"], ["BR", "Brazil"],
];

const ALIASES: Record<string, string> = {
  uk: "GB", "great britain": "GB", england: "GB", scotland: "GB", wales: "GB", "northern ireland": "GB",
  usa: "US", "united states of america": "US", "czech republic": "CZ", holland: "NL", uae: "AE",
};

export function countryNameFromIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const hit = COUNTRIES.find(([c]) => c === iso.toUpperCase());
  return hit ? hit[1] : iso.toUpperCase();
}

/** Best-effort conversion of a stored country name/code to ISO alpha-2. */
export function isoFromCountry(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  const lower = v.toLowerCase();
  if (ALIASES[lower]) return ALIASES[lower];
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return COUNTRIES.find(([, name]) => name.toLowerCase() === lower)?.[0] ?? null;
}
