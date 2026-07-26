const fs = require("fs");

function saveJson(data, outputPath) {
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf8");
}

function flattenForCsv(data, fileName) {
  return {
    fileName,
    invoiceNumber: data.invoiceNumber ?? "",
    invoiceNumber_confidence: data.invoiceNumber_confidence ?? "",
    invoiceDate: data.invoiceDate ?? "",
    invoiceDate_confidence: data.invoiceDate_confidence ?? "",
    dueDate: data.dueDate ?? "",
    dueDate_confidence: data.dueDate_confidence ?? "",
    paymentTerms: data.paymentTerms ?? "",
    vendorName: data.vendor?.name ?? "",
    vendorAddress: data.vendor?.address ?? "",
    vendor_confidence: data.vendor_confidence ?? "",
    billToName: data.billTo?.name ?? "",
    billToAddress: data.billTo?.address ?? "",
    shipToName: data.shipTo?.name ?? "",
    shipToAddress: data.shipTo?.address ?? "",
    purchaseOrderNumber: data.purchaseOrderNumber ?? "",
    purchaseOrderNumber_confidence: data.purchaseOrderNumber_confidence ?? "",
    currency: data.currency ?? "",
    subtotal: data.subtotal ?? "",
    subtotal_confidence: data.subtotal_confidence ?? "",
    tax: data.tax ?? "",
    shippingCost: data.shippingCost ?? "",
    totalAmount: data.totalAmount ?? "",
    totalAmount_confidence: data.totalAmount_confidence ?? "",
    trackingNumber: data.trackingNumber ?? "",
    carrier: data.carrier ?? "",
    lineItemCount: (data.lineItems ?? []).length,
    needsHumanReview: data.needsHumanReview ?? false,
    reviewReason: data.reviewReason ?? ""
  };
}

function appendCsv(row, csvPath) {
  const headers = Object.keys(row);
  const writeHeader = !fs.existsSync(csvPath);
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [];
  if (writeHeader) lines.push(headers.map(escape).join(","));
  lines.push(headers.map((h) => escape(row[h])).join(","));
  fs.appendFileSync(csvPath, lines.join("\n") + "\n", "utf8");
}

module.exports = { saveJson, flattenForCsv, appendCsv };
