import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — SWM Producer Portal",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-bold">Terms of Service</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Last updated: April 25, 2026
      </p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground">
        <section>
          <h2 className="text-base font-semibold text-foreground">
            Agreement
          </h2>
          <p>
            By accessing the SWM Producer Portal, you agree to these terms. The
            portal is a private, invite-only tool operated by BWK Digital
            Solutions LLC for authorized Stolen Water Media producers.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            Access
          </h2>
          <p>
            Access is granted by invitation only. Your account may be
            deactivated at any time if you are no longer an active producer for
            Stolen Water Media. You are responsible for maintaining the security
            of your login credentials and must not share access with others.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            Content Ownership
          </h2>
          <p>
            You retain ownership of all content you submit through the portal
            (episodes, descriptions, thumbnails, etc.), subject to any
            agreements you have with Stolen Water Media. By submitting content,
            you authorize the portal to distribute it to the platforms you
            select (YouTube, Transistor, the Stolen Water Media website).
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            Acceptable Use
          </h2>
          <p>You agree not to:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Upload content you do not have rights to distribute</li>
            <li>
              Attempt to access shows, accounts, or data belonging to other
              producers
            </li>
            <li>Use the portal for purposes unrelated to Stolen Water Media</li>
            <li>
              Interfere with the portal&apos;s operation or attempt to
              circumvent access controls
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            Third-Party Services
          </h2>
          <p>
            The portal integrates with third-party services (YouTube,
            Transistor, Google Cloud, etc.) to distribute your content. Your use
            of those services through the portal is also subject to their
            respective terms of service. BWK Digital Solutions is not
            responsible for the availability or actions of third-party services.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            AI-Generated Content
          </h2>
          <p>
            The portal uses AI (Anthropic Claude) to generate suggested episode
            titles, descriptions, chapters, and blog post ideas. These are
            suggestions only — you are responsible for reviewing and approving
            all content before it is published. BWK Digital Solutions is not
            liable for the accuracy or appropriateness of AI-generated content.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            Limitation of Liability
          </h2>
          <p>
            The portal is provided &ldquo;as is&rdquo; without warranty. BWK
            Digital Solutions LLC is not liable for any damages arising from
            your use of the portal, including but not limited to failed uploads,
            distribution errors, or service interruptions.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            Changes to These Terms
          </h2>
          <p>
            We may update these terms as the portal evolves. Continued use of
            the portal after changes constitutes acceptance of the updated
            terms.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">Contact</h2>
          <p>
            Questions about these terms? Contact:{" "}
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
