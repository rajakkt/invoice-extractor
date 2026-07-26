require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { extractText } = require("./extractPdf");
const { extractInvoiceData } = require("./extractData");
const { flattenForCsv } = require("./saveOutput");

const INPUT_DIR = path.join(__dirname, "..", "input");
const PROCESSED_DIR = path.join(__dirname, "..", "output", "processed");
const REVIEW_DIR = path.join(__dirname, "..", "output", "needs_review");
const SUMMARIES_DIR = path.join(__dirname, "..", "output", "daily_summaries");

function getTodayDateString() {
  const now = new Date();
  return now.toISOString().split("T")[0]; // YYYY-MM-DD
}

function isCriticalFieldHighConfidence(data) {
  const criticalFields = ["invoiceNumber_confidence", "totalAmount_confidence", "vendor_confidence"];
  return criticalFields.every(field => data[field] === "high");
}

function createReviewNote(data) {
  const issues = [];
  const confidenceFields = Object.entries(data).filter(([k]) => k.endsWith("_confidence"));
  for (const [field, confidence] of confidenceFields) {
    if (confidence !== "high") {
      const fieldName = field.replace("_confidence", "");
      issues.push(`  ? ${fieldName}: ${confidence} confidence`);
    }
  }
  if (data.reviewReason) issues.push(`  ?? Note: ${data.reviewReason}`);

  return `INVOICE FLAGGED FOR REVIEW
=====================================
Invoice #: ${data.invoiceNumber}
Date: ${new Date().toISOString()}

Issues Found:
${issues.join("\n")}

Next Steps:
1. Review the JSON file for accuracy
2. Compare invoice PDF against extracted data
3. Once verified, move this folder to ../processed/
`;
}

async function processInvoice(filePath, runResults) {
  const fileName = path.basename(filePath);
  console.log(`\n  Processing: ${fileName}`);

  try {
    const pdfText = await extractText(filePath);
    console.log(`    Extracted ${pdfText.length} chars`);

    const data = await extractInvoiceData(pdfText);

    const isHighConfidence = isCriticalFieldHighConfidence(data);
    const targetDir = isHighConfidence ? PROCESSED_DIR : REVIEW_DIR;
    const status = isHighConfidence ? "? Processed" : "??  Needs Review";

    console.log(`    Invoice #${data.invoiceNumber} | Total: ${data.currency} ${data.totalAmount} | ${status}`);

    // Save JSON
    const baseName = path.basename(filePath, ".pdf");
    const jsonPath = path.join(targetDir, `${baseName}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf8");

    // Copy PDF
    const pdfPath = path.join(targetDir, fileName);
    fs.copyFileSync(filePath, pdfPath);

    // Create REVIEW_NOTE if needed
    if (!isHighConfidence) {
      const reviewNotePath = path.join(targetDir, `${baseName}_REVIEW_NOTE.txt`);
      fs.writeFileSync(reviewNotePath, createReviewNote(data), "utf8");
    }

    // Track for CSV
    runResults.push({
      fileName,
      data,
      status: isHighConfidence ? "processed" : "needs_review"
    });

    console.log(`    ? Saved to ${isHighConfidence ? "processed" : "needs_review"}/`);
  } catch (err) {
    console.error(`    ? ERROR: ${err.message}`);
    runResults.push({
      fileName,
      data: null,
      status: "error",
      error: err.message
    });
  }
}

function saveDailySummaryCSV(runResults) {
  const today = getTodayDateString();
  const csvPath = path.join(SUMMARIES_DIR, `invoices_${today}.csv`);

  const rows = runResults.map(r => {
    if (!r.data) return { fileName: r.fileName, status: r.status, error: r.error };
    return {
      fileName: r.fileName,
      invoiceNumber: r.data.invoiceNumber ?? "",
      invoiceDate: r.data.invoiceDate ?? "",
      dueDate: r.data.dueDate ?? "",
      paymentTerms: r.data.paymentTerms ?? "",
      vendorName: r.data.vendor?.name ?? "",
      currency: r.data.currency ?? "",
      subtotal: r.data.subtotal ?? "",
      tax: r.data.tax ?? "",
      totalAmount: r.data.totalAmount ?? "",
      invoiceNumber_confidence: r.data.invoiceNumber_confidence ?? "",
      totalAmount_confidence: r.data.totalAmount_confidence ?? "",
      vendor_confidence: r.data.vendor_confidence ?? "",
      purchaseOrderNumber: r.data.purchaseOrderNumber ?? "",
      trackingNumber: r.data.trackingNumber ?? "",
      status: r.status
    };
  });

  if (rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csvLines = [
    headers.map(escape).join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))
  ];

  fs.writeFileSync(csvPath, csvLines.join("\n") + "\n", "utf8");
  console.log(`\n?? Daily summary saved: ${csvPath}`);
}

async function main() {
  if (!process.env.GITHUB_TOKEN || process.env.GITHUB_TOKEN.startsWith("github_pat_...")) {
    console.error("ERROR: Set your GITHUB_TOKEN in .env file");
    process.exit(1);
  }

  const files = fs.readdirSync(INPUT_DIR).filter((f) => f.toLowerCase().endsWith(".pdf"));

  if (files.length === 0) {
    console.log("No PDF files in input/ folder");
    return;
  }

  console.log(`\n?? Processing ${files.length} invoice(s)...\n`);
  const runResults = [];

  for (const file of files) {
    await processInvoice(path.join(INPUT_DIR, file), runResults);
  }

  saveDailySummaryCSV(runResults);

  const processed = runResults.filter(r => r.status === "processed").length;
  const needsReview = runResults.filter(r => r.status === "needs_review").length;
  const errors = runResults.filter(r => r.status === "error").length;

  console.log(`\n? Done!`);
  console.log(`   Processed: ${processed} | Needs Review: ${needsReview} | Errors: ${errors}`);
}

main();
