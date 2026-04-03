/** A parsed content section from HTML, used to build Google Docs requests */
export interface DocSection {
  type: "heading" | "paragraph";
  level?: number; // 2 or 3 for headings
  runs: DocRun[];
}

export interface DocRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  link?: string;
}
