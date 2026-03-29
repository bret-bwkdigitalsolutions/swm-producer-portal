import "server-only";

export interface TransistorShow {
  id: string;
  title: string;
  description: string;
  websiteUrl: string;
  imageUrl: string;
}

/**
 * Fetch all shows from the Transistor API.
 */
export async function getTransistorShows(
  apiKey: string
): Promise<TransistorShow[]> {
  const response = await fetch("https://api.transistor.fm/v1/shows", {
    headers: { "x-api-key": apiKey },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Transistor API error: ${response.status} — ${body}`);
  }

  const json = await response.json();
  const shows: TransistorShow[] = [];

  for (const item of json.data ?? []) {
    shows.push({
      id: String(item.id),
      title: item.attributes.title ?? "",
      description: item.attributes.description ?? "",
      websiteUrl: item.attributes.website_url ?? "",
      imageUrl: item.attributes.image_url ?? "",
    });
  }

  return shows;
}
