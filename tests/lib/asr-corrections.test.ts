import { describe, expect, it } from "vitest";
import { applyAsrCorrections, ASR_RULES } from "@/lib/asr-corrections";

describe("applyAsrCorrections", () => {
  it("lists a reviewed rule for each name error from the Oct 6 analysis", () => {
    const finds = ASR_RULES.map((rule) => rule.find.toLowerCase());
    for (const phrase of [
      "hoelho",
      "hoila",
      "pachitino",
      "norm hitzkiss",
      "the angle angle",
      "yuri telemann",
      "delkes",
      "delkis",
      "tanner testman",
      "josie altadore",
      "joe scali",
      "georena",
      "ashton villa",
      "gemma arderton",
      "joel edderton",
      "debbie mezar",
      "peter landisman",
      "masletov",
      "colin davis",
    ]) {
      expect(finds).toContain(phrase);
    }
    for (const rule of ASR_RULES) {
      expect(rule.note.length).toBeGreaterThan(10);
      expect(rule.replace.toLowerCase()).not.toBe(rule.find.toLowerCase());
    }
  });

  it("rewrites the Sunset / Hawila transcript errors to canonical spellings", () => {
    const input = [
      "Jesse Hoelho and Jesse Hoila sat with Pete Delkes and Pete Delkis.",
      "Norm Hitzkiss called it the angle angle.",
      "Yuri Telemann's plays for Ashton Villa under Pachitino.",
      "Georena, Policic, and Tim Wea started.",
      "Tanner Testman, Joe Scali, and Josie Altadore checked in.",
      "Gemma Arderton, Joel Edderton, Debbie Mezar, and Peter Landisman.",
      "Masletov to those kids.",
    ].join(" ");

    const out = applyAsrCorrections(input);

    expect(out).toContain("Jesse Hawila");
    expect(out).not.toMatch(/\bHoelho\b|\bHoila\b/);
    expect(out).toContain("Pete Delkus");
    expect(out).not.toMatch(/\bDelkes\b|\bDelkis\b/);
    expect(out).toContain("Norm Hitzges");
    expect(out).toContain("Engel Angle");
    expect(out).toContain("Youri Tielemans'");
    expect(out).toContain("Aston Villa");
    expect(out).toContain("Pochettino");
    expect(out).toContain("Gio Reyna");
    expect(out).toContain("Pulisic");
    expect(out).toContain("Tim Weah");
    expect(out).toContain("Tanner Tessmann");
    expect(out).toContain("Joe Scally");
    expect(out).toContain("Jozy Altidore");
    expect(out).toContain("Gemma Arterton");
    expect(out).toContain("Joel Edgerton");
    expect(out).toContain("Debi Mazar");
    expect(out).toContain("Peter Landesman");
    expect(out).toContain("mazel tov");
    expect(out).not.toMatch(/\bthe angle angle\b/i);
    expect(out).not.toMatch(/\bPachitino\b|\bTestman\b|\bAltadore\b|\bScali\b/);
  });

  it("matches case-insensitively and curly apostrophes", () => {
    expect(applyAsrCorrections("on The Angle Angle today")).toBe(
      "on Engel Angle today"
    );
    expect(applyAsrCorrections("Yuri Telemann’s plays")).toBe(
      "Youri Tielemans' plays"
    );
    expect(applyAsrCorrections("pachitino")).toBe("Pochettino");
  });

  it("rewrites Colin Davis only on Signal 51 Chronicles", () => {
    const rule = ASR_RULES.find((entry) => entry.find === "Colin Davis");
    expect(rule?.showIds).toEqual([27]);

    expect(applyAsrCorrections("T. Colin Davis", 27)).toBe("T. Cullen Davis");
    expect(applyAsrCorrections("colin davis", 27)).toBe("Cullen Davis");
    const fixed = applyAsrCorrections("Colin Davis", 27);
    expect(applyAsrCorrections(fixed, 27)).toBe(fixed);

    // Sunset Soccer Club: a real Colin Davis is left alone.
    expect(applyAsrCorrections("Colin Davis scored for the club.", 28)).toBe(
      "Colin Davis scored for the club."
    );
    expect(applyAsrCorrections("Colin Davis met Pachitino", 28)).toBe(
      "Colin Davis met Pochettino"
    );
    expect(applyAsrCorrections("Colin Davis")).toBe("Colin Davis");
  });

  it("is idempotent and leaves correct names and lookalikes alone", () => {
    const clean = [
      "Norm Hitzges, Jesse Hawila, Pete Delkus, Youri Tielemans, Tanner Tessmann,",
      "Joe Scally, Jozy Altidore, Tim Weah, Aston Villa, Engel Angle, Pochettino,",
      "Antonin Scalia, Debi Mazar, Cullen Davis.",
    ].join(" ");
    expect(applyAsrCorrections(clean)).toBe(clean);
    expect(applyAsrCorrections(applyAsrCorrections(clean))).toBe(clean);

    const fixed = applyAsrCorrections(
      "Jesse Hoelho, Pachitino, the angle angle, Yuri Telemann"
    );
    expect(applyAsrCorrections(fixed)).toBe(fixed);
  });

  it("does not replace inside a larger word", () => {
    expect(applyAsrCorrections("Scalia met Hoelahol.")).toBe("Scalia met Hoelahol.");
    expect(applyAsrCorrections("Tim Weah already")).toBe("Tim Weah already");
  });

  it("fixes the SWM-190 Rhyner and Engel spellings on every show", () => {
    const raw =
      "Hello, it's Mike Reiner of Your Dark Companion. Mack Engle and Mac Engle host the Engle Angle, also heard as The Ingle Angle.";
    const want =
      "Hello, it's Mike Rhyner of Your Dark Companion. Mac Engel and Mac Engel host the Engel Angle, also heard as The Engel Angle.";
    expect(applyAsrCorrections(raw)).toBe(want);
    expect(applyAsrCorrections(raw, 25)).toBe(want);
    expect(applyAsrCorrections(want)).toBe(want);
    expect(applyAsrCorrections("MIKE REINER on the ingle angle")).toBe("Mike Rhyner on the Engel Angle");
    expect(applyAsrCorrections("Mike Reiner\u2019s show")).toBe("Mike Rhyner\u2019s show");
  });

  it("leaves other Reiners and partial words alone", () => {
    expect(applyAsrCorrections("directed by Rob Reiner and Carl Reiner")).toBe(
      "directed by Rob Reiner and Carl Reiner"
    );
    expect(applyAsrCorrections("Smike Reinert met Engleton")).toBe("Smike Reinert met Engleton");
  });
});
