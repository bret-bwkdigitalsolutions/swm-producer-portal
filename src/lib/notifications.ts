import "server-only";

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
        New ${contentType} published for ${showName}
      </h2>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <td style="padding: 8px 0; color: #666; vertical-align: top; width: 120px;">Show</td>
          <td style="padding: 8px 0; color: #111;">${showName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666; vertical-align: top;">Content Type</td>
          <td style="padding: 8px 0; color: #111;">${contentType}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666; vertical-align: top;">Title</td>
          <td style="padding: 8px 0; color: #111; font-weight: 600;">${title}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666; vertical-align: top;">Submitted By</td>
          <td style="padding: 8px 0; color: #111;">${submittedBy}</td>
        </tr>
      </table>
      <a href="${postUrl}" style="display: inline-block; background: #111; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">
        View Post
      </a>
      <p style="margin-top: 32px; font-size: 12px; color: #999;">
        You're receiving this because you're a stakeholder for ${showName} on the SWM Producer Portal.
      </p>
    </div>
  `;

  try {
    await resend.emails.send({
      from: "SWM Producer Portal <notifications@stolenwatermedia.com>",
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
          <td style="padding: 8px; color: #111; border-bottom: 1px solid #eee;">${f.platform}</td>
          <td style="padding: 8px; color: #dc2626; border-bottom: 1px solid #eee;">${f.error}</td>
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
          <td style="padding: 8px 0; color: #111; font-weight: 600;">${jobTitle}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Show</td>
          <td style="padding: 8px 0; color: #111;">${showName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Submitted By</td>
          <td style="padding: 8px 0; color: #111;">${producerName}</td>
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
      <a href="${jobUrl}" style="display: inline-block; background: #111; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">
        View Job Details
      </a>
    </div>
  `;

  try {
    await resend.emails.send({
      from: "SWM Producer Portal <notifications@stolenwatermedia.com>",
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
