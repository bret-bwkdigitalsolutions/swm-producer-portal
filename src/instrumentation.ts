import { db } from "@/lib/db";
import { mergeJobMetadata } from "@/lib/jobs/job-metadata";

/**
 * Next.js instrumentation — runs once on server startup before handling requests.
 *
 * Recovers distribution jobs that were left in "processing" when the server
 * shut down (deploy, crash, OOM). Marks them as "failed" so producers see the
 * error and can retry via the UI.
 */
export async function register() {
  // Only run on the Node.js server, not during build or edge runtime
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  await sweepStuckProcessingJobs();
  await sweepStuckAnalyses();

  // Re-schedule post-distribution verification tiers that were pending when
  // the previous container died (their setTimeout timers don't survive).
  try {
    const { resumeVerificationSchedules } = await import("@/lib/jobs/processor");
    await resumeVerificationSchedules();
  } catch (error) {
    console.error("[instrumentation] Verification resume failed:", error);
  }

  // Non-blocking: verify the AI model is still reachable so we find out on
  // deploy rather than when a producer triggers analysis.
  checkAiModelHealth().catch(() => {});
}

/**
 * Jobs left in "processing" when the server shut down. The fire-and-forget
 * processJob pipeline died with the process — mark them failed so producers
 * can retry.
 */
async function sweepStuckProcessingJobs() {
  try {
    const stuck = await db.distributionJob.findMany({
      where: { status: "processing" },
      include: { platforms: true },
    });

    if (stuck.length === 0) return;

    console.log(
      `[instrumentation] Found ${stuck.length} stuck job(s) in "processing" — marking as failed`
    );

    for (const job of stuck) {
      // Fail any platform sub-tasks that were still in progress
      for (const platform of job.platforms) {
        if (platform.status === "uploading" || platform.status === "processing") {
          await db.distributionJobPlatform.update({
            where: { id: platform.id },
            data: {
              status: "failed",
              error: "Processing interrupted by server restart — please retry.",
            },
          });
        }
      }

      await db.distributionJob.update({
        where: { id: job.id },
        data: { status: "failed" },
      });

      console.log(`[instrumentation] Job ${job.id} ("${job.title}") marked as failed`);
    }
  } catch (error) {
    // Don't block startup if the sweep fails
    console.error("[instrumentation] Stuck job sweep failed:", error);
  }
}

/**
 * Verify the configured Anthropic model is still reachable. Sends a minimal
 * 1-token request on startup. If the model returns 404 (retired), emails the
 * admin so the ANTHROPIC_MODEL env var can be updated in Railway before any
 * producer's upload hits the error.
 */
async function checkAiModelHealth() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return; // AI features disabled entirely — nothing to check

  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    await client.messages.create({
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });

    console.log(`[instrumentation] AI model health check passed (${model})`);
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    const message = (error as { message?: string }).message ?? String(error);

    if (status === 404) {
      console.error(
        `[instrumentation] AI MODEL RETIRED: "${model}" returned 404. ` +
        `Update ANTHROPIC_MODEL in Railway to a current model.`
      );

      // Email admin
      try {
        const resendKey = process.env.RESEND_API_KEY;
        if (resendKey) {
          const { Resend } = await import("resend");
          const resend = new Resend(resendKey);
          await resend.emails.send({
            from: "SWM Producer Portal <info@stolenwatermedia.com>",
            to: ["bret@stolenwatermedia.com"],
            subject: `⚠️ AI model retired — ${model}`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
                <h2 style="margin: 0 0 16px; font-size: 20px; color: #dc2626;">AI Model No Longer Available</h2>
                <p>The Anthropic model <strong>${model}</strong> returned a 404 error on startup health check.
                   AI suggestions (chapters, summary, keywords, title, blog) will fail for all new uploads until this is fixed.</p>
                <h3 style="font-size: 14px; margin: 16px 0 8px;">How to fix</h3>
                <ol>
                  <li>Go to <strong>Railway → SWM Producer Portal → Variables</strong></li>
                  <li>Set <code>ANTHROPIC_MODEL</code> to a current model (e.g. <code>claude-sonnet-4-6</code>)</li>
                  <li>Railway will redeploy automatically</li>
                </ol>
                <p style="margin-top: 24px; font-size: 12px; color: #999;">
                  Check <a href="https://docs.anthropic.com/en/docs/about-claude/models">Anthropic's model docs</a> for current model IDs.
                </p>
              </div>
            `,
          });
        }
      } catch (emailErr) {
        console.error("[instrumentation] Failed to send model health alert email:", emailErr);
      }
    } else {
      // Non-404 errors (rate limit, network blip) — log but don't alert
      console.warn(`[instrumentation] AI model health check failed (non-fatal, status=${status}): ${message}`);
    }
  }
}

/**
 * Analyze pipelines left in "running" when the server shut down. These jobs
 * sit at status "pending" (not "processing"), so the sweep above misses them.
 * Mark the analyze state failed so the client stops polling and the producer
 * can re-run analysis.
 */
async function sweepStuckAnalyses() {
  try {
    const stuck = await db.distributionJob.findMany({
      where: {
        metadata: { path: ["analyze", "state"], equals: "running" },
      },
      select: { id: true, title: true, metadata: true },
    });

    if (stuck.length === 0) return;

    console.log(
      `[instrumentation] Found ${stuck.length} analyze pipeline(s) stuck in "running" — marking as failed`
    );

    for (const job of stuck) {
      const metadata = (job.metadata as Record<string, unknown>) ?? {};
      const analyze = (metadata.analyze as Record<string, unknown>) ?? {};
      await mergeJobMetadata(job.id, {
        analyze: {
          ...analyze,
          state: "failed",
          error: "Analysis was interrupted by a server restart — please try again.",
        },
      });
      console.log(`[instrumentation] Analyze for job ${job.id} ("${job.title}") marked as failed`);
    }
  } catch (error) {
    console.error("[instrumentation] Stuck analyze sweep failed:", error);
  }
}
