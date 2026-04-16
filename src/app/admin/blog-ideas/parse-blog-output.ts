export interface ParsedBlogOutput {
  title: string;
  excerpt: string;
  seoDescription: string;
  seoKeyphrase: string;
  content: string;
}

export function parseBlogOutput(rawText: string): ParsedBlogOutput {
  const lines = rawText.split("\n");
  const title = (lines[0] ?? "").replace(/^#+\s*/, "").trim();

  let excerpt = "";
  let seoDescription = "";
  let seoKeyphrase = "";
  let bodyStartIndex = 1;

  for (let i = 1; i < Math.min(lines.length, 10); i++) {
    const line = lines[i].trim();
    if (line.startsWith("EXCERPT:")) {
      excerpt = line.replace("EXCERPT:", "").trim();
      bodyStartIndex = i + 1;
    } else if (line.startsWith("SEO:")) {
      seoDescription = line.replace("SEO:", "").trim().slice(0, 160);
      bodyStartIndex = i + 1;
    } else if (line.startsWith("KEYPHRASE:")) {
      seoKeyphrase = line.replace("KEYPHRASE:", "").trim();
      bodyStartIndex = i + 1;
    } else if (line.startsWith("<")) {
      bodyStartIndex = i;
      break;
    }
  }

  const content = lines.slice(bodyStartIndex).join("\n").trim();

  return { title, excerpt, seoDescription, seoKeyphrase, content };
}
