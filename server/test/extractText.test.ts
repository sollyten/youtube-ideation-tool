import { describe, expect, it } from "vitest";
import { extractText } from "../src/services/extractText.js";

// Build a well-formed single-page PDF (valid xref + startxref) containing the
// text "Hello PDF". Hand-rolled PDFs without a correct xref parse only via
// pdf-parse's lenient recovery, which is nondeterministic — so we compute real
// byte offsets here.
function buildValidPdf(): Buffer {
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    "<</Length 44>>\nstream\nBT /F1 18 Tf 20 100 Td (Hello PDF) Tj ET\nendstream",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}
const MINIMAL_PDF = buildValidPdf();

describe("extractText", () => {
  it("decodes plain text and normalizes whitespace", async () => {
    const buf = Buffer.from("line one\r\nline two\n\n\n\nline three", "utf8");
    const text = await extractText("notes.txt", "text/plain", buf);
    expect(text).toBe("line one\nline two\n\nline three");
  });

  it("treats markdown as text", async () => {
    const text = await extractText("brief.md", "", Buffer.from("# Heading\n\nBody", "utf8"));
    expect(text).toContain("# Heading");
  });

  it("extracts text from a PDF via the lib subpath import", async () => {
    const text = await extractText("doc.pdf", "application/pdf", MINIMAL_PDF);
    expect(text).toContain("Hello PDF");
  });

  it("rejects unsupported file types", async () => {
    await expect(extractText("image.gif", "image/gif", Buffer.from("GIF89a"))).rejects.toThrow(
      /Unsupported/,
    );
  });

  it("rejects empty extraction results", async () => {
    await expect(extractText("empty.txt", "text/plain", Buffer.from("   \n  "))).rejects.toThrow(
      /No extractable text/,
    );
  });
});
