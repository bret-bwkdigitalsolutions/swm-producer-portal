import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "SWM Producer Portal — Stolen Water Media",
  description:
    "The SWM Producer Portal helps Stolen Water Media podcast producers manage episode distribution across YouTube, Transistor, and the web.",
};

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-md space-y-8 text-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            SWM Producer Portal
          </h1>
          <p className="mt-3 text-muted-foreground">
            The content management and distribution platform for{" "}
            <a
              href="https://stolenwatermedia.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Stolen Water Media
            </a>{" "}
            podcast producers.
          </p>
        </div>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Upload episodes, get AI-powered titles and descriptions, and
            distribute to YouTube, Apple Podcasts, Spotify, and the web — all
            from one place.
          </p>
          <p className="text-sm text-muted-foreground">
            Access is by invitation only. If you are an active Stolen Water
            Media producer, sign in below.
          </p>
        </div>

        <Link href="/login">
          <Button size="lg" className="w-full">
            Sign In
          </Button>
        </Link>

        <p className="text-xs text-muted-foreground">
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>
          {" · "}
          <Link href="/terms" className="underline">
            Terms of Service
          </Link>
        </p>
      </div>
    </main>
  );
}
