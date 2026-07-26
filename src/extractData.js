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

  return JSON.parse(response.choices[0].message.content);
}

module.exports = { extractInvoiceData };
