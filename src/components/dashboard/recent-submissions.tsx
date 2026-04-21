import { getRecentSubmissions } from "@/lib/wordpress/client";
import { CONTENT_TYPE_LABELS, type ContentTypeValue } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ExternalLink } from "lucide-react";

/**
 * Map WP post type slugs back to portal ContentType values so we can
 * look up human-readable labels and pick badge colours.
 */
const WP_TYPE_TO_CONTENT_TYPE: Record<string, ContentTypeValue> = {
  swm_reviews: "review",
  swm_trailers: "trailer",
  swm_appearances: "appearance",
  swm_episodes: "episode",
  swm_case_docs: "case_document",
  swm_shows: "show",
};

const CONTENT_TYPE_COLORS: Record<ContentTypeValue, string> = {
  review: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  trailer:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  appearance:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  episode:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  case_document:
    "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  show: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  reaction:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
};

function statusColor(status: string) {
  switch (status) {
    case "publish":
      return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300";
    case "future":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300";
    default:
      return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "publish":
      return "Live";
    case "future":
      return "Scheduled";
    case "draft":
      return "Draft";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Server component
// ---------------------------------------------------------------------------

export async function RecentSubmissions({ userId }: { userId: string }) {
  let posts;
  try {
    posts = await getRecentSubmissions(userId);
  } catch {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Recent Submissions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Unable to load recent submissions. The WordPress API may not be
            configured yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (posts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Recent Submissions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No submissions yet. Use the sidebar to create content.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Recent Submissions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0">
        <ul className="divide-y divide-border -mx-4">
          {posts.map((post) => {
            const contentType = WP_TYPE_TO_CONTENT_TYPE[post.type];
            const label = contentType
              ? CONTENT_TYPE_LABELS[contentType]
              : post.type;
            const typeColor = contentType
              ? CONTENT_TYPE_COLORS[contentType]
              : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";

            return (
              <li
                key={post.id}
                className="flex items-center gap-3 px-4 py-3 text-sm"
              >
                {/* Content type badge */}
                <Badge
                  className={`shrink-0 border-0 ${typeColor}`}
                >
                  {label}
                </Badge>

                {/* Title */}
                <span
                  className="min-w-0 flex-1 truncate font-medium"
                  title={post.title.rendered}
                >
                  {post.title.rendered}
                </span>

                {/* Status pill */}
                <Badge
                  className={`shrink-0 border-0 ${statusColor(post.status)}`}
                >
                  {statusLabel(post.status)}
                </Badge>

                {/* Date */}
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDate(post.date)}
                </span>

                {/* External link */}
                <a
                  href={post.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={`View "${post.title.rendered}" on site`}
                >
                  <ExternalLink className="size-4" />
                </a>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton (exported separately for Suspense fallback)
// ---------------------------------------------------------------------------

export function RecentSubmissionsSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Recent Submissions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0">
        <ul className="divide-y divide-border -mx-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <li
              key={i}
              className="flex items-center gap-3 px-4 py-3 animate-pulse"
            >
              <span className="h-5 w-20 rounded-full bg-muted" />
              <span className="h-4 flex-1 rounded bg-muted" />
              <span className="h-5 w-16 rounded-full bg-muted" />
              <span className="h-3 w-20 rounded bg-muted" />
              <span className="size-4 rounded bg-muted" />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
