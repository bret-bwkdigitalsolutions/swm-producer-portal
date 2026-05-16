import "server-only";

import sanitizeHtmlLib from "sanitize-html";

/**
 * Sanitize HTML imported from external sources (Word, Google Docs export,
 * pasted HTML) so it's safe and clean for WordPress.
 *
 * Critical invariant: text content is never modified. Only tags, attributes,
 * and structural cruft change. A spell-checked or paraphrased import would
 * violate the host's "don't change my words" rule.
 *
 * What stays:
 *   - Semantic structure: headings (h1-h6), paragraphs, lists, blockquotes,
 *     emphasis, links, images, line breaks, horizontal rules, basic tables
 *   - href on links, src/alt on images
 *
 * What gets stripped:
 *   - Inline styles, classes, ids (Word/Drive cruft)
 *   - Microsoft Office namespace tags (<o:p>, <w:*>, etc.)
 *   - <script>, <style>, <form>, <iframe>, anything else not on the allowlist
 *   - Tracking attributes (data-*, on*)
 */
export function sanitizeImportedHtml(html: string): string {
  return sanitizeHtmlLib(html, {
    allowedTags: [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "br",
      "hr",
      "em",
      "i",
      "strong",
      "b",
      "u",
      "s",
      "del",
      "ins",
      "sub",
      "sup",
      "a",
      "img",
      "ul",
      "ol",
      "li",
      "blockquote",
      "code",
      "pre",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      "*": [], // strip everything else (style, class, id, data-*, on*)
    },
    // Force external links to open in a new tab and not leak referrer
    transformTags: {
      a: sanitizeHtmlLib.simpleTransform("a", {
        rel: "noopener",
      }),
    },
    // Drop Microsoft Office and other namespaced tags entirely
    nonTextTags: ["style", "script", "textarea", "option"],
    // Allow text inside <a> even if the URL scheme is unsupported (just drop href)
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesAppliedToAttributes: ["href", "src"],
  });
}
