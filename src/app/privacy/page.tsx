import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — SWM Producer Portal",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-bold">Privacy Policy</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Last updated: April 25, 2026
      </p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground">
        <section>
          <h2 className="text-base font-semibold text-foreground">
            What This Portal Is
          </h2>
          <p>
            The SWM Producer Portal is a private, invite-only tool operated by
            BWK Digital Solutions LLC for Stolen Water Media podcast producers.
            It helps producers submit episodes, manage distribution across
            platforms, and review analytics for their shows.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            Information We Collect
          </h2>
          <p>When you sign in, we collect:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>Google account info</strong> — your name, email address,
              and profile photo (provided via Google OAuth sign-in).
            </li>
            <li>
              <strong>Content you submit</strong> — episode titles,
              descriptions, video files, thumbnails, and other metadata you
              enter through the portal forms.
            </li>
            <li>
              <strong>YouTube channel authorization</strong> — OAuth tokens that
              allow the portal to upload videos to your authorized YouTube
              channel on your behalf. We do not access any other YouTube data.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            How We Use Your Information
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Authentication</strong> — to verify your identity and
              grant access to the portal.
            </li>
            <li>
              <strong>Episode distribution</strong> — to upload your content to
              YouTube, Transistor (podcast platforms), and the Stolen Water Media
              website on your behalf.
            </li>
            <li>
              <strong>Analytics</strong> — to display your show&apos;s
              performance data from YouTube and Transistor within the portal.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            Third-Party Services
          </h2>
          <p>
            The portal connects to the following services to distribute your
            content:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>Google / YouTube</strong> — for authentication and video
              uploads
            </li>
            <li>
              <strong>Transistor.fm</strong> — for podcast audio distribution
            </li>
            <li>
              <strong>WordPress (stolenwatermedia.com)</strong> — for website
              episode pages
            </li>
            <li>
              <strong>Google Cloud Storage</strong> — for temporary video and
              audio file storage during processing
            </li>
            <li>
              <strong>Anthropic (Claude AI)</strong> — for generating episode
              descriptions, titles, and blog post suggestions from transcripts
            </li>
            <li>
              <strong>Deepgram</strong> — for audio transcription
            </li>
          </ul>
          <p className="mt-2">
            Each service is governed by its own privacy policy. We only share the
            minimum data necessary for each service to perform its function.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            Data Retention
          </h2>
          <p>
            Your account information and job history are retained as long as your
            account is active. Video and audio files are stored temporarily in
            Google Cloud Storage during processing and are not retained
            long-term. Transcripts and AI-generated suggestions are stored
            alongside job records in the portal database.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            Data Security
          </h2>
          <p>
            All data is transmitted over HTTPS. OAuth tokens are stored
            encrypted in our database. The portal is hosted on Railway with
            managed infrastructure security. Access is restricted to
            authenticated, invited users only.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            Your Rights
          </h2>
          <p>
            You can request deletion of your account and associated data at any
            time by contacting us. You can revoke YouTube access at any time
            through your{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Google account permissions
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">Contact</h2>
          <p>
            For privacy questions or data requests, contact:{" "}
            <a
              href="mailto:bret@bwkdigitalsolutions.com"
              className="underline"
            >
              bret@bwkdigitalsolutions.com
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
