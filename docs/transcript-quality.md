# Transcript names, chapters, and Transistor episode links

Portal-side follow-up to the Oct 6, 2026 transcript-impact analysis. This ships on `main` (Railway staging). It does not belong on the `production` branch until staging has published a real episode and the website plugin is ready for `_swm_chapters`.

No new environment variables. Transcription still needs `DEEPGRAM_API_KEY`. Transistor updates use the API keys already stored in `platform_credentials`.

## Names at transcription time

`src/lib/transcription.ts` calls Deepgram Nova-3 with repeated `keyterm` query params from `src/lib/keyterms.ts`. Lists are scoped by `wpShowId` (ids match `src/lib/analytics/networks.ts`):

- Every show gets the shared host list (Hitzges, Rhyner, Gruber / Grubes, Engel, Hawila, Nadel, Blaskovich, Delkus, and the other network names in that file).
- Soccer phrases (Pochettino, Tessmann, Tielemans, Altidore, Scally, and the rest of `SOCCER_KEYTERMS`) go to ¡Al Maximo! (`22`) and Sunset Soccer Club (`28`) only.
- `ShowMetadata.hosts` is merged in for that show.

Nova-3 ignores a comma-joined `keyterm` value and does not accept `:weight` suffixes. The query builder repeats the param instead.

After Deepgram returns, `applyAsrCorrections` (`src/lib/asr-corrections.ts`) rewrites known misspellings in the full text and in each segment **before** the transcript is stored on the job or pushed to WordPress / Transistor / WebVTT. The dictionary is the reviewed list (Hoelho/Hoila → Hawila, Pachitino → Pochettino, Norm Hitzkiss → Norm Hitzges, "the angle angle" → The Engel Angle, Yuri Telemann → Youri Tielemans, Delkes/Delkis → Delkus, and the other rows in that file). Each row has a `note` citing where it was seen. Adding a row means adding a test.

### Existing catalog

This does **not** rewrite transcripts already on stolenwatermedia.com. Those ~13.7M words need a separate WordPress backfill (find/replace over `episode_transcript` and `_swm_transcript_vtt`, then the same pass on Transistor `transcript_text` if the copy there should match). The portal dictionary is the source for that script's replacement list; do not invent a second list.

## Structured chapters (`_swm_chapters`)

AI chapters stay a textarea (`HH:MM:SS - Title`, blank line, one-sentence description). On publish, `src/lib/chapters.ts` parses that text.

When at least one timestamp parses, the episode post gets both:

1. Post content HTML, so the page has anchors before the theme change ships:

```html
<div class="swm-chapters">
<h2 id="how-jesse-hawila-lost-130-lbs"><a href="?t=330">How Jesse Hawila lost 130 lbs</a></h2>
<p>One meal a day, high protein.</p>
</div>
```

`?t=` is seconds. The player script already seeks on that query param. The theme can hide `.swm-chapters` inside `the_content()` once it renders the meta itself, so the list is not doubled.

2. Post meta on `swm_episode`. The plugin must register this or WordPress will drop it:

```php
register_post_meta('swm_episode', '_swm_chapters', [
    'type' => 'string',
    'single' => true,
    'show_in_rest' => true,
]);
```

The value is a JSON **string**:

```json
{
  "version": 1,
  "chapters": [
    {
      "name": "How Jesse Hawila lost 130 lbs",
      "start": 330,
      "end": 1080,
      "description": "One meal a day, high protein.",
      "id": "how-jesse-hawila-lost-130-lbs",
      "seek": "?t=330"
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `name` | Chapter title. Render as the H2 text. |
| `start` | Start offset in seconds. |
| `end` | End offset in seconds. Present when the next chapter starts later, or (last chapter) when the portal knew the audio duration. Omit the attribute when absent. |
| `description` | Optional sentence under the H2. |
| `id` | Unique HTML id. Use this for the H2 `id` so it matches the content block. |
| `seek` | Relative link (`?t=SECONDS`). Prefix the episode permalink when building an absolute URL. |
| `version` | `1`. Ignore unknown versions rather than guessing. |

Suggested theme markup for each chapter:

```html
<h2 id="{id}"><a href="{seek}">{name}</a></h2>
```

Clip / `hasPart` schema can use `name`, `start`, and `end` as `startOffset` / `endOffset` (seconds) and the absolute `{permalink}{seek}` as `url`. That schema lives in the website repo, not here.

If the chapter text has no `HH:MM:SS - Title` line, publish keeps the old body (`<h3>Chapters</h3>` plus `<br>` breaks) and does **not** send `_swm_chapters`.

## Transistor episode website / RSS `<link>`

After WordPress returns `post.link`, the processor PATCHes each Transistor episode created for that job:

```http
PATCH https://api.transistor.fm/v1/episodes/{id}
{ "episode": { "alternate_url": "{post.link}" } }
```

`alternate_url` is Transistor's "website" field. It replaces `share_url` as the item `<link>` in the RSS feed, which is the URL aggregators cite.

- The show episode is updated with that show's Transistor key (`wpShowId`, falling back to the network key).
- A Sunset Lounge network cross-post is a second episode. Its id is stored on the job as `metadata.networkTransistorEpisodeId` and updated with the network key (`wpShowId` 0).
- A failed PATCH does not fail the distribution job. Re-run the backfill below.

The permalink is whatever WordPress returned (`post.link`), not a hardcoded production host. On staging that is the staging site URL.

### Backfill for episodes already published

`scripts/backfill-transistor-episode-links.ts` reads completed portal jobs that have both a Transistor episode id and a WordPress `externalUrl`, and sets `alternate_url` to that URL. It also patches `networkTransistorEpisodeId` when the job has one. Network-feed copies published before this field existed are not in the database; those need a separate Transistor listing pass.

```bash
# dry run (default) — prints what it would change
railway run --service <staging-portal> -- npx tsx scripts/backfill-transistor-episode-links.ts

# write
railway run --service <staging-portal> -- npx tsx scripts/backfill-transistor-episode-links.ts --apply
```

Run it against **staging** credentials. Do not point it at production until this branch is explicitly released there. The script skips episodes whose `alternate_url` is already the WordPress URL.
