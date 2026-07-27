const fs = require("fs");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const { createCanvas } = require("canvas");


// Render at 2x scale (~150 DPI) for sharp text without oversized images
const SCALE = 2;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB per page

// pdfjs-dist v3 NodeCanvasFactory — required for rendering in Node.js
const NodeCanvasFactory = {
  create(width, height) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  },
  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  },
  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
};

async function renderPage(page, scale) {
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
  const ctx = canvas.getContext("2d");

  await page.render({
    canvasContext: ctx,
    viewport,
    canvasFactory: NodeCanvasFactory
  }).promise;

  let buffer = canvas.toBuffer("image/png");

  // If image is too large, re-render at reduced scale
  if (buffer.length > MAX_IMAGE_BYTES) {
    const reducedScale = scale * Math.sqrt(MAX_IMAGE_BYTES / buffer.length);
    return renderPage(page, reducedScale);
  }

  return buffer.toString("base64");
}

async function extractPages(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  const pages = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const base64 = await renderPage(page, SCALE);
    const sizeKB = Math.round(base64.length * 0.75 / 1024);
    console.log(`    Rendered page ${pageNum}/${pdf.numPages} (${sizeKB} KB)`);
    pages.push({ pageNum, base64, totalPages: pdf.numPages });
  }

  return pages;
}

module.exports = { extractPages };