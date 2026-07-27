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

CRITICAL RULES FOR DATE FIELDS:
- "invoiceDate" is the date the invoice was ISSUED (label: "Invoice Date:", "Date:")
- "dueDate" is the PAYMENT due date (label: "Due Date:", "Payment Due:", "Pay By:")
- "shipDate" or shipping date is NOT the invoiceDate — do not confuse them
- In two-column PDFs, date values may appear BEFORE their labels in the extracted text
  Example: "09-Jun-25\n16-Jun-25\n...\nInvoice Date:\n...\nShip Date:" means
  the first date (09-Jun-25) is the Ship Date and the second (16-Jun-25) is the Invoice Date
  because they appear in the same order as the labels that follow
- Always match dates to their labels by positional order, whether labels come before or after values

CRITICAL RULES FOR TWO-COLUMN PDF LAYOUTS:
- Many PDFs have a two-column layout: left column has labels, right column has values
- pdf-parse may extract ALL values first, then ALL labels — OR all labels first, then all values
- Match labels to values by their relative position order regardless of which comes first
- A PO value like "253439-00" may appear far from its "Purchase Order:" label — search the whole document

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

function postProcessChecks(data) {
  if (
    data.invoiceNumber &&
    data.purchaseOrderNumber &&
    data.invoiceNumber.trim() === data.purchaseOrderNumber.trim()
  ) {
    data.purchaseOrderNumber = null;
    data.purchaseOrderNumber_confidence = "low";
    data.needsHumanReview = true;
    data.reviewReason = (data.reviewReason ? data.reviewReason + "; " : "") +
      "purchaseOrderNumber was same as invoiceNumber — likely a misread, set to null";
  }
}

async function retryLowConfidenceFields(pdfText, lowFields) {
  const fieldDescriptions = {
    invoiceNumber: "the seller invoice number (Invoice No:, Invoice #:)",
    purchaseOrderNumber: "the buyer purchase order number (Purchase Order:, PO:, Customer Order Number:) — DIFFERENT from invoice number. In some PDFs this value appears far from its label (e.g. after line items). Search the ENTIRE text.",
    totalAmount: "the total invoice amount due (Total:, Invoice Amount:, Amount Due:)",
    vendor: "the vendor/seller name and address (the company issuing the invoice)",
    invoiceDate: "the date the invoice was ISSUED (Invoice Date:) — NOT the ship date or order date",
    dueDate: "the payment due date (Due Date:, Pay By:)",
    paymentTerms: "the payment terms (e.g. Net 30)",
    subtotal: "the subtotal before tax and shipping",
    tax: "the tax amount",
    shippingCost: "the shipping or freight cost",
  };

  const fieldList = lowFields
    .map(f => `- ${f}: ${fieldDescriptions[f] || f}`)
    .join("\n");

  const retryPrompt = `A previous extraction of this invoice had low confidence on these fields:
${fieldList}

Look very carefully at the invoice text and try again for ONLY these fields.
Rules:
- Two-column PDFs: labels and values may appear in either order — match them positionally
- Values can appear ANYWHERE in the document, even far from their label
- invoiceDate is when the invoice was ISSUED, NOT the ship date
- invoiceNumber and purchaseOrderNumber are ALWAYS different numbers
- If a field is genuinely missing, return null with confidence "low"

Return JSON with ONLY these fields and their _confidence values.`;

  const response = await getClient().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: retryPrompt },
      { role: "user", content: pdfText }
    ],
    response_format: { type: "json_object" },
    temperature: 0
  });

  return JSON.parse(response.choices[0].message.content);
}

async function extractInvoiceData(pdfText, criticalFields = []) {
  // First pass — full extraction
  const response = await getClient().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: pdfText }
    ],
    response_format: { type: "json_object" },
    temperature: 0
  });

  const data = normalizeText(JSON.parse(response.choices[0].message.content));
  postProcessChecks(data);

  // Build retry list: user's critical fields that are low + purchaseOrderNumber always included
  const ALWAYS_RETRY = ["purchaseOrderNumber"];
  const retrySet = new Set([
    ...criticalFields.filter(f => data[`${f}_confidence`] !== "high"),
    ...ALWAYS_RETRY.filter(f => data[`${f}_confidence`] !== "high")
  ]);

  if (retrySet.size > 0) {
    const lowFields = [...retrySet];
    console.log(`    ↻ Retrying low-confidence fields: ${lowFields.join(", ")}`);
    try {
      const retryResult = normalizeText(await retryLowConfidenceFields(pdfText, lowFields));

      for (const field of lowFields) {
        const retryConfidence = retryResult[`${field}_confidence`];
        const retryValue = retryResult[field];

        if (retryConfidence === "high" && retryValue !== null && retryValue !== "") {
          data[field] = retryValue;
          data[`${field}_confidence`] = "high";
        }
      }

      postProcessChecks(data);
    } catch (err) {
      console.warn(`    ⚠ Retry failed: ${err.message}`);
    }
  }

  return data;
}

module.exports = { extractInvoiceData };
