const fs = require("fs");
const pdfParse = require("pdf-parse");

const MAX_CHARS = 12000; // ~3,000 tokens, safe for GitHub Models rate limits
const HEAD_CHARS = 8000;
const TAIL_CHARS = 4000;

function smartTruncate(text) {
  if (text.length <= MAX_CHARS) return { text, truncated: false };

  // Cut at nearest newline to avoid splitting a line item row mid-value
  const headEnd = text.lastIndexOf("\n", HEAD_CHARS);
  const tailStart = text.indexOf("\n", text.length - TAIL_CHARS);

  const head = text.slice(0, headEnd > 0 ? headEnd : HEAD_CHARS);
  const tail = text.slice(tailStart > 0 ? tailStart : text.length - TAIL_CHARS);

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
    console.log(`  ⚠ Long PDF (${originalLength} chars) → truncated to ~${MAX_CHARS} chars (head + tail)`);
  }

  return text;
}

module.exports = { extractText };
