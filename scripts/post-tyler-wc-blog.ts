/**
 * One-off script: publish Tyler Kern's "Players to Watch at the 2026 World Cup"
 * blog to WordPress as a Sunset SC swm_blog post, with internal links inserted
 * and a Spanish translation pre-populated in the bilingual meta fields.
 *
 * Usage (against staging):
 *   railway run --service swm-producer-portal -- npx tsx scripts/post-tyler-wc-blog.ts
 *
 * Or against production once verified on staging:
 *   railway run --service swm-producer-portal-production -- npx tsx scripts/post-tyler-wc-blog.ts
 *
 * Default status: draft (so you can preview the WP rendering and verify the
 * links and Spanish translation before clicking Publish). Pass --publish to
 * post live directly.
 */

import { translateBlogPost } from "../src/lib/ai/translate";

const WP_SHOW_ID = 23; // Sunset SC
const AUTHOR = "Tyler Kern";
const TITLE = "Players to Watch at the 2026 World Cup";
const EXCERPT =
  "From Belgian winger Jérémy Doku to Argentine prospect Nico Paz, Sunset SC host Tyler Kern picks three players poised to break out and steal the spotlight at the 2026 World Cup.";
const SEO_DESCRIPTION =
  "Sunset SC's Tyler Kern names three breakout candidates for the 2026 World Cup: Jérémy Doku, Arda Güler, and Nico Paz.";
const SEO_KEYPHRASE = "World Cup breakout players";

const HTML_BODY = `
<p>Every World Cup gives us a breakout star or two who lights up the tournament on the world's biggest sporting stage.</p>

<p>2014 gave us James Rodriguez, who scored 6 goals in 5 matches for Colombia to win the Golden Boot, securing a big money move to Real Madrid in the process. Kylian Mbappé was still only 19 years old when he scored 4 goals for France in 2018, including one in the final, making him the first teenager to score in a World Cup Final since Pele in 1958. And in 2022, Enzo Fernandez emerged as a crucial part of Argentina's midfield, en route to their third ever World Cup title.</p>

<p>Who are the candidates to break out in this year's tournament? It's important to note none of the aforementioned players were toiling in obscurity prior to tearing it up at the World Cup, so playing in a lesser league or an unknown team isn't a requirement. The only criterion here is that the player elevates the discourse around them beyond where it is presently.</p>

<h2>Jérémy Doku — Belgium</h2>
<p><em>23 years old | Winger | Manchester City</em></p>

<p>Does he already play for one of the best clubs in the world? Yes. Is 23 maybe a little old to be considered a breakout star? Perhaps. But this is an opportunity for one of the most dangerous attackers in the Premier League to become a household name. If he's able to lead <a href="https://stolenwatermedia.com/wc-guides/belgium/">Belgium</a> to heights they weren't able to achieve with their "Golden Generation" in previous tournaments, then the sky is the limit for Doku. When Belgium find ways to get him the ball isolated in space against a defender, like they frequently did in their recent friendly versus the <a href="https://stolenwatermedia.com/wc-guides/usa/">USMNT</a>, good things tend to happen for the Red Devils.</p>

<h2>Arda Güler — Turkiye</h2>
<p><em>21 years old | Attacking Mid | Real Madrid</em></p>

<p>Already recognized as one of the most promising young talents in the world, Güler has the opportunity to fully break out this summer. He has been on the radar for soccer fans for some time now, scoring his first senior team goal for Turkish side Fenerbahçe at 17 years old in 2022 and moving to Real Madrid in 2023. There are already rumors of Premier League sides hoping to swoop him up this summer, namely Arsenal to bolster their creativity in attack. He'll have a golden opportunity to shine on the world stage when <a href="https://stolenwatermedia.com/wc-guides/turkiye/">Turkiye</a> takes on the <a href="https://stolenwatermedia.com/wc-guides/usa/">United States</a> on June 25th in Los Angeles.</p>

<h2>Nico Paz — Argentina</h2>
<p><em>21 years old | Attacking Mid | Como</em></p>

<p>Paz moved up through the youth ranks of Real Madrid, but made the switch to newly promoted Como in Serie A in August 2024. His game has flourished under another former attacking midfield great, Cesc Fàbregas. Scoring 12 goals and adding 6 assists this season, Paz has Como pushing for a spot in European competition next season. Real Madrid retains half of Paz's rights, and Premier League interest has already been rumored, so it's reasonable to suggest that a stellar World Cup showing alongside Leo Messi could make the exciting <a href="https://stolenwatermedia.com/wc-guides/argentina/">Argentine</a> a household name.</p>
`.trim();

async function main() {
  const wpUrl = process.env.WP_API_URL;
  const wpUser = process.env.WP_APP_USER;
  const wpPassword = process.env.WP_APP_PASSWORD;
  if (!wpUrl || !wpUser || !wpPassword) {
    console.error(
      "Missing WP_API_URL / WP_APP_USER / WP_APP_PASSWORD. Run via `railway run`."
    );
    process.exit(1);
  }

  const publish = process.argv.includes("--publish");
  const status = publish ? "publish" : "draft";

  console.log(`[post-tyler-wc-blog] Status: ${status}`);
  console.log(`[post-tyler-wc-blog] Translating to Spanish...`);

  const translation = await translateBlogPost(
    {
      title: TITLE,
      content: HTML_BODY,
      excerpt: EXCERPT,
      seoDescription: SEO_DESCRIPTION,
      seoKeyphrase: SEO_KEYPHRASE,
    },
    "en",
    "es"
  );

  const translationMeta: Record<string, string> = translation
    ? {
        _swm_blog_title_es: translation.title,
        _swm_blog_content_es: translation.content,
        _swm_blog_excerpt_es: translation.excerpt,
        _swm_blog_seo_description_es: translation.seoDescription,
        _swm_blog_seo_keyphrase_es: translation.seoKeyphrase,
      }
    : {};

  if (!translation) {
    console.warn(
      "[post-tyler-wc-blog] Translation failed — posting English-only."
    );
  }

  console.log(`[post-tyler-wc-blog] POSTing to ${wpUrl}/swm_blog ...`);

  const auth =
    "Basic " + Buffer.from(`${wpUser}:${wpPassword}`).toString("base64");

  const response = await fetch(`${wpUrl}/swm_blog`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: TITLE,
      content: HTML_BODY,
      status,
      excerpt: EXCERPT,
      meta: {
        parent_show_id: WP_SHOW_ID,
        _swm_blog_author: AUTHOR,
        _swm_portal_submission: true,
        _swm_seo_description: SEO_DESCRIPTION,
        _swm_seo_focus_keyphrase: SEO_KEYPHRASE,
        ...translationMeta,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`[post-tyler-wc-blog] WP error ${response.status}: ${body}`);
    process.exit(1);
  }

  const result = (await response.json()) as { id: number; link?: string };
  const adminBase = wpUrl.replace("/wp-json/wp/v2", "");
  const editUrl = `${adminBase}/wp-admin/post.php?post=${result.id}&action=edit`;

  console.log(`\n✓ Posted as ${status}.`);
  if (result.link) console.log(`  Public:  ${result.link}`);
  console.log(`  Edit:    ${editUrl}`);
  console.log(`  Show:    Sunset SC (wpShowId ${WP_SHOW_ID})`);
  console.log(`  Author:  ${AUTHOR}`);
  if (translation) {
    console.log(`  Spanish: stored in _swm_blog_*_es meta fields`);
  }
}

main().catch((err) => {
  console.error("[post-tyler-wc-blog] Fatal:", err);
  process.exit(1);
});
