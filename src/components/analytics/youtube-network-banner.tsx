import Link from "next/link";
import { getNetworkForShow } from "@/lib/analytics/networks";

interface YouTubeNetworkBannerProps {
  wpShowId: number;
  isAdmin: boolean;
}

export default function YouTubeNetworkBanner({
  wpShowId,
  isAdmin,
}: YouTubeNetworkBannerProps) {
  const network = getNetworkForShow(wpShowId);
  if (!network) return null;

  const networkUrl = `/dashboard/analytics/network/${network.slug}`;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950">
      <p className="text-sm text-blue-800 dark:text-blue-200">
        YouTube analytics for {network.name} shows are available at the network
        level, since all shows share one channel.
        {isAdmin && (
          <>
            {" "}
            <Link href={networkUrl} className="font-medium underline">
              View network analytics
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
