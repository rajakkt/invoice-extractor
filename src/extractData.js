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
You will be shown one or more images of an invoice PDF.
Extract structured data and return ONLY valid JSON matching this exact schema. Use null for missing fields.

RULES FOR FIELD DISAMBIGUATION:
- "invoiceNumber" is the SELLER document ID (label: "Invoice No:", "Invoice #:", "Invoice Number:")
- "purchaseOrderNumber" is the BUYER PO number (label: "Purchase Order:", "PO:", "PO Number:", "Customer Order Number:")
- These are ALWAYS different numbers - never assign the same value to both fields

RULES FOR DATE FIELDS:
- "invoiceDate" is the date the invoice was ISSUED (label: "Invoice Date:", "Date:")
- "dueDate" is the PAYMENT due date (label: "Due Date:", "Payment Due:", "Pay By:")
- Do NOT use the ship date, order date, or any other date for "invoiceDate"

RULES FOR AMOUNTS:
- Use explicitly stated totals from the invoice
- totalAmount should equal: subtotal + tax + shippingCost
- Extract numeric values only, no currency symbols or commas (e.g., 2101.22 not $2,101.22)

RULES FOR CONFIDENCE SCORING:
- "high"   : field was clearly visible and unambiguous
- "medium" : field was partially visible, inferred, or ambiguous
- "low"    : field is missing or could not be found - MUST use "low" when value is null or empty string

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
      "purchaseOrderNumber was same as invoiceNumber - likely a misread, set to null";
  }
}

// Build the messages array with one image per page
function buildVisionMessages(pages) {
  const content = [
    {
      type: "text",
      text: pages.length > 1
        ? `This invoice has ${pages.length} pages. All pages are shown below. Extract data across all pages.`
        : "Extract data from this invoice image."
    }
  ];

  for (const { base64, pageNum, totalPages } of pages) {
    if (totalPages > 1) {
      content.push({ type: "text", text: `Page ${pageNum} of ${totalPages}:` });
    }
    content.push({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${base64}`, detail: "high" }
    });
  }

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content }
  ];
}

async function retryLowConfidenceFields(pages, lowFields) {
  const fieldDescriptions = {
    invoiceNumber: "the seller invoice number (Invoice No:, Invoice #:)",
    purchaseOrderNumber: "the buyer purchase order number (Purchase Order:, PO:, Customer Order Number:) - DIFFERENT from invoice number",
    totalAmount: "the total invoice amount due (Total:, Invoice Amount:, Amount Due:)",
    vendor: "the vendor/seller name and address (the company issuing the invoice)",
    invoiceDate: "the date the invoice was ISSUED (Invoice Date:) - NOT the ship date or order date",
    dueDate: "the payment due date (Due Date:, Pay By:)",
    paymentTerms: "the payment terms (e.g. Net 30)",
    subtotal: "the subtotal before tax and shipping",
    tax: "the tax amount",
    shippingCost: "the shipping or freight cost",
  };

  const fieldList = lowFields
    .map(f => `- ${f}: ${fieldDescriptions[f] || f}`)
    .join("\n");

  const retryPrompt = `A previous extraction had low confidence on these fields:
${fieldList}

Look very carefully at the invoice image(s) and try again for ONLY these fields.
If a field is genuinely missing, return null with confidence "low".
Return JSON with ONLY these fields and their _confidence values.`;

  const content = [{ type: "text", text: retryPrompt }];
  for (const { base64, pageNum, totalPages } of pages) {
    if (totalPages > 1) content.push({ type: "text", text: `Page ${pageNum}:` });
    content.push({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${base64}`, detail: "high" }
    });
  }

  const response = await getClient().chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content }],
    response_format: { type: "json_object" },
    temperature: 0
  });

  return JSON.parse(response.choices[0].message.content);
}

async function extractInvoiceData(pages, criticalFields = []) {
  // First pass - full extraction from images
  const response = await getClient().chat.completions.create({
    model: "gpt-4o",
    messages: buildVisionMessages(pages),
    response_format: { type: "json_object" },
    temperature: 0
  });

  const data = normalizeText(JSON.parse(response.choices[0].message.content));
  postProcessChecks(data);

  // Retry critical fields + purchaseOrderNumber if low confidence
  const ALWAYS_RETRY = ["purchaseOrderNumber"];
  const retrySet = new Set([
    ...criticalFields.filter(f => data[`${f}_confidence`] !== "high"),
    ...ALWAYS_RETRY.filter(f => data[`${f}_confidence`] !== "high")
  ]);

  if (retrySet.size > 0) {
    const lowFields = [...retrySet];
    console.log(`    Retrying low-confidence fields: ${lowFields.join(", ")}`);
    try {
      const retryResult = normalizeText(await retryLowConfidenceFields(pages, lowFields));

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
      console.warn(`    Retry failed: ${err.message}`);
    }
  }

  return data;
}

module.exports = { extractInvoiceData };