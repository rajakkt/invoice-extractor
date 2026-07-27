const OpenAI = require("openai").default;

let client;
function getClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.GITHUB_TOKEN,
      baseURL: "https://models.inference.ai.azure.com"
    });
  }
  return client;
}

const SYSTEM_PROMPT = `You are an invoice data extraction assistant.
Extract structured data from the invoice text provided by the user.
Return ONLY valid JSON matching this exact schema. Use null for missing fields.

CRITICAL RULES FOR FIELD DISAMBIGUATION:
- "invoiceNumber" is the SELLER document ID (e.g., "Invoice No:", "Invoice #:", "Invoice Number:")
- "purchaseOrderNumber" is the BUYER PO number (e.g., "Purchase Order:", "PO:", "PO Number:", "Customer Order Number:")
- These are DIFFERENT numbers. Never assign the invoice number to purchaseOrderNumber.
- PDF text extraction often merges a value and its label (e.g., "US689178Invoice No:" means invoiceNumber = "US689178")

CRITICAL RULES FOR TWO-COLUMN PDF LAYOUTS:
- Many PDFs have a two-column layout: left column has labels, right column has values
- pdf-parse extracts ALL left-column labels first, then ALL right-column values after
- Example: you may see "Purchase Order:\nShipping Terms:\nCarrier:" (all labels) followed later by "253439-00\nFCA SHIPPING POINT\nFedEx" (all values in same order)
- Match labels to values by their relative position order
- A value like "253439-00" appearing after a group of labels is the PO number

CRITICAL RULES FOR LINE ITEMS:
- PDF tables are often extracted without column separators, so columns get merged
- A line like "1193.99193.99" means: quantity=1, unitPrice=193.99, totalPrice=193.99
- A line like "2138.5277.04" means: quantity=2, unitPrice=138.52, totalPrice=277.04
- Pattern: [quantity][unitPrice][totalPrice] — use quantity * unitPrice = totalPrice to find the correct split
- Try different splits until quantity * unitPrice matches totalPrice — this is the ground truth check
- Use the stated subtotal/total on the invoice to validate your line item math

CRITICAL RULES FOR AMOUNTS:
- Use the explicitly stated subtotal and total printed on the invoice
- totalAmount should equal: subtotal + tax + shippingCost
- Extract numeric values only, no currency symbols or commas (e.g., 2101.22 not $2,101.22)
- If a field is null or empty, its _confidence MUST be "low"

CRITICAL RULES FOR CONFIDENCE SCORING:
- If a field value is null or empty string, its _confidence MUST be "low" (not "high" or "medium")
- "high"   : field was clearly found, not empty, and unambiguous
- "medium" : field was inferred, partially matched, or field exists but unclear
- "low"    : field is missing, null, empty, or could not be found

Set "needsHumanReview" to true if ANY critical field (invoiceNumber, totalAmount, vendor, purchaseOrderNumber) has confidence "low" or "medium".
Set "reviewReason" to a short explanation of what needs checking.

{
  "invoiceNumber": null,
  "invoiceNumber_confidence": "high",
  "invoiceDate": null,
  "invoiceDate_confidence": "high",
  "dueDate": null,
  "dueDate_confidence": "high",
  "paymentTerms": null,
  "paymentTerms_confidence": "high",
  "vendor": { "name": null, "address": null },
  "vendor_confidence": "high",
  "billTo": { "name": null, "address": null },
  "shipTo": { "name": null, "address": null },
  "purchaseOrderNumber": null,
  "purchaseOrderNumber_confidence": "high",
  "currency": null,
  "lineItems": [
    {
      "lineNumber": null,
      "partNumber": null,
      "description": null,
      "quantity": 0,
      "unitPrice": 0,
      "totalPrice": 0,
      "uom": null
    }
  ],
  "subtotal": null,
  "subtotal_confidence": "high",
  "tax": null,
  "tax_confidence": "high",
  "shippingCost": null,
  "shippingCost_confidence": "high",
  "totalAmount": null,
  "totalAmount_confidence": "high",
  "trackingNumber": null,
  "trackingNumber_confidence": "high",
  "carrier": null,
  "carrier_confidence": "high",
  "needsHumanReview": false,
  "reviewReason": null
}`;

function normalizeText(obj) {
  if (typeof obj === "string") {
    return obj
      .replace(/\u2212/g, "-")
      .replace(/\u2013/g, "-")
      .replace(/\u2014/g, "-")
      .replace(/\u00e2\u0088\u0092/g, "-");
  }
  if (Array.isArray(obj)) return obj.map(normalizeText);
  if (obj && typeof obj === "object") {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, normalizeText(v)]));
  }
  return obj;
}

async function extractInvoiceData(pdfText) {
  const response = await getClient().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: pdfText }
    ],
    response_format: { type: "json_object" },
    temperature: 0
  });

  const parsed = JSON.parse(response.choices[0].message.content);
  return normalizeText(parsed);
}

module.exports = { extractInvoiceData };
