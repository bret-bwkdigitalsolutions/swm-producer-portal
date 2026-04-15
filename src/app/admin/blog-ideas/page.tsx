import { db } from "@/lib/db";
import { getCachedShows } from "@/lib/wordpress/cache";
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

export default async function BlogIdeasPage() {
  const [blogSuggestions, allShows, allShowMetadata] = await Promise.all([
    db.aiSuggestion.findMany({
      where: { type: "blog" },
      include: {
        job: {
          select: {
            id: true,
            title: true,
            wpShowId: true,
            metadata: true,
          },
        },
        blogPost: true,
      },
      orderBy: { job: { createdAt: "desc" } },
    }),
    getCachedShows().catch(() => []),
    db.showMetadata.findMany({
      select: { wpShowId: true, blogReviewerEmails: true, styleGuide: true },
    }),
  ]);

  const showNameMap = new Map(
    allShows.map((s) => [s.id, s.title.rendered])
  );
  const reviewerEmailMap = new Map(
    allShowMetadata
      .filter((sm) => sm.blogReviewerEmails)
      .map((sm) => [sm.wpShowId, sm.blogReviewerEmails!])
  );
  const styleGuideMap = new Map(
    allShowMetadata
      .filter((sm) => sm.styleGuide)
      .map((sm) => [sm.wpShowId, true])
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Blog Ideas</h2>
        <p className="text-sm text-muted-foreground">
          AI-generated blog post ideas from episode transcripts. Generate a
          draft, send to the host for review, then publish to WordPress.
        </p>
      </div>

      {blogSuggestions.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
          <BookOpenIcon className="size-8 text-muted-foreground" />
          <p className="text-muted-foreground">
            No blog ideas yet. They&apos;ll appear here after episodes are
            processed with AI analysis.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {blogSuggestions.map((suggestion) => {
            const showName =
              showNameMap.get(suggestion.job.wpShowId) ??
              `Show #${suggestion.job.wpShowId}`;
            const blogPost = suggestion.blogPost;

            return (
              <Card key={suggestion.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-base">
                        {suggestion.job.title}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {showName}
                      </p>
                    </div>
                    {suggestion.accepted && !blogPost && (
                      <Badge className="bg-green-100 text-green-800">
                        Generated
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="whitespace-pre-wrap text-sm">
                    {suggestion.content}
                  </p>

                  {blogPost ? (
                    <BlogPostControls
                      blogPost={blogPost}
                      defaultHostEmail={reviewerEmailMap.get(suggestion.job.wpShowId)}
                    />
                  ) : (
                    <GenerateBlogButton
                      suggestionId={suggestion.id}
                      episodeTitle={suggestion.job.title}
                      generated={suggestion.accepted}
                      hasStyleGuide={styleGuideMap.has(suggestion.job.wpShowId)}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
