const fs = require("fs");

function flattenForCsv(data, fileName) {
  return {
    fileName,
    invoiceNumber: data.invoiceNumber ?? "",
    invoiceDate: data.invoiceDate ?? "",
    dueDate: data.dueDate ?? "",
    paymentTerms: data.paymentTerms ?? "",
    vendorName: data.vendor?.name ?? "",
    vendorAddress: data.vendor?.address ?? "",
    purchaseOrderNumber: data.purchaseOrderNumber ?? "",
    currency: data.currency ?? "",
    subtotal: data.subtotal ?? "",
    tax: data.tax ?? "",
    totalAmount: data.totalAmount ?? "",
    trackingNumber: data.trackingNumber ?? "",
    carrier: data.carrier ?? "",
    lineItemCount: (data.lineItems ?? []).length
  };
}

module.exports = { flattenForCsv };
