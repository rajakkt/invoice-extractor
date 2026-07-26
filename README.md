# Invoice Extractor

AI-powered invoice PDF extractor using GitHub Models (gpt-4o-mini). Extracts structured invoice data with confidence scoring and automatic categorization for processing or manual review.

## Features

- **AI-Powered Extraction**: Uses GPT-4o-mini to intelligently extract invoice data from any PDF format
- **Confidence Scoring**: Each extracted field gets a confidence rating (high/medium/low)
- **Smart Routing**: Automatically sorts invoices to `processed/` (high confidence) or `needs_review/` (any field not high confidence)
- **Daily Summaries**: Generates timestamped CSV reports for each processing run
- **No Database Required**: File-based workflow using folder structure for state management
- **Audit Trail**: PDF + JSON pairs saved together, REVIEW_NOTE.txt for flagged invoices
- **Cost-Effective**: Uses GitHub Models free tier (~$0 cost for typical volumes)

## Setup

### 1. Prerequisites

- Node.js (v20+)
- GitHub Personal Access Token with `models` scope

### 2. Install Dependencies

```bash
npm install
```

### 3. Create `.env` File

```bash
cp .env.example .env
```

Edit `.env` and add your GitHub token:

```env
GITHUB_TOKEN=github_pat_...your_token_here...
```

**How to get your GitHub token:**
1. Go to https://github.com/settings/tokens
2. Click "Generate new token" ? "Generate new token (classic)"
3. Name it (e.g., `invoice-extractor`)
4. Check the `models` scope under "Permissions"
5. Generate and copy the token
6. Paste into `.env`

## Usage

### Run Extraction

```bash
npm start
```

**What happens:**
1. Reads all PDFs from `input/` folder
2. Extracts structured data using AI
3. Routes invoices based on confidence:
   - **High confidence** ? `output/processed/`
   - **Any field not high** ? `output/needs_review/`
4. Generates daily CSV summary: `output/daily_summaries/invoices_YYYY-MM-DD.csv`
5. Deletes processed PDFs from `input/`

### Folder Structure After Processing

```
invoice-extractor/
+-- input/                          ? Drop PDFs here
¦   +-- (empty after processing)
¦
+-- output/
¦   +-- processed/                  ? Ready for ERP
¦   ¦   +-- invoice1.pdf
¦   ¦   +-- invoice1.json
¦   ¦   +-- invoice2.pdf
¦   ¦   +-- invoice2.json
¦   ¦
¦   +-- needs_review/               ?? Manual review needed
¦   ¦   +-- invoice3.pdf
¦   ¦   +-- invoice3.json
¦   ¦   +-- invoice3_REVIEW_NOTE.txt (explains issues)
¦   ¦
¦   +-- daily_summaries/
¦       +-- invoices_2026-07-26.csv
¦       +-- invoices_2026-07-27.csv
¦       +-- ...
```

## Extracted Fields

Each invoice JSON contains:

```json
{
  "invoiceNumber": "20031881",
  "invoiceNumber_confidence": "high",
  "invoiceDate": "17-APR-2025",
  "invoiceDate_confidence": "high",
  "dueDate": "17-MAY-2025",
  "dueDate_confidence": "high",
  "paymentTerms": "Net 30",
  "paymentTerms_confidence": "high",
  
  "vendor": {
    "name": "VENDOR NAME",
    "address": "Full Address"
  },
  "vendor_confidence": "high",
  
  "billTo": {
    "name": "BILL TO NAME",
    "address": "Address"
  },
  
  "shipTo": {
    "name": "SHIP TO NAME",
    "address": "Address"
  },
  
  "purchaseOrderNumber": "PO-123",
  "purchaseOrderNumber_confidence": "high",
  
  "currency": "USD",
  
  "lineItems": [
    {
      "lineNumber": "1",
      "partNumber": "PART-001",
      "description": "Product Description",
      "quantity": 10,
      "unitPrice": 100.00,
      "totalPrice": 1000.00,
      "uom": "Each"
    }
  ],
  
  "subtotal": 1000.00,
  "subtotal_confidence": "high",
  "tax": 0.00,
  "shippingCost": 0.00,
  "totalAmount": 1000.00,
  "totalAmount_confidence": "high",
  
  "trackingNumber": "123456789",
  "carrier": "FedEx",
  
  "needsHumanReview": false,
  "reviewReason": null
}
```

## Confidence Scoring

The AI evaluates each field and assigns a confidence level:

| Level | Meaning |
|---|---|
| **high** | Field was clearly found and unambiguous |
| **medium** | Field was inferred or partially matched |
| **low** | Field was guessed, missing, or unclear |

### Routing Rules

- **ALL fields must be "high"** ? `processed/` folder
- **ANY field is "medium" or "low"** ? `needs_review/` folder + REVIEW_NOTE.txt

## Daily Summary CSV

The CSV includes all invoices processed that day:

```csv
fileName,invoiceNumber,invoiceDate,dueDate,paymentTerms,vendorName,...,invoiceNumber_confidence,totalAmount_confidence,vendor_confidence,...,status
invoice1.pdf,20031881,17-APR-2025,17-MAY-2025,Net 30,BRANSON CORP,...,high,high,high,...,processed
invoice2.pdf,US689178,09-Jun-2025,16-Jul-2025,Net 30,Tektronix Inc,...,high,high,high,...,processed
```

Useful for:
- Daily audit trails
- Tracking extraction success rates
- Reconciliation with ERP uploads

## Handling Needs Review

Invoices in `needs_review/` contain a `REVIEW_NOTE.txt` file:

```
INVOICE FLAGGED FOR REVIEW
=====================================
Invoice #: US689178
Date: 2026-07-26T16:00:00Z

Issues Found:
  ? purchaseOrderNumber: low confidence
  ?? Note: Purchase Order Number is missing from invoice.

Next Steps:
1. Review the JSON file for accuracy
2. Compare invoice PDF against extracted data
3. Once verified, move this folder to ../processed/
```

**To approve and move to processed:**
1. Review the invoice and JSON
2. Manually fix any errors in the JSON if needed
3. Move the folder from `needs_review/` to `processed/`

## Cost

**GitHub Models Free Tier:**
- ~150 requests/day
- ~250,000 tokens/day
- Cost: $0

**Typical usage:**
- 3 invoices ˜ 11,000 tokens
- 1 large invoice (25k chars) ˜ 3,000 tokens

## Limitations

- Large invoices (>25k chars) are truncated to prevent token limits
- AI extraction quality depends on PDF legibility and format consistency
- Confidence scoring is AI-based, not a formal algorithm

## Next Steps

This tool is Phase 1 (extraction). Planned:
- **ERP Integration**: Send `processed/` invoices to Infor Vendor Invoice Center
- **Email Automation**: Auto-download from Outlook instead of manual folder
- **PO Validation**: 2-way/3-way matching against Purchase Orders
- **Approval Workflow**: Web dashboard for `needs_review/` approvals

## Troubleshooting

**"ERROR: Set your GITHUB_TOKEN in .env file"**
- Make sure `.env` file exists and has valid token
- Token must have `models` scope enabled

**"No PDF files in input/ folder"**
- Drop your PDFs into the `input/` folder first

**"Long PDF truncated"**
- PDFs >12,000 chars are automatically truncated (keeps start + end)
- This is normal and preserves the most important data

## License

ISC
