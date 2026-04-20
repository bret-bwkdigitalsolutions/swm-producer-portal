import { db } from "@/lib/db";
import { getCachedShows } from "@/lib/wordpress/cache";
import { checkBlogEdits } from "@/lib/blog/edit-check";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpenIcon } from "lucide-react";
import { GenerateBlogButton } from "./generate-blog-button";
import { BlogPostControls } from "./blog-post-controls";
import { CustomBlogForm } from "./custom-blog-form";
import { EpisodeGroup } from "./episode-group";

type BlogPostWithControls = {
  id: string;
  title: string;
  googleDocUrl: string;
  author: string | null;
  hostEmail: string | null;
  status: string;
  wpPostUrl: string | null;
  editCheckPercentage: number | null;
  editCheckLabel: string | null;
};

interface DisplayCard {
  key: string;
  jobId: string | null;
  episodeTitle: string | null;
  showName: string;
  wpShowId: number;
  body: string;
  bodyLabel: "Idea" | "Custom brief";
  createdAt: Date;
  blogPost: BlogPostWithControls | null;
  suggestionId?: string;
  suggestionAccepted?: boolean;
}

interface EpisodeCardGroup {
  groupKey: string;
  episodeTitle: string;
  showName: string;
  cards: DisplayCard[];
  summary: string;
}

function buildGroupSummary(cards: DisplayCard[]): string {
  let ideas = 0;
  let drafts = 0;
  const reviewing: string[] = [];
  let published = 0;

  for (const card of cards) {
    if (!card.blogPost) {
      ideas++;
    } else if (card.blogPost.status === "draft") {
      drafts++;
    } else if (card.blogPost.status === "reviewing") {
      const editInfo =
        card.blogPost.editCheckLabel &&
        card.blogPost.editCheckLabel !== "No changes"
          ? ` (${card.blogPost.editCheckLabel}${card.blogPost.editCheckPercentage != null ? ` ~${card.blogPost.editCheckPercentage}%` : ""})`
          : "";
      reviewing.push(`with host${editInfo}`);
    } else if (card.blogPost.status === "published") {
      published++;
    }
  }

  const parts: string[] = [];
  if (ideas > 0) parts.push(`${ideas} idea${ideas !== 1 ? "s" : ""}`);
  if (drafts > 0) parts.push(`${drafts} draft${drafts !== 1 ? "s" : ""}`);
  for (const r of reviewing) parts.push(r);
  if (published > 0) parts.push(`${published} published`);

  return parts.join(" · ") || "empty";
}

export default async function BlogIdeasPage() {
  // Check Google Docs for host edits on "reviewing" posts (cached, 1hr TTL)
  // Must run before data fetch so results are included in the query below
  await checkBlogEdits();

  const [blogSuggestions, customBlogs, allShows, allShowMetadata] =
    await Promise.all([
      db.aiSuggestion.findMany({
        where: { type: "blog" },
        include: {
          job: {
            select: {
              id: true,
              title: true,
              wpShowId: true,
              metadata: true,
              createdAt: true,
            },
          },
          blogPost: true,
        },
        orderBy: { job: { createdAt: "desc" } },
      }),
      db.blogPost.findMany({
        where: { source: "custom" },
        include: {
          job: { select: { title: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      getCachedShows().catch(() => []),
      db.showMetadata.findMany({
        select: {
          wpShowId: true,
          blogReviewerEmails: true,
          styleGuide: true,
          hosts: true,
        },
      }),
    ]);

  const showNameMap = new Map(allShows.map((s) => [s.id, s.title.rendered]));
  const reviewerEmailMap = new Map(
    allShowMetadata
      .filter((sm) => sm.blogReviewerEmails)
      .map((sm) => [sm.wpShowId, sm.blogReviewerEmails!])
  );
  const styleGuideMap = new Map(
    allShowMetadata
      .filter((sm) => sm.styleGuide)
      .map((sm) => [sm.wpShowId, sm.hosts.split(",")[0]?.trim() || "host"])
  );

  // Shape for CustomBlogForm
  const showsForForm = allShows.map((s) => ({
    id: s.id,
    title: s.title.rendered,
  }));
  const styleGuideRecord: Record<string, string> = {};
  for (const [id, host] of styleGuideMap) {
    styleGuideRecord[String(id)] = host;
  }

  // Normalize suggestion-backed cards
  const suggestionCards: DisplayCard[] = blogSuggestions.map((s) => ({
    key: `suggestion:${s.id}`,
    jobId: s.job.id,
    episodeTitle: s.job.title,
    showName:
      showNameMap.get(s.job.wpShowId) ?? `Show #${s.job.wpShowId}`,
    wpShowId: s.job.wpShowId,
    body: s.content,
    bodyLabel: "Idea",
    createdAt: s.job.createdAt,
    blogPost: s.blogPost,
    suggestionId: s.id,
    suggestionAccepted: s.accepted,
  }));

  // Normalize custom cards
  const customCards: DisplayCard[] = customBlogs.map((b) => ({
    key: `custom:${b.id}`,
    jobId: null,
    episodeTitle: b.job?.title ?? null,
    showName: showNameMap.get(b.wpShowId) ?? `Show #${b.wpShowId}`,
    wpShowId: b.wpShowId,
    body: b.customPrompt ?? "",
    bodyLabel: "Custom brief",
    createdAt: b.createdAt,
    blogPost: {
      id: b.id,
      title: b.title,
      googleDocUrl: b.googleDocUrl,
      author: b.author,
      hostEmail: b.hostEmail,
      status: b.status,
      wpPostUrl: b.wpPostUrl,
      editCheckPercentage: b.editCheckPercentage,
      editCheckLabel: b.editCheckLabel,
    },
  }));

  const allCards: DisplayCard[] = [...suggestionCards, ...customCards].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );

  // Filter out stale suggestions (>30 days, no blogPost, not custom)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const activeCards = allCards.filter(
    (card) =>
      card.blogPost !== null ||
      card.bodyLabel === "Custom brief" ||
      card.createdAt >= thirtyDaysAgo
  );
  const hiddenCount = allCards.length - activeCards.length;

  // Group by jobId
  const groupMap = new Map<string, DisplayCard[]>();
  for (const card of activeCards) {
    const groupKey = card.jobId ?? `custom:${card.key}`;
    const existing = groupMap.get(groupKey) ?? [];
    existing.push(card);
    groupMap.set(groupKey, existing);
  }

  const groups: EpisodeCardGroup[] = Array.from(groupMap.entries()).map(
    ([groupKey, grpCards]) => {
      const first = grpCards[0];
      return {
        groupKey,
        episodeTitle: first.episodeTitle ?? first.blogPost?.title ?? "Custom blog",
        showName: first.showName,
        cards: grpCards,
        summary: buildGroupSummary(grpCards),
      };
    }
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Blog Ideas</h2>
          <p className="text-sm text-muted-foreground">
            AI-generated blog post ideas from episode transcripts, plus custom
            briefs. Generate a draft, send to the host for review, then publish
            to WordPress.
          </p>
        </div>
      </div>

      <CustomBlogForm shows={showsForForm} styleGuideMap={styleGuideRecord} />

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
          <BookOpenIcon className="size-8 text-muted-foreground" />
          <p className="text-muted-foreground">
            No blog ideas yet. They&apos;ll appear here after episodes are
            processed or when you create a custom blog above.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <EpisodeGroup
              key={group.groupKey}
              title={group.episodeTitle}
              showName={group.showName}
              summary={group.summary}
            >
              {group.cards.map((card) => {
                const displayTitle =
                  card.episodeTitle ?? card.blogPost?.title ?? "Custom blog";
                return (
                  <Card key={card.key}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <CardTitle className="text-base">
                            {displayTitle}
                          </CardTitle>
                          <p className="text-sm text-muted-foreground">
                            {card.showName}
                            {card.bodyLabel === "Custom brief" && " · Custom"}
                          </p>
                        </div>
                        {card.suggestionAccepted && !card.blogPost && (
                          <Badge className="bg-green-100 text-green-800">
                            Generated
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {card.bodyLabel === "Custom brief" ? (
                        <details className="text-sm">
                          <summary className="cursor-pointer text-muted-foreground">
                            Custom brief
                          </summary>
                          <p className="mt-2 whitespace-pre-wrap">{card.body}</p>
                        </details>
                      ) : (
                        <p className="whitespace-pre-wrap text-sm">{card.body}</p>
                      )}

                      {card.blogPost ? (
                        <BlogPostControls
                          blogPost={card.blogPost}
                          defaultHostEmail={reviewerEmailMap.get(card.wpShowId)}
                        />
                      ) : card.suggestionId ? (
                        <GenerateBlogButton
                          suggestionId={card.suggestionId}
                          episodeTitle={card.episodeTitle ?? ""}
                          generated={card.suggestionAccepted ?? false}
                          styleGuideHost={styleGuideMap.get(card.wpShowId)}
                        />
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
            </EpisodeGroup>
          ))}
          {hiddenCount > 0 && (
            <p className="text-center text-sm text-muted-foreground pt-2">
              {hiddenCount} older idea{hiddenCount !== 1 ? "s" : ""} hidden (older than 30 days with no blog post).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
