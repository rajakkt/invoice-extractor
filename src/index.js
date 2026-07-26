require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { extractText } = require("./extractPdf");
const { extractInvoiceData } = require("./extractData");
const { saveJson, flattenForCsv, appendCsv } = require("./saveOutput");

const INPUT_DIR = path.join(__dirname, "..", "input");
const OUTPUT_DIR = path.join(__dirname, "..", "output");
const CSV_PATH = path.join(OUTPUT_DIR, "invoices.csv");

async function processInvoice(filePath) {
  const fileName = path.basename(filePath);
  console.log(`\nProcessing: ${fileName}`);

  const pdfText = await extractText(filePath);
  console.log(`  Extracted ${pdfText.length} chars of text`);

  const data = await extractInvoiceData(pdfText);

  const reviewFlag = data.needsHumanReview ? "? NEEDS REVIEW" : "? Auto";
  console.log(`  Invoice #${data.invoiceNumber} | Total: ${data.currency ?? "USD"} ${data.totalAmount} | ${reviewFlag}`);
  if (data.needsHumanReview) console.log(`  Reason: ${data.reviewReason}`);

  const baseName = path.basename(filePath, ".pdf");
  const jsonPath = path.join(OUTPUT_DIR, `${baseName}.json`);
  saveJson(data, jsonPath);
  console.log(`  Saved JSON: ${jsonPath}`);

  const csvRow = flattenForCsv(data, fileName);
  appendCsv(csvRow, CSV_PATH);
  console.log(`  Appended to CSV: ${CSV_PATH}`);
}

async function main() {
  if (!process.env.GITHUB_TOKEN || process.env.GITHUB_TOKEN.startsWith("github_pat_...")) {
    console.error("ERROR: Set your GITHUB_TOKEN in a .env file first.");
    console.error("  1. Copy .env.example to .env");
    console.error("  2. Get your token from: https://github.com/settings/tokens");
    console.error("     (No special scopes needed for GitHub Models)");
    process.exit(1);
  }

  const files = fs.readdirSync(INPUT_DIR).filter((f) => f.toLowerCase().endsWith(".pdf"));

  if (files.length === 0) {
    console.log("No PDF files found in input/ — drop your invoices there and run again.");
    return;
  }

  if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);

  console.log(`Found ${files.length} invoice(s) to process...`);

  for (const file of files) {
    try {
      await processInvoice(path.join(INPUT_DIR, file));
    } catch (err) {
      console.error(`  ERROR processing ${file}: ${err.message}`);
    }
  }

  console.log(`\nDone! Results saved to output/`);
}

main();
