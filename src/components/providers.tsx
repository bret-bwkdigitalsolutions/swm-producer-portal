"use client";

import { useEffect } from "react";
import { SessionProvider } from "next-auth/react";

/**
 * Auto-reload when the server has been redeployed and client JS is stale.
 * Next.js server actions get new IDs on each build, so stale clients hit
 * "Server Action was not found" errors. This catches that and reloads.
 */
function StaleDeployReloader() {
  useEffect(() => {
    function handleError(event: ErrorEvent) {
      if (
        event.message?.includes("was not found on the server") ||
        event.message?.includes("failed-to-find-server-action")
      ) {
        window.location.reload();
      }
    }
    window.addEventListener("error", handleError);
    return () => window.removeEventListener("error", handleError);
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <StaleDeployReloader />
      {children}
    </SessionProvider>
  );
}
