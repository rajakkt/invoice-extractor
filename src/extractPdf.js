const fs = require("fs");
const path = require("path");

const MAX_CHARS = 12000;
const HEAD_CHARS = 8000;
const TAIL_CHARS = 4000;

// Items within Y_TOLERANCE units are considered the same row
const Y_TOLERANCE = 3;

function groupItemsByRow(items) {
  const rows = [];

  for (const item of items) {
    const [, , , , x, y] = item.transform;
    const text = item.str;
    if (!text.trim()) continue;

    const existingRow = rows.find(r => Math.abs(r.y - y) <= Y_TOLERANCE);
    if (existingRow) {
      existingRow.items.push({ x, text });
    } else {
      rows.push({ y, items: [{ x, text }] });
    }
  }

  // Top-to-bottom (descending Y in PDF coords), left-to-right within each row
  rows.sort((a, b) => b.y - a.y);
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
  }

  return rows;
}

// Convert rows to text. Items separated by a large X gap get a tab separator,
// making same-row label-value pairs readable as "Label:\tValue"
function rowsToText(rows) {
  const lines = [];

  for (const row of rows) {
    if (row.items.length === 0) continue;

    let line = row.items[0].text;
    for (let i = 1; i < row.items.length; i++) {
      const prevItem = row.items[i - 1];
      // Approximate char width as 4 units per character
      const gap = row.items[i].x - (prevItem.x + prevItem.text.length * 4);
      if (gap > 20) {
        line += "\t" + row.items[i].text;
      } else {
        line += row.items[i].text;
      }
    }
    lines.push(line);
  }

  return lines.join("\n");
}

function smartTruncate(text) {
  if (text.length <= MAX_CHARS) return { text, truncated: false };

  const headEnd = text.lastIndexOf("\n", HEAD_CHARS);
  const tailStart = text.indexOf("\n", text.length - TAIL_CHARS);

  const head = text.slice(0, headEnd > 0 ? headEnd : HEAD_CHARS);
  const tail = text.slice(tailStart > 0 ? tailStart : text.length - TAIL_CHARS);

  return {
    text: head + "\n\n[...middle section truncated...]\n\n" + tail,
    truncated: true,
    originalLength: text.length
  };
}

async function extractText(filePath) {
  // Dynamic import required since pdfjs-dist is ESM-only
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const data = new Uint8Array(fs.readFileSync(filePath));
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;

  const allItems = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    // Offset Y per page so rows from different pages do not merge
    const pageOffset = (pageNum - 1) * 10000;
    for (const item of content.items) {
      allItems.push({
        ...item,
        transform: [
          item.transform[0], item.transform[1],
          item.transform[2], item.transform[3],
          item.transform[4],
          item.transform[5] + pageOffset
        ]
      });
    }
  }

  const rows = groupItemsByRow(allItems);
  const text = rowsToText(rows);

  const { text: finalText, truncated, originalLength } = smartTruncate(text);

  if (truncated) {
    console.log(`  Long PDF (${originalLength} chars) truncated to ~${MAX_CHARS} chars`);
  }

  return finalText;
}

module.exports = { extractText };