const fs = require("fs");
const pdfParse = require("pdf-parse");

const MAX_CHARS = 12000; // ~3,000 tokens, safe for GitHub Models rate limits
const HEAD_CHARS = 8000; // keep more from the top (header, vendor, line items start)
const TAIL_CHARS = 4000; // keep end (totals, summary)

function smartTruncate(text) {
  if (text.length <= MAX_CHARS) return { text, truncated: false };

  const head = text.slice(0, HEAD_CHARS);
  const tail = text.slice(-TAIL_CHARS);
  return {
    text: head + "\n\n[...middle section truncated for length...]\n\n" + tail,
    truncated: true,
    originalLength: text.length
  };
}

async function extractText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  const { text, truncated, originalLength } = smartTruncate(data.text);

  if (truncated) {
    console.log(`  ? Long PDF (${originalLength} chars) — truncated to ${MAX_CHARS} chars (head + tail)`);
  }

  return text;
}

module.exports = { extractText };
