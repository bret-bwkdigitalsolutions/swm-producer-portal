import { getTransistorApiKey } from "@/lib/analytics/credentials";

const TRANSISTOR_API_URL = "https://api.transistor.fm/v1";

function fetchTimeout(): AbortSignal {
  return AbortSignal.timeout(30_000);
}

export async function addTransistorSubscriber(
  wpShowId: number,
  transistorShowId: string,
  email: string,
): Promise<{ success: boolean; error?: string }> {
  const apiKey = await getTransistorApiKey(wpShowId);
  if (!apiKey) return { success: false, error: "No Transistor API key" };

  const res = await fetch(`${TRANSISTOR_API_URL}/subscribers`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      show_id: transistorShowId,
      email,
      skip_welcome_email: true,
    }),
    signal: fetchTimeout(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 422 = already exists, treat as success
    if (res.status === 422 && body.includes("already")) {
      return { success: true };
    }
    return { success: false, error: `Transistor API ${res.status}: ${body}` };
  }

  return { success: true };
}

export async function removeTransistorSubscriber(
  wpShowId: number,
  transistorShowId: string,
  email: string,
): Promise<{ success: boolean; error?: string }> {
  const apiKey = await getTransistorApiKey(wpShowId);
  if (!apiKey) return { success: false, error: "No Transistor API key" };

  const res = await fetch(
    `${TRANSISTOR_API_URL}/subscribers?show_id=${transistorShowId}&email=${encodeURIComponent(email)}`,
    {
      method: "DELETE",
      headers: { "x-api-key": apiKey },
      signal: fetchTimeout(),
    },
  );

  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    return { success: false, error: `Transistor API ${res.status}: ${body}` };
  }

  return { success: true };
}

export async function listTransistorSubscribers(
  wpShowId: number,
  transistorShowId: string,
): Promise<{ emails: string[]; error?: string }> {
  const apiKey = await getTransistorApiKey(wpShowId);
  if (!apiKey) return { emails: [], error: "No Transistor API key" };

  const allEmails: string[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `${TRANSISTOR_API_URL}/subscribers?show_id=${transistorShowId}&per_page=100&page=${page}`,
      {
        headers: { "x-api-key": apiKey },
        signal: fetchTimeout(),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { emails: allEmails, error: `Transistor API ${res.status}: ${body}` };
    }

    const data = await res.json() as {
      data: Array<{ attributes: { email: string } }>;
      meta?: { currentPage?: number; totalPages?: number };
    };

    for (const sub of data.data) {
      allEmails.push(sub.attributes.email.toLowerCase());
    }

    const totalPages = data.meta?.totalPages ?? 1;
    if (page >= totalPages) break;
    page++;
  }

  return { emails: allEmails };
}
