export async function sendFailureNotification(
  account: string,
  errors: string[]
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[notify] RESEND_API_KEY is not set — skipping notification.");
    return;
  }

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);

  const errorList = errors.map((e) => `<li>${e}</li>`).join("\n");

  try {
    await resend.emails.send({
      from: "SWM Producer Portal <info@stolenwatermedia.com>",
      to: ["bret@stolenwatermedia.com"],
      subject: `Transistor scraper failed — ${account}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
          <h2 style="margin: 0 0 16px; font-size: 20px; color: #dc2626;">
            Transistor Scraper Failed
          </h2>
          <p style="color: #111;">Account: <strong>${account}</strong></p>
          <p style="color: #111;">Time: ${new Date().toISOString()}</p>
          <h3 style="margin: 16px 0 8px; font-size: 14px; color: #111;">Errors</h3>
          <ul style="color: #dc2626;">${errorList}</ul>
        </div>
      `,
    });
  } catch (error) {
    console.error("[notify] Failed to send failure notification:", error);
  }
}
