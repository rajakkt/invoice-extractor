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

// Normalize special Unicode dash/minus chars that PDF extraction sometimes produces
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

// Post-process deterministic checks — things we can verify in code without AI
function postProcessChecks(data) {
  // If invoiceNumber === purchaseOrderNumber, the AI confused them
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

// Retry extraction for specific fields that had low/medium confidence
async function retryLowConfidenceFields(pdfText, data, lowFields) {
  const fieldDescriptions = {
    invoiceNumber: "the seller invoice number (Invoice No:, Invoice #:)",
    purchaseOrderNumber: "the buyer purchase order number (Purchase Order:, PO:, Customer Order Number:) — this is DIFFERENT from the invoice number",
    totalAmount: "the total invoice amount due (Total:, Invoice Amount:, Amount Due:)",
    vendor: "the vendor/seller name and address (the company issuing the invoice)",
    invoiceDate: "the invoice date",
    dueDate: "the payment due date",
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
Apply these rules:
- Two-column PDFs: labels appear first, then values appear later in the same order
- invoiceNumber and purchaseOrderNumber are ALWAYS different numbers
- If a field is genuinely missing, return null with confidence "low"

Return JSON with ONLY these fields and their _confidence values. Example format:
{
  "purchaseOrderNumber": "12345",
  "purchaseOrderNumber_confidence": "high"
}`;

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

  // Deterministic post-processing
  postProcessChecks(data);

  // Retry: find critical fields that did not come back with high confidence
  if (criticalFields.length > 0) {
    const lowFields = criticalFields.filter(f => data[`${f}_confidence`] !== "high");

    if (lowFields.length > 0) {
      console.log(`    ↻ Retrying low-confidence fields: ${lowFields.join(", ")}`);
      try {
        const retryResult = normalizeText(await retryLowConfidenceFields(pdfText, data, lowFields));

        for (const field of lowFields) {
          const retryConfidence = retryResult[`${field}_confidence`];
          const retryValue = retryResult[field];

          // Only accept retry result if it improved confidence AND has a non-null value
          if (retryConfidence === "high" && retryValue !== null && retryValue !== "") {
            data[field] = retryValue;
            data[`${field}_confidence`] = "high";
          }
        }

        // Re-run post-process checks after merge (retry might have set PO = invoice number again)
        postProcessChecks(data);
      } catch (err) {
        console.warn(`    ⚠ Retry failed: ${err.message}`);
      }
    }
  }

  return data;
}

module.exports = { extractInvoiceData };
