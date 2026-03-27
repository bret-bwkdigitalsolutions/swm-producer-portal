"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { saveCredential } from "../actions";

const ALL_PLATFORMS = [
  { value: "youtube", label: "YouTube" },
  { value: "spotify", label: "Spotify" },
  { value: "apple", label: "Apple Podcasts" },
  { value: "transistor", label: "Transistor" },
];

interface ExistingCredential {
  id: string;
  platform: string;
  credentialType: string;
  accessToken: string;
  refreshToken: string;
  apiKey: string;
  tokenExpiresAt: string;
}

interface CredentialFormProps {
  wpShowId: number;
  existingCredentials: ExistingCredential[];
}

export function CredentialForm({
  wpShowId,
  existingCredentials,
}: CredentialFormProps) {
  const [state, formAction, isPending] = useActionState(saveCredential, {
    success: undefined,
    message: undefined,
  });

  const [selectedPlatform, setSelectedPlatform] = useState("");
  const [credentialType, setCredentialType] = useState<"oauth" | "api_key">(
    "api_key"
  );

  // Pre-fill from existing when platform changes
  const existing = existingCredentials.find(
    (c) => c.platform === selectedPlatform
  );

  function handlePlatformChange(platform: string) {
    setSelectedPlatform(platform);
    const ex = existingCredentials.find((c) => c.platform === platform);
    if (ex) {
      setCredentialType(ex.credentialType as "oauth" | "api_key");
    } else {
      setCredentialType("api_key");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {existing ? "Update Credential" : "New Credential"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="wpShowId" value={wpShowId} />

          {/* Platform selector */}
          <div className="space-y-2">
            <Label htmlFor="platform">Platform</Label>
            <select
              id="platform"
              name="platform"
              value={selectedPlatform}
              onChange={(e) => handlePlatformChange(e.target.value)}
              required
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">Select a platform...</option>
              {ALL_PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                  {existingCredentials.find((c) => c.platform === p.value)
                    ? " (update)"
                    : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Credential type */}
          <div className="space-y-2">
            <Label>Credential Type</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="credentialType"
                  value="api_key"
                  checked={credentialType === "api_key"}
                  onChange={() => setCredentialType("api_key")}
                  className="accent-primary"
                />
                API Key
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="credentialType"
                  value="oauth"
                  checked={credentialType === "oauth"}
                  onChange={() => setCredentialType("oauth")}
                  className="accent-primary"
                />
                OAuth
              </label>
            </div>
          </div>

          {/* API Key field */}
          {credentialType === "api_key" && (
            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                name="apiKey"
                type="password"
                placeholder={existing ? "Leave blank to keep current" : "Enter API key"}
                autoComplete="off"
              />
            </div>
          )}

          {/* OAuth fields */}
          {credentialType === "oauth" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="accessToken">Access Token</Label>
                <Input
                  id="accessToken"
                  name="accessToken"
                  type="password"
                  placeholder={
                    existing ? "Leave blank to keep current" : "Enter access token"
                  }
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="refreshToken">Refresh Token</Label>
                <Input
                  id="refreshToken"
                  name="refreshToken"
                  type="password"
                  placeholder="Optional"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tokenExpiresAt">Token Expires At</Label>
                <Input
                  id="tokenExpiresAt"
                  name="tokenExpiresAt"
                  type="datetime-local"
                  defaultValue={existing?.tokenExpiresAt ?? ""}
                />
              </div>
            </>
          )}

          {state?.message && (
            <p
              className={`text-sm ${state.success ? "text-green-600" : "text-red-600"}`}
            >
              {state.message}
            </p>
          )}

          <Button type="submit" disabled={isPending || !selectedPlatform}>
            {isPending
              ? "Saving..."
              : existing
                ? "Update Credential"
                : "Save Credential"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
