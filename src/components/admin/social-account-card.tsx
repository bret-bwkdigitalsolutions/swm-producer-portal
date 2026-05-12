"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PLATFORM_LABELS, type SocialPlatform } from "@/lib/social/types";
import { disconnectSocialAccount } from "@/app/admin/social-accounts/actions";
import { useTransition } from "react";

interface SocialAccountCardProps {
  id: string;
  platform: string;
  handle: string;
  displayName: string | null;
  status: string;
  latestFollowerCount: number | null;
  latestCapturedAt: Date | null;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "needs_reauth") {
    return <Badge variant="destructive">Needs reauth</Badge>;
  }
  if (status === "active") {
    return <Badge variant="outline">Active</Badge>;
  }
  return <Badge variant="secondary">{status}</Badge>;
}

export function SocialAccountCard({
  id,
  platform,
  handle,
  displayName,
  status,
  latestFollowerCount,
  latestCapturedAt,
}: SocialAccountCardProps) {
  const [isPending, startTransition] = useTransition();

  const platformLabel =
    PLATFORM_LABELS[platform as SocialPlatform] ?? platform;

  function handleDisconnect() {
    if (
      !confirm(
        `Disconnect ${platformLabel} ${handle}? Historical follower data will be preserved.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      await disconnectSocialAccount(id);
    });
  }

  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{platformLabel}</span>
          <span className="text-sm text-muted-foreground">{handle}</span>
          <StatusBadge status={status} />
        </div>
        <div className="text-xs text-muted-foreground">
          {displayName && <span>{displayName} · </span>}
          {latestFollowerCount !== null ? (
            <span>
              {latestFollowerCount.toLocaleString()} followers
              {latestCapturedAt && (
                <span>
                  {" "}
                  · updated{" "}
                  {new Date(latestCapturedAt).toLocaleDateString()}
                </span>
              )}
            </span>
          ) : (
            <span>No snapshots yet</span>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleDisconnect}
        disabled={isPending}
      >
        {isPending ? "Disconnecting…" : "Disconnect"}
      </Button>
    </div>
  );
}
