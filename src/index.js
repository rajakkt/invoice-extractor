require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { extractText } = require("./extractPdf");
const { extractInvoiceData } = require("./extractData");
const { validateAmounts } = require("./validate");

const INPUT_DIR = path.join(__dirname, "..", "input");
const PROCESSED_DIR = path.join(__dirname, "..", "output", "processed");
const REVIEW_DIR = path.join(__dirname, "..", "output", "needs_review");
const VALIDATION_FAILED_DIR = path.join(__dirname, "..", "output", "validation_failed");
const SUMMARIES_DIR = path.join(__dirname, "..", "output", "daily_summaries");

const shouldValidate = process.argv.includes("--validate");
if (shouldValidate) console.log("✓ Validation enabled\n");

const criticalFieldsEnv = process.env.CRITICAL_CONFIDENCE_FIELDS || "invoiceNumber,totalAmount,vendor";
const CRITICAL_CONFIDENCE_FIELDS = criticalFieldsEnv
  .split(",")
  .map(f => f.trim())
  .filter(f => f.length > 0);

if (CRITICAL_CONFIDENCE_FIELDS.length === 0) {
  console.log("⚠ No critical confidence fields configured. All invoices will be processed without confidence checks.\n");
}

function ensureDirectoriesExist() {
  [INPUT_DIR, PROCESSED_DIR, REVIEW_DIR, VALIDATION_FAILED_DIR, SUMMARIES_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function getTodayString() {
  return new Date().toISOString().split("T")[0];
}

function isCriticalFieldsHighConfidence(data) {
  if (CRITICAL_CONFIDENCE_FIELDS.length === 0) return true;
  for (const fieldName of CRITICAL_CONFIDENCE_FIELDS) {
    if (data[`${fieldName}_confidence`] !== "high") return false;
  }
  return true;
}

function createReviewNote(data, reason, validationResult = null) {
  const issues = [];

  if (reason === "confidence") {
    for (const fieldName of CRITICAL_CONFIDENCE_FIELDS) {
      const confidence = data[`${fieldName}_confidence`];
      if (confidence !== "high") issues.push(`  ⚠ ${fieldName}: ${confidence} confidence`);
    }
    if (data.reviewReason) issues.push(`  📝 Note: ${data.reviewReason}`);
  } else if (reason === "validation") {
    // FIX: was incorrectly reading data.validationIssues (doesn't exist)
    (validationResult?.issues ?? []).forEach(issue => issues.push(`  ⚠ ${issue}`));
  }

  return `INVOICE FLAGGED FOR REVIEW
=====================================
Invoice #: ${data.invoiceNumber}
Date: ${new Date().toISOString()}
Reason: ${reason === "confidence" ? "Low Confidence on Critical Fields" : "Validation Failed"}

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

    const data = await extractInvoiceData(pdfText, CRITICAL_CONFIDENCE_FIELDS);

    const isHighConfidence = isCriticalFieldsHighConfidence(data);

    let validationResult = null;
    if (shouldValidate && isHighConfidence) {
      validationResult = validateAmounts(data);
      data.validationResult = validationResult;
    }

    let targetDir, status;
    if (!isHighConfidence) {
      targetDir = REVIEW_DIR;
      status = "⚠️  Needs Review (confidence)";
    } else if (shouldValidate && validationResult && !validationResult.valid) {
      targetDir = VALIDATION_FAILED_DIR;
      status = "❌ Validation Failed";
    } else {
      targetDir = PROCESSED_DIR;
      status = "✅ Processed";
    }

    console.log(`    Invoice #${data.invoiceNumber} | Total: ${data.currency} ${data.totalAmount} | ${status}`);
    if (validationResult?.issues?.length > 0) {
      validationResult.issues.forEach(issue => console.log(`      • ${issue}`));
    }

    const baseName = path.basename(filePath, ".pdf");
    fs.writeFileSync(path.join(targetDir, `${baseName}.json`), JSON.stringify(data, null, 2), "utf8");
    fs.copyFileSync(filePath, path.join(targetDir, fileName));

    if (!isHighConfidence || (validationResult && !validationResult.valid)) {
      const reason = !isHighConfidence ? "confidence" : "validation";
      const note = createReviewNote(data, reason, validationResult);
      fs.writeFileSync(path.join(targetDir, `${baseName}_REVIEW_NOTE.txt`), note, "utf8");
    }

    // FIX: always delete from input, even on partial success — delete AFTER all writes succeed
    fs.unlinkSync(filePath);
    console.log(`    ✓ Moved to ${path.basename(targetDir)}/ (removed from input)`);

    runResults.push({
      fileName,
      data,
      status: !isHighConfidence ? "needs_review" : (validationResult && !validationResult.valid) ? "validation_failed" : "processed"
    });

  } catch (err) {
    console.error(`    ❌ ERROR: ${err.message}`);
    // FIX: move errored PDF to needs_review so it doesn't loop forever in input
    try {
      const errorDest = path.join(REVIEW_DIR, fileName);
      fs.copyFileSync(filePath, errorDest);
      fs.unlinkSync(filePath);
      const baseName = path.basename(filePath, ".pdf");
      fs.writeFileSync(
        path.join(REVIEW_DIR, `${baseName}_ERROR.txt`),
        `PROCESSING ERROR\n=====================================\nFile: ${fileName}\nDate: ${new Date().toISOString()}\nError: ${err.message}\n\nThe PDF could not be processed automatically. Please review manually.\n`,
        "utf8"
      );
      console.error(`    ↳ Moved to needs_review/ with error note`);
    } catch (moveErr) {
      console.error(`    ↳ Could not move to needs_review: ${moveErr.message}`);
    }

    runResults.push({ fileName, data: null, status: "error", error: err.message });
  }
}

function saveDailySummaryCSV(runResults) {
  const today = getTodayString();
  const now = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const csvPath = path.join(SUMMARIES_DIR, `invoices_${today}.csv`);

  const rows = runResults.map(r => {
    if (!r.data) return { fileName: r.fileName, status: r.status, error: r.error ?? "" };
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
      purchaseOrderNumber: r.data.purchaseOrderNumber ?? "",
      invoiceNumber_confidence: r.data.invoiceNumber_confidence ?? "",
      totalAmount_confidence: r.data.totalAmount_confidence ?? "",
      vendor_confidence: r.data.vendor_confidence ?? "",
      purchaseOrderNumber_confidence: r.data.purchaseOrderNumber_confidence ?? "",
      trackingNumber: r.data.trackingNumber ?? "",
      validationPassed: r.data.validationResult ? r.data.validationResult.valid : "n/a",
      status: r.status,
      error: ""
    };
  });

  if (rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

  // FIX: append to existing CSV instead of overwriting — multiple runs same day accumulate
  const newRows = rows.map(row => headers.map(h => escape(row[h])).join(",")).join("\n") + "\n";

  if (fs.existsSync(csvPath)) {
    fs.appendFileSync(csvPath, newRows, "utf8");
  } else {
    const header = headers.map(escape).join(",") + "\n";
    fs.writeFileSync(csvPath, header + newRows, "utf8");
  }

  console.log(`\n📊 Daily summary saved: ${csvPath}`);
}

async function main() {
  ensureDirectoriesExist();

  if (!process.env.GITHUB_TOKEN || process.env.GITHUB_TOKEN.startsWith("github_pat_...")) {
    console.error("ERROR: Set your GITHUB_TOKEN in .env file");
    process.exit(1);
  }

  const files = fs.readdirSync(INPUT_DIR).filter(f => f.toLowerCase().endsWith(".pdf"));

  if (files.length === 0) {
    console.log("No PDF files in input/ folder");
    return;
  }

  console.log(`\n📋 Processing ${files.length} invoice(s)...\n`);
  const runResults = [];

  for (const file of files) {
    await processInvoice(path.join(INPUT_DIR, file), runResults);
  }

  saveDailySummaryCSV(runResults);

  const processed = runResults.filter(r => r.status === "processed").length;
  const needsReview = runResults.filter(r => r.status === "needs_review").length;
  const validationFailed = runResults.filter(r => r.status === "validation_failed").length;
  const errors = runResults.filter(r => r.status === "error").length;

  console.log(`\n✅ Done!`);
  console.log(`   Processed: ${processed} | Needs Review: ${needsReview} | Validation Failed: ${validationFailed} | Errors: ${errors}`);
}

main();

