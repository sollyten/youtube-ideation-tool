// Minimal typing for the lib subpath we import (the package's main entry runs
// debug code on import, so we use pdf-parse/lib/pdf-parse.js directly).
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info: unknown;
  }
  function pdfParse(dataBuffer: Buffer): Promise<PdfParseResult>;
  export default pdfParse;
}
