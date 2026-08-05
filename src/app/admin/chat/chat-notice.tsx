import { ChatApiError } from "@/lib/chat/client";

/**
 * Renders the right message for a chat API failure: a calm "not configured yet"
 * notice (token unset on either side) vs a transient error. Returns null when
 * there's no error.
 */
export function ChatApiNotice({ error }: { error: unknown }) {
  if (!error) return null;

  const notConfigured =
    error instanceof ChatApiError &&
    (error.isNotConfigured || error.code === "portal_token_missing");

  if (notConfigured) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        The chat API isn&apos;t configured yet. The membership site&apos;s{" "}
        <code className="font-mono">swm-chat</code> plugin needs its portal token
        set (matching the portal&apos;s{" "}
        <code className="font-mono">SWM_MEMBERSHIP_API_TOKEN</code>), and the
        portal needs <code className="font-mono">SWM_CHAT_API_BASE</code> pointed
        at the right site. This section lights up automatically once both are in
        place — no data is stored here.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
      {error instanceof ChatApiError ? error.message : "Failed to load chat data."}{" "}
      Try again shortly.
    </div>
  );
}
