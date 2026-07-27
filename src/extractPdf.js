const fs = require("fs");
const pdfParse = require("pdf-parse");

const MAX_CHARS = 12000;
const HEAD_CHARS = 8000;
const TAIL_CHARS = 4000;

function preprocessText(text) {
  // Normalize Unicode dashes first
  text = text
    .replace(/\u2212/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "-");

  return text
    .split("\n")
    // Remove barcode/garbage lines (e.g. "!#*US689178Y22*#!")
    .filter(line => !line.match(/^[!#*@|]+[A-Z0-9]{6,}[!#*@|]+$/))
    // Remove lines that are only punctuation, dashes, or stars
    .filter(line => !line.match(/^[\s\-=*_.#|]{3,}$/))
    // Remove lines with no alphanumeric characters (pure noise)
    .filter(line => {
      const stripped = line.trim();
      if (stripped.length === 0) return true;
      return /[a-zA-Z0-9]/.test(stripped);
    })
    .join("\n")
    // Collapse 3+ consecutive blank lines into one
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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

  const cleaned = preprocessText(data.text);
  const { text, truncated, originalLength } = smartTruncate(cleaned);

  if (truncated) {
    console.log(`  ⚠ Long PDF (${originalLength} chars) → truncated to ~${MAX_CHARS} chars (head + tail)`);
  }

  return text;
}

module.exports = { extractText };
