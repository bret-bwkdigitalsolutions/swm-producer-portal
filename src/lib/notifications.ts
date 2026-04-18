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

interface VerificationFailureParams {
  jobTitle: string;
  showName: string;
  issues: { platform: string; field: string; expected: string; actual: string }[];
  jobUrl: string;
}

export async function sendVerificationFailureNotification({
  jobTitle,
  showName,
  issues,
  jobUrl,
}: VerificationFailureParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      "[notifications] RESEND_API_KEY is not set — skipping verification notification."
    );
    return;
  }

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);

  const issueRows = issues
    .map(
      (i) =>
        `<tr>
          <td style="padding: 8px; color: #111; border-bottom: 1px solid #eee;">${escHtml(i.platform)}</td>
          <td style="padding: 8px; color: #111; border-bottom: 1px solid #eee;">${escHtml(i.field)}</td>
          <td style="padding: 8px; color: #666; border-bottom: 1px solid #eee; font-size: 13px;">${escHtml(i.expected)}</td>
          <td style="padding: 8px; color: #dc2626; border-bottom: 1px solid #eee; font-size: 13px;">${escHtml(i.actual)}</td>
        </tr>`
    )
    .join("");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px;">
      <h2 style="margin: 0 0 8px; font-size: 20px; color: #b45309;">
        ⚠️ Distribution Verification Failed
      </h2>
      <p style="margin: 0 0 16px; color: #666; font-size: 14px;">
        The episode was distributed but some data didn't make it to the platforms correctly.
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
      <h3 style="margin: 16px 0 8px; font-size: 14px; color: #111;">Issues Found</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px;">
        <tr>
          <th style="padding: 8px; text-align: left; color: #666; border-bottom: 2px solid #eee;">Platform</th>
          <th style="padding: 8px; text-align: left; color: #666; border-bottom: 2px solid #eee;">Field</th>
          <th style="padding: 8px; text-align: left; color: #666; border-bottom: 2px solid #eee;">Expected</th>
          <th style="padding: 8px; text-align: left; color: #666; border-bottom: 2px solid #eee;">Actual</th>
        </tr>
        ${issueRows}
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
      subject: `⚠️ Verification issue — ${jobTitle} (${showName})`,
      html,
    });
  } catch (error) {
    console.error(
      "[notifications] Failed to send verification failure email:",
      error
    );
  }
}
