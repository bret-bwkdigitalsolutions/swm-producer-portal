"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deleteCredential } from "@/app/admin/credentials/actions";

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  spotify: "Spotify",
  apple: "Apple Podcasts",
  transistor: "Transistor",
};

const PLATFORM_ICONS: Record<string, string> = {
  youtube: "YT",
  spotify: "SP",
  apple: "AP",
  transistor: "TR",
};

function StatusDot({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    valid: "bg-green-500",
    expiring_soon: "bg-yellow-500",
    expired: "bg-red-500",
  };

  const labelMap: Record<string, string> = {
    valid: "Valid",
    expiring_soon: "Expiring Soon",
    expired: "Expired",
  };

  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ${colorMap[status] ?? "bg-gray-400"}`}
      />
      <span className="text-xs text-muted-foreground">
        {labelMap[status] ?? status}
      </span>
    </span>
  );
}

interface CredentialCardProps {
  credential: {
    id: string;
    platform: string;
    credentialType: string;
    status: string;
    tokenExpiresAt: string | null;
    channelId?: string | null;
    channelTitle?: string | null;
  };
  onEdit?: () => void;
  isOverride?: boolean;
  isNetworkDefault?: boolean;
}

export function CredentialCard({
  credential,
  onEdit,
  isOverride,
  isNetworkDefault,
}: CredentialCardProps) {
  const [deleteState, deleteAction, isDeleting] = useActionState(
    deleteCredential,
    { success: undefined, message: undefined }
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-xs font-bold">
              {PLATFORM_ICONS[credential.platform] ?? "??"}
            </span>
            <span>{PLATFORM_LABELS[credential.platform] ?? credential.platform}</span>
            {isOverride && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                Override
              </Badge>
            )}
            {isNetworkDefault && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                Network default
              </Badge>
            )}
          </span>
          <StatusDot status={credential.status} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Type:</span>
          <Badge variant="outline">
            {credential.credentialType === "oauth" ? "OAuth" : "API Key"}
          </Badge>
        </div>

        {credential.platform === "youtube" && (
          <div className="text-sm">
            <span className="text-muted-foreground">Channel:</span>{" "}
            {credential.channelTitle ? (
              <a
                href={`https://www.youtube.com/channel/${credential.channelId}`}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline-offset-2 hover:underline"
              >
                {credential.channelTitle}
              </a>
            ) : (
              <span className="text-yellow-700">
                Unknown — reconnect to verify
              </span>
            )}
          </div>
        )}

        {credential.tokenExpiresAt && credential.credentialType === "oauth" && (
          <div className="text-sm text-muted-foreground">
            Auto-renewing (refresh token long-lived)
          </div>
        )}
        {credential.tokenExpiresAt && credential.credentialType !== "oauth" && (
          <div className="text-sm">
            <span className="text-muted-foreground">Expires:</span>{" "}
            <span>
              {new Date(credential.tokenExpiresAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        )}

        {deleteState?.message && !deleteState.success && (
          <p className="text-sm text-red-600">{deleteState.message}</p>
        )}

        {!isNetworkDefault && (
          <div className="flex items-center gap-2 pt-1">
            {onEdit && (
              <Button variant="outline" size="sm" onClick={onEdit}>
                Edit
              </Button>
            )}
            <form action={deleteAction}>
              <input type="hidden" name="id" value={credential.id} />
              <Button
                variant="destructive"
                size="sm"
                type="submit"
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </Button>
            </form>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EmptyPlatformCard({
  platform,
  onConnect,
}: {
  platform: string;
  onConnect?: () => void;
}) {
  return (
    <Card className="border-dashed opacity-60 hover:opacity-100 transition-opacity">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-xs font-bold">
              {PLATFORM_ICONS[platform] ?? "??"}
            </span>
            <span>{PLATFORM_LABELS[platform] ?? platform}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-300" />
            <span className="text-xs text-muted-foreground">Not Connected</span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {onConnect && (
          <Button variant="outline" size="sm" onClick={onConnect}>
            Connect
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export { PLATFORM_LABELS, StatusDot };
