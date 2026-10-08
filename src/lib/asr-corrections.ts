/**
 * Reviewed find/replace dictionary for Deepgram Nova-3 errors seen on
 * stolenwatermedia.com transcripts (Oct 6, 2026 transcript-impact analysis).
 *
 * Applied to new transcripts before they are saved or pushed to WordPress
 * and Transistor. This does not rewrite the existing catalog — that is a
 * separate WordPress backfill over the ~13.7M words already published.
 *
 * Rules are literal phrases, case-insensitive, on word boundaries, applied
 * longest-first so a shorter rule cannot chop a longer one. Replacements
 * use the canonical spelling regardless of the ASR's capitalization.
 * Running the dictionary twice is a no-op.
 *
 * A rule with `showIds` applies only on those WordPress show ids. Rules
 * without `showIds` apply on every show, including when the show is unknown.
 */

export interface AsrRule {
  /** Literal phrase to find. Apostrophes also match the curly ’ character. */
  find: string;
  /** Canonical spelling written into the transcript. */
  replace: string;
  /** Why this rule exists. Keep this when adding a row. */
  note: string;
  /**
   * WordPress show ids this rule may rewrite. Omit to apply on every show.
   * A listed rule is skipped when the show id is missing.
   */
  showIds?: readonly number[];
}

export const ASR_RULES: readonly AsrRule[] = [
  {
    find: "Colin Davis",
    replace: "Cullen Davis",
    showIds: [27],
    note: "Signal 51 Case 13: Deepgram rendered T. Cullen Davis as Colin Davis. Show 27 only — a real Colin Davis can appear on the sports shows.",
  },
  {
    find: "Yuri Telemann's",
    replace: "Youri Tielemans'",
    note: "Sunset SC Ep.12: 'Yuri Telemann's plays for Ashton Villa' is Youri Tielemans.",
  },
  {
    find: "Yuri Telemann",
    replace: "Youri Tielemans",
    note: "Same episode. GSC ranked the typo 'yuri telemann' (60 impressions, 0 clicks).",
  },
  {
    find: "Norm Hitzkiss",
    replace: "Norm Hitzges",
    note: "Sunset Ep.12 rendered the host as Norm Hitzkiss.",
  },
  {
    find: "Hitzkiss",
    replace: "Hitzges",
    note: "Surname-only form of the same host-name error.",
  },
  {
    find: "the angle angle",
    replace: "The Engel Angle",
    note: "Sunset Ep.12: 'the angle angle' is The Engel Angle. Keep the article and the show's title case.",
  },
  {
    find: "Jesse Hoelho",
    replace: "Jesse Hawila",
    note: "Ep 256 calls the guest Jesse Hoelho.",
  },
  {
    find: "Jesse Hoila",
    replace: "Jesse Hawila",
    note: "Ep 256 also spells the same guest Jesse Hoila.",
  },
  {
    find: "Hoelho",
    replace: "Hawila",
    note: "Surname-only form of the Jesse Hawila error.",
  },
  {
    find: "Hoila",
    replace: "Hawila",
    note: "Surname-only form of the Jesse Hawila error.",
  },
  {
    find: "Tanner Testman",
    replace: "Tanner Tessmann",
    note: "GSC click on 'tanner testman' for the USMNT roster episode (Tanner Tessmann).",
  },
  {
    find: "Testman",
    replace: "Tessmann",
    note: "Surname-only form of the Tanner Tessmann error.",
  },
  {
    find: "Josie Altadore",
    replace: "Jozy Altidore",
    note: "Sunset SC Ep.18: 'josie altadore' is Jozy Altidore.",
  },
  {
    find: "Josie Altidore",
    replace: "Jozy Altidore",
    note: "First name wrong, surname already right.",
  },
  {
    find: "Altadore",
    replace: "Altidore",
    note: "Surname-only form of the Jozy Altidore error.",
  },
  {
    find: "Joe Scali",
    replace: "Joe Scally",
    note: "USMNT roster episode: 'Joe Scali' / query 'joe scali' is Joe Scally.",
  },
  {
    find: "Scali",
    replace: "Scally",
    note: "Surname-only form. Distinct from Scalia (word boundary).",
  },
  {
    find: "Pachitino",
    replace: "Pochettino",
    note: "Sunset Ep.12. GSC query 'pachitino'.",
  },
  {
    find: "Delkes",
    replace: "Delkus",
    note: "Ep 256 spells Pete Delkus as Delkes.",
  },
  {
    find: "Delkis",
    replace: "Delkus",
    note: "Ep 256 also spells Pete Delkus as Delkis.",
  },
  {
    find: "Georena",
    replace: "Gio Reyna",
    note: "Sunset Ep.12 roster talk. Analysis glosses Georena as Gio Reyna.",
  },
  {
    find: "Policic",
    replace: "Pulisic",
    note: "Sunset Ep.12, listed with the other USMNT name errors. Christian Pulisic.",
  },
  {
    find: "Tim Wea",
    replace: "Tim Weah",
    note: "Sunset Ep.12. Does not match the already-correct 'Tim Weah'.",
  },
  {
    find: "Ashton Villa",
    replace: "Aston Villa",
    note: "Sunset Ep.12 club name.",
  },
  {
    find: "Gemma Arderton",
    replace: "Gemma Arterton",
    note: "iTunes Exclusive movie episodes. Query 'gemma arderton'.",
  },
  {
    find: "Arderton",
    replace: "Arterton",
    note: "Surname-only form of the Gemma Arterton error.",
  },
  {
    find: "Joel Edderton",
    replace: "Joel Edgerton",
    note: "Same movie episodes. Query 'joel edderton'.",
  },
  {
    find: "Edderton",
    replace: "Edgerton",
    note: "Surname-only form of the Joel Edgerton error.",
  },
  {
    find: "Debbie Mezar",
    replace: "Debi Mazar",
    note: "Same movie episodes. Query 'debbie mezar'. Full phrase only.",
  },
  {
    find: "Peter Landisman",
    replace: "Peter Landesman",
    note: "Same movie episodes. Query 'peter landisman'.",
  },
  {
    find: "Landisman",
    replace: "Landesman",
    note: "Surname-only form of the Peter Landesman error.",
  },
  {
    find: "Masletov",
    replace: "mazel tov",
    note: "Clubhouse S11E2/E4: 'Masletov to those kids' is mazel tov. Not a person.",
  },
  {
    find: "Mike Reiner",
    replace: "Mike Rhyner",
    note: "SWM-190: 64 website transcript hits across 9 shows ('Hello, it's Mike Reiner of Your Dark Companion'). Rob/Carl Reiner untouched (full phrase only).",
  },
  {
    find: "Engle Angle",
    replace: "Engel Angle",
    note: "SWM-190: Mac Engel's show name ('Fort Worth Star-Telegram, Engle Angle podcast').",
  },
  {
    find: "Ingle Angle",
    replace: "Engel Angle",
    note: "SWM-190: same show name, second Deepgram spelling ('The Ingle Angle, Signal 51 Chronicles').",
  },
  {
    find: "Mack Engle",
    replace: "Mac Engel",
    note: "SWM-190: host name ('Mack Engle, sports columnist extraordinaire').",
  },
  {
    find: "Mac Engle",
    replace: "Mac Engel",
    note: "SWM-190: host name, surname only misspelled ('Mac Engle, Fort Worth Star Telegram').",
  },
  {
    find: "Mike Rhiner",
    replace: "Mike Rhyner",
    note: "SWM-190: Deepgram spelling of Mike Rhyner ('Hello, it's Mike Rhiner'). Full phrase only, so Rob/Carl Reiner stay.",
  },
  {
    find: "Mack Engel",
    replace: "Mac Engel",
    note: "SWM-190: first name misspelled, surname already Engel ('Mack Engel, Fort Worth Star-Telegram').",
  },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const COMPILED_RULES: {
  pattern: RegExp;
  replace: string;
  showIds?: readonly number[];
}[] = [...ASR_RULES]
  .sort((a, b) => b.find.length - a.find.length)
  .map((rule) => ({
    // Straight and curly apostrophes both appear in ASR text.
    pattern: new RegExp(
      `\\b${escapeRegExp(rule.find).replace(/'/g, "['’]")}\\b`,
      "gi"
    ),
    replace: rule.replace,
    showIds: rule.showIds,
  }));

/**
 * Apply the reviewed dictionary. Safe to run more than once.
 * `wpShowId` selects rules that list `showIds`; unscoped rules always run.
 */
export function applyAsrCorrections(text: string, wpShowId?: number): string {
  if (!text) return text;
  let next = text;
  for (const rule of COMPILED_RULES) {
    if (
      rule.showIds &&
      (wpShowId == null || !rule.showIds.includes(wpShowId))
    ) {
      continue;
    }
    next = next.replace(rule.pattern, rule.replace);
  }
  return next;
}
