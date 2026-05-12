import { Button } from "@/components/ui/button";
import Link from "next/link";

interface SocialConnectButtonsProps {
  metaConfigured: boolean;
  tiktokConfigured: boolean;
  xConfigured: boolean;
}

export function SocialConnectButtons({
  metaConfigured,
  tiktokConfigured,
  xConfigured,
}: SocialConnectButtonsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <ConnectAction
        href="/api/oauth/meta/authorize"
        label="Connect Facebook + Instagram"
        configured={metaConfigured}
        unconfiguredHint="META_APP_ID / META_APP_SECRET not set"
      />
      <ConnectAction
        href="/api/oauth/tiktok/authorize"
        label="Connect TikTok"
        configured={tiktokConfigured}
        unconfiguredHint="TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET not set"
      />
      <ConnectAction
        href="/admin/social-accounts/add-x"
        label="Add X Handle"
        configured={xConfigured}
        unconfiguredHint="X_BEARER_TOKEN not set"
      />
    </div>
  );
}

function ConnectAction({
  href,
  label,
  configured,
  unconfiguredHint,
}: {
  href: string;
  label: string;
  configured: boolean;
  unconfiguredHint: string;
}) {
  if (!configured) {
    return (
      <div className="flex flex-col gap-0.5">
        <Button variant="outline" size="sm" disabled>
          {label}
        </Button>
        <span className="text-[10px] text-muted-foreground">
          {unconfiguredHint}
        </span>
      </div>
    );
  }
  return (
    <Link href={href}>
      <Button variant="default" size="sm">
        {label}
      </Button>
    </Link>
  );
}
