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

export default async function BlogIdeasPage() {
  const [blogSuggestions, allShows] = await Promise.all([
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
      },
      orderBy: { job: { createdAt: "desc" } },
    }),
    getCachedShows().catch(() => []),
  ]);

  const showNameMap = new Map(
    allShows.map((s) => [s.id, s.title.rendered])
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Blog Ideas</h2>
        <p className="text-sm text-muted-foreground">
          AI-generated blog post ideas from episode transcripts. Generate a full
          draft post to WordPress.
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
            const metadata = suggestion.job.metadata as Record<string, unknown>;
            const wpPostUrl = (metadata._generatedBlogUrl as string) ?? null;

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
                    {suggestion.accepted && (
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
                  <div className="flex items-center gap-2">
                    <GenerateBlogButton
                      suggestionId={suggestion.id}
                      episodeTitle={suggestion.job.title}
                      generated={suggestion.accepted}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
