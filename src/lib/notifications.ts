import "server-only";

/** Escape a string for safe interpolation into HTML. */
function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface StakeholderNotificationParams {
  showName: string;
  contentType: string;
  title: string;
  postUrl: string;
  submittedBy: string;
  stakeholderEmails: string[];
}

export async function sendStakeholderNotification({
  showName,
  contentType,
  title,
  postUrl,
  submittedBy,
  stakeholderEmails,
}: StakeholderNotificationParams): Promise<void> {
  if (stakeholderEmails.length === 0) {
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      "[notifications] RESEND_API_KEY is not set — skipping stakeholder notification email."
    );
    return;
  }

  // Dynamic import to avoid loading resend when API key is missing
  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);

  const subject = `New ${contentType} published — ${showName}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="margin: 0 0 16px; font-size: 20px; color: #111;">
        New ${escHtml(contentType)} published for ${escHtml(showName)}
      </h2>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <td style="padding: 8px 0; color: #666; vertical-align: top; width: 120px;">Show</td>
          <td style="padding: 8px 0; color: #111;">${escHtml(showName)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666; vertical-align: top;">Content Type</td>
          <td style="padding: 8px 0; color: #111;">${escHtml(contentType)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666; vertical-align: top;">Title</td>
          <td style="padding: 8px 0; color: #111; font-weight: 600;">${escHtml(title)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666; vertical-align: top;">Submitted By</td>
          <td style="padding: 8px 0; color: #111;">${escHtml(submittedBy)}</td>
        </tr>
      </table>
      <a href="${escHtml(postUrl)}" style="display: inline-block; background: #111; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">
        View Post
      </a>
      <p style="margin-top: 32px; font-size: 12px; color: #999;">
        You're receiving this because you're a stakeholder for ${escHtml(showName)} on the SWM Producer Portal.
      </p>
    </div>
  `;

  try {
    await resend.emails.send({
      from: "SWM Producer Portal <info@stolenwatermedia.com>",
      to: stakeholderEmails,
      subject,
      html,
    });
  } catch (error) {
    console.error("[notifications] Failed to send stakeholder email:", error);
  }
}

interface DistributionErrorParams {
  jobTitle: string;
  showName: string;
  producerName: string;
  failures: { platform: string; error: string }[];
  jobUrl: string;
}

export async function sendDistributionErrorNotification({
  jobTitle,
  showName,
  producerName,
  failures,
  jobUrl,
}: DistributionErrorParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      "[notifications] RESEND_API_KEY is not set — skipping error notification."
    );
    return;
  }

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);

  const failureRows = failures
    .map(
      (f) =>
        `<tr>
          <td style="padding: 8px; color: #111; border-bottom: 1px solid #eee;">${escHtml(f.platform)}</td>
          <td style="padding: 8px; color: #dc2626; border-bottom: 1px solid #eee;">${escHtml(f.error)}</td>
        </tr>`
    )
    .join("");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="margin: 0 0 16px; font-size: 20px; color: #dc2626;">
        Distribution Failed
      </h2>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
        <tr>
          <td style="padding: 8px 0; color: #666; width: 120px;">Episode</td>
          <td style="padding: 8px 0; color: #111; font-weight: 600;">${escHtml(jobTitle)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Show</td>
          <td style="padding: 8px 0; color: #111;">${escHtml(showName)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Submitted By</td>
          <td style="padding: 8px 0; color: #111;">${escHtml(producerName)}</td>
        </tr>
      </table>
      <h3 style="margin: 16px 0 8px; font-size: 14px; color: #111;">Failures</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <th style="padding: 8px; text-align: left; color: #666; border-bottom: 2px solid #eee;">Platform</th>
          <th style="padding: 8px; text-align: left; color: #666; border-bottom: 2px solid #eee;">Error</th>
        </tr>
        ${failureRows}
      </table>
      <a href="${escHtml(jobUrl)}" style="display: inline-block; background: #111; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">
        View Job Details
      </a>
    </div>
  `;

  try {
    await resend.emails.send({
      from: "SWM Producer Portal <info@stolenwatermedia.com>",
      to: ["bret@stolenwatermedia.com"],
      subject: `Distribution failed — ${jobTitle}`,
      html,
    });
  } catch (error) {
    console.error(
      "[notifications] Failed to send distribution error email:",
      error
    );
  }
}

interface VerificationEmailIssue {
  platform: string;
  /** Verification check field (absent for distribution-time issues). */
  field?: string;
  expected?: string;
  actual?: string;
  /** Distribution-time issue description (e.g. network cross-post failed). */
  message?: string;
  severity?: "critical" | "warning";
}

interface VerificationFailureParams {
  jobTitle: string;
  showName: string;
  /** Issues that need action — these are why the email is being sent. */
  issues: VerificationEmailIssue[];
  /** Cosmetic issues, listed for context only. */
  warnings?: VerificationEmailIssue[];
  jobUrl: string;
}

/** Comma-separated VERIFICATION_ALERT_TO, defaulting to Bret. */
export function verificationAlertRecipients(): string[] {
  const raw = process.env.VERIFICATION_ALERT_TO;
  const list = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : ["bret@stolenwatermedia.com"];
}

function issueRow(i: VerificationEmailIssue, color: string): string {
  const what = i.message ?? i.field ?? "";
  const detail = i.message ? "" : `expected ${i.expected ?? "?"}, got ${i.actual ?? "?"}`;
  return `<tr>
          <td style="padding: 8px; color: #111; border-bottom: 1px solid #eee;">${escHtml(i.platform)}</td>
          <td style="padding: 8px; color: #111; border-bottom: 1px solid #eee;">${escHtml(what)}</td>
          <td style="padding: 8px; color: ${color}; border-bottom: 1px solid #eee; font-size: 13px;">${escHtml(detail)}</td>
        </tr>`;
}

function issueTable(rows: string): string {
  return `<table style="width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 14px;">
        <tr>
          <th style="padding: 8px; text-align: left; color: #666; border-bottom: 2px solid #eee;">Platform</th>
          <th style="padding: 8px; text-align: left; color: #666; border-bottom: 2px solid #eee;">Check</th>
          <th style="padding: 8px; text-align: left; color: #666; border-bottom: 2px solid #eee;">Detail</th>
        </tr>
        ${rows}
      </table>`;
}

export type VerificationEmailResult = "sent" | "skipped" | "failed";

/**
 * Sent once per job, only when a CRITICAL issue is still present at the final
 * (60-minute) verification re-check. Warnings alone never email — they are
 * shown in the portal instead.
 *
 * Returns "failed" when Resend rejects the send (the SDK resolves
 * `{ error }` instead of throwing) so the caller can retry. "skipped" means
 * there is no API key — retrying would not help.
 */
export async function sendVerificationFailureNotification({
  jobTitle,
  showName,
  issues,
  warnings = [],
  jobUrl,
}: VerificationFailureParams): Promise<VerificationEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      "[notifications] RESEND_API_KEY is not set — skipping verification notification."
    );
    return "skipped";
  }

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);

  const criticalRows = issues.map((i) => issueRow(i, "#dc2626")).join("");
  const warningRows = warnings.map((i) => issueRow(i, "#b45309")).join("");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px;">
      <h2 style="margin: 0 0 8px; font-size: 20px; color: #dc2626;">
        ❌ Distribution verification FAILED
      </h2>
      <p style="margin: 0 0 16px; color: #666; font-size: 14px;">
        An hour after publishing, the final re-check still found problems that need attention.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
        <tr>
          <td style="padding: 8px 0; color: #666; width: 100px;">Episode</td>
          <td style="padding: 8px 0; color: #111; font-weight: 600;">${escHtml(jobTitle)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Show</td>
          <td style="padding: 8px 0; color: #111;">${escHtml(showName)}</td>
        </tr>
      </table>
      <h3 style="margin: 16px 0 8px; font-size: 14px; color: #dc2626;">Needs action</h3>
      ${issueTable(criticalRows)}
      ${
        warnings.length > 0
          ? `<h3 style="margin: 16px 0 8px; font-size: 14px; color: #b45309;">Warnings (cosmetic, no action required)</h3>
      ${issueTable(warningRows)}`
          : ""
      }
      <a href="${escHtml(jobUrl)}" style="display: inline-block; background: #111; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">
        View Job Details
      </a>
    </div>
  `;

  try {
    const result = await resend.emails.send({
      from: "SWM Producer Portal <info@stolenwatermedia.com>",
      to: verificationAlertRecipients(),
      subject: `❌ FAILED: ${jobTitle} (${showName}) — distribution verification`,
      html,
    });
    if (result.error) {
      console.error(
        "[notifications] Failed to send verification failure email:",
        result.error
      );
      return "failed";
    }
    return "sent";
  } catch (error) {
    console.error(
      "[notifications] Failed to send verification failure email:",
      error
    );
    return "failed";
  }
}
