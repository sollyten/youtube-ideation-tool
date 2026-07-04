/**
 * Text extraction for uploaded resource files (SPEC §2 Req #3: "Uploaded files:
 * extract text (pdf/docx/txt) and store the text in content"). We store only the
 * extracted text, never the binary.
 *
 * pdf-parse's package entry runs debug code on import, so we import its lib
 * module directly. mammoth handles .docx. Plain text/markdown is decoded as UTF-8.
 */
import { BadRequestError } from "../errors.js";

const MAX_BYTES = 10 * 1024 * 1024;

export async function extractText(
  filename: string,
  mediaType: string,
  buffer: Buffer,
): Promise<string> {
  if (buffer.length > MAX_BYTES) {
    throw new BadRequestError("File is too large (max 10MB)");
  }
  const lower = filename.toLowerCase();
  const isPdf = mediaType === "application/pdf" || lower.endsWith(".pdf");
  const isDocx =
    mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx");
  const isText =
    mediaType.startsWith("text/") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".markdown");

  let text: string;
  if (isPdf) {
    const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
    const result = await pdfParse(buffer);
    text = result.text;
  } else if (isDocx) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else if (isText) {
    text = buffer.toString("utf8");
  } else {
    throw new BadRequestError(`Unsupported file type for "${filename}". Use PDF, DOCX, or plain text.`);
  }

  text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new BadRequestError("No extractable text found in the file");
  return text;
}
