import { AppError } from "@/lib/errors";

export async function extractTextFromFile(buffer: Buffer, mimetype: string, filename: string): Promise<string> {
  if (mimetype === "application/pdf" || filename.endsWith(".pdf")) {
    // Import the library's internal implementation directly rather than its
    // package entry point. pdf-parse's index.js has a long-standing bug: it
    // checks `!module.parent` to decide whether it's being run "standalone"
    // for its own internal debug/testing, and under `tsx` (and some other
    // ESM-aware loaders) that check is true even when we're requiring it
    // normally — so it tries to read a test fixture that doesn't exist in
    // production and throws, failing every single PDF upload. Importing
    // lib/pdf-parse.js skips that debug branch entirely.
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
    const result = await pdfParse(buffer);
    return result.text;
  }

  if (
    mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    filename.endsWith(".docx")
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (mimetype.startsWith("text/") || filename.endsWith(".txt") || filename.endsWith(".md")) {
    return buffer.toString("utf8");
  }

  throw new AppError(`Unsupported file type: ${mimetype || filename}`, 422);
}

export async function extractTextFromUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new AppError(`Could not fetch ${url} (${res.status})`, 422);
  const html = await res.text();

  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
