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

export default async function BlogIdeasPage() {
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

  // Check Google Docs for host edits on "reviewing" posts (cached, 1hr TTL)
  await checkBlogEdits();

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

  const cards: DisplayCard[] = [...suggestionCards, ...customCards].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
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

      {cards.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
          <BookOpenIcon className="size-8 text-muted-foreground" />
          <p className="text-muted-foreground">
            No blog ideas yet. They&apos;ll appear here after episodes are
            processed or when you create a custom blog above.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {cards.map((card) => {
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
        </div>
      )}
    </div>
  );
}
