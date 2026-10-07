/**
 * Deepgram Nova-3 keyterm lists.
 *
 * Nova-3 takes repeated `keyterm` query params (plain phrases, no `:weight`
 * suffix, never comma-joined). The budget is about 500 tokens per request;
 * these lists stay well under that. Show ids match `src/lib/analytics/networks.ts`.
 */

/** Hard cap so a long host string cannot blow the Deepgram token budget. */
export const MAX_KEYTERMS = 80;

/**
 * Names that recur across the network. Surnames are included on their own
 * because hosts often say them without the first name.
 */
const SHARED_KEYTERMS = [
  "Stolen Water Media",
  "Sunset Lounge",
  "Norm Hitzges",
  "Hitzges",
  "Mac Engel",
  "Engel Angle",
  "Rhyner",
  "Gruber",
  "Grubes",
  "Jesse Hawila",
  "Hawila",
  "Eric Nadel",
  "Nadel",
  "Pete Delkus",
  "Delkus",
  "Blaskovich",
  "Tyler Kern",
];

/** Players and clubs mangled on Sunset SC / ¡Al Maximo! roster episodes. */
const SOCCER_KEYTERMS = [
  "Mauricio Pochettino",
  "Pochettino",
  "Tanner Tessmann",
  "Tessmann",
  "Youri Tielemans",
  "Tielemans",
  "Jozy Altidore",
  "Altidore",
  "Joe Scally",
  "Scally",
  "Gio Reyna",
  "Christian Pulisic",
  "Pulisic",
  "Tim Weah",
  "Jérémy Doku",
  "Arda Güler",
  "Nico Paz",
  "USMNT",
  "FC Dallas",
  "Aston Villa",
];

/**
 * Extra terms layered on top of SHARED_KEYTERMS.
 * Soccer vocabulary stays on the soccer shows.
 */
const SHOW_KEYTERMS: Record<number, readonly string[]> = {
  // Your Dark Companion
  21: ["Your Dark Companion", "Grant Halliburton", "Sammy Rae", "Chuck Prophet"],
  // ¡Al Maximo! — Spanish soccer show
  22: ["Al Maximo", ...SOCCER_KEYTERMS],
  // Beer 30 Sports O'Clock — general sports, not a soccer feed
  23: ["Beer 30"],
  // The Clubhouse Podcast
  24: ["The Clubhouse", "Clubhouse"],
  // Engel Angle
  25: ["Engel Angle", "Mac Engel"],
  // Just Wondering with Norm Hitzges
  26: ["Just Wondering", "Tony Casillas", "Jesse Hawila", "Pete Delkus"],
  // Signal 51 Chronicles — true crime, not soccer
  27: ["Signal 51", "Kennedale", "John Hummel", "Cullen Davis"],
  // Sunset Soccer Club
  28: ["Sunset Soccer Club", "Sunset SC", "Tyler Kern", ...SOCCER_KEYTERMS],
  // Three Wide at Scout, live at The Statler
  4218: ["Three Wide", "The Statler"],
};

/** Split a ShowMetadata.hosts comma list into keyterm phrases. */
export function keytermsFromHosts(hosts: string | null | undefined): string[] {
  if (!hosts) return [];
  return hosts
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length <= 100 && !part.includes(":"));
}

function dedupe(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    const cleaned = term.trim();
    if (!cleaned || cleaned.length > 100 || cleaned.includes(":")) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

/**
 * Keyterms for one show. Show-specific phrases come first, then host names
 * from ShowMetadata, then the shared network list. Unknown shows get the
 * shared list only.
 */
export function keytermsForShow(
  wpShowId?: number,
  extra: readonly string[] = []
): string[] {
  const showSpecific =
    wpShowId != null && SHOW_KEYTERMS[wpShowId]
      ? SHOW_KEYTERMS[wpShowId]
      : [];
  return dedupe([...showSpecific, ...extra, ...SHARED_KEYTERMS]).slice(
    0,
    MAX_KEYTERMS
  );
}

export interface DeepgramListenQueryOptions {
  /** BCP-47 code. When set, language is forced and detect_language is omitted. */
  forceLanguage?: string;
  keyterms?: readonly string[];
}

/**
 * Query string for `POST /v1/listen`. Keyterms are repeated `keyterm` params
 * so Nova-3 boosts each phrase. A single comma-joined value is silently
 * treated as one literal and boosts nothing.
 */
export function buildDeepgramListenQuery(
  options: DeepgramListenQueryOptions = {}
): URLSearchParams {
  const params = new URLSearchParams({
    model: "nova-3",
    smart_format: "true",
    diarize: "true",
    paragraphs: "true",
    utterances: "true",
  });
  if (options.forceLanguage) {
    params.set("language", options.forceLanguage);
  } else {
    params.set("detect_language", "true");
  }
  for (const term of options.keyterms ?? []) {
    params.append("keyterm", term);
  }
  return params;
}
