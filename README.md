# Invoice Extractor

AI-powered invoice PDF extractor using GitHub Models (gpt-4o-mini). Extracts structured invoice data with confidence scoring and automatic categorization for processing or manual review.

## Features

- **AI-Powered Extraction**: Uses GPT-4o-mini to intelligently extract invoice data from any PDF format
- **Confidence Scoring**: Each extracted field gets a confidence rating (high/medium/low)
- **Configurable Critical Fields**: Choose which fields must be "high" confidence to route to processed/
- **Smart Routing**: Automatically sorts invoices based on critical field confidence
- **Amount Validation**: Optional validation checks for invoice math, ranges, and consistency (--validate flag)
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

Edit `.env` and add your GitHub token and critical fields:

```env
GITHUB_TOKEN=github_pat_...your_token_here...
CRITICAL_CONFIDENCE_FIELDS=invoiceNumber,totalAmount,vendor
```

**How to get your GitHub token:**
1. Go to https://github.com/settings/tokens
2. Click "Generate new token" → "Generate new token (classic)"
3. Name it (e.g., `invoice-extractor`)
4. Check the `models` scope under "Permissions"
5. Generate and copy the token
6. Paste into `.env`

## Configuration

### Critical Confidence Fields

The `CRITICAL_CONFIDENCE_FIELDS` setting controls which fields must have "high" confidence for an invoice to go to the `processed/` folder. If ANY critical field has "medium" or "low" confidence, the invoice goes to `needs_review/`.

**Examples:**

```env
# Only check these 3 fields (most lenient)
CRITICAL_CONFIDENCE_FIELDS=invoiceNumber,totalAmount,vendor

# Require PO number too (stricter)
CRITICAL_CONFIDENCE_FIELDS=invoiceNumber,totalAmount,vendor,purchaseOrderNumber

# Check everything (most strict)
CRITICAL_CONFIDENCE_FIELDS=invoiceNumber,invoiceDate,dueDate,vendor,purchaseOrderNumber,totalAmount,subtotal

# Leave empty to accept all invoices (no confidence checking)
CRITICAL_CONFIDENCE_FIELDS=
```

**Default:** `invoiceNumber,totalAmount,vendor` (when not specified)

## Usage

### Run Extraction

```bash
npm start
```

**What happens:**
1. Reads all PDFs from `input/` folder
2. Extracts structured data using AI
3. Checks critical fields against configured list
4. Routes invoices based on confidence:
   - **All critical fields "high"** → `output/processed/`
   - **Any critical field not "high"** → `output/needs_review/`
5. Generates daily CSV summary: `output/daily_summaries/invoices_YYYY-MM-DD.csv`
6. Deletes processed PDFs from `input/`

### Run with Validation

To enable optional amount validation:

```bash
npm start --validate
```

This checks invoice math (subtotal + tax = total) and amounts for reasonableness.

### Folder Structure After Processing

```
invoice-extractor/
+-- input/                          → Drop PDFs here
│   +-- (empty after processing)
│
+-- output/
    +-- processed/                  → Ready for ERP
    │   +-- invoice1.pdf
    │   +-- invoice1.json
    │   +-- invoice2.pdf
    │   +-- invoice2.json
    │
    +-- needs_review/               ⚠ Manual review needed (critical field low confidence)
    │   +-- invoice3.pdf
    │   +-- invoice3.json
    │   +-- invoice3_REVIEW_NOTE.txt (explains issues)
    │
    +-- validation_failed/          ❌ Validation failed (math/amount issues)
    │   +-- invoice4.pdf
    │   +-- invoice4.json
    │   +-- invoice4_VALIDATION_NOTE.txt (explains issues)
    │
    +-- daily_summaries/
        +-- invoices_2026-07-26.csv
        +-- invoices_2026-07-27.csv
        +-- ...
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
  "tax_confidence": "high",
  "shippingCost": 0.00,
  "shippingCost_confidence": "high",
  "totalAmount": 1000.00,
  "totalAmount_confidence": "high",
  
  "trackingNumber": "123456789",
  "trackingNumber_confidence": "high",
  "carrier": "FedEx",
  "carrier_confidence": "high",
  
  "needsHumanReview": false,
  "reviewReason": null
}
```

## Confidence Scoring

The AI evaluates each field and assigns a confidence level:

| Level | Meaning |
|---|---|
| **high** | Field was clearly found, not empty, and unambiguous |
| **medium** | Field was inferred or partially matched |
| **low** | Field is missing, null, empty, or could not be found |

### Routing Rules

Only **critical fields** (from `CRITICAL_CONFIDENCE_FIELDS`) affect routing:
- **ALL critical fields = "high"** → `processed/` folder
- **ANY critical field ≠ "high"** → `needs_review/` folder + REVIEW_NOTE.txt
- **Non-critical fields** can have any confidence level without affecting routing

**Example:**
```env
CRITICAL_CONFIDENCE_FIELDS=invoiceNumber,totalAmount,vendor
```

In this case:
- ✅ Missing PO number? Still goes to `processed/` (not critical)
- ✅ Empty tax field? Still goes to `processed/` (not critical)
- ❌ Missing vendor? Goes to `needs_review/` (is critical)
- ❌ Unclear total amount? Goes to `needs_review/` (is critical)

## Amount Validation (Optional)

When `npm start --validate` is used, additional checks run **only for high-confidence invoices**:

### Validation Checks

- **Range**: Amount is between $0.01 and $10,000,000
- **Math**: subtotal + tax + shipping = total (within $1 tolerance)
- **Line Items**: Sum of line items matches subtotal
- **No Negatives**: All amounts are positive or zero

### Validation Routing

- **High confidence + Valid amounts** → `processed/`
- **High confidence + Invalid amounts** → `validation_failed/` + VALIDATION_NOTE.txt
- **Low confidence** → `needs_review/` (validation skipped)

### Configuration

Edit `.env` to customize validation thresholds:

```env
GITHUB_TOKEN=github_pat_...
MIN_AMOUNT=0.01              # Minimum invoice amount (dollars)
MAX_AMOUNT=10000000          # Maximum invoice amount (dollars)
TOLERANCE=1.0                # Tolerance for math checks (dollars)
```

### Example Validation Output

When validation fails, invoices go to `validation_failed/` with a VALIDATION_NOTE.txt:

```
INVOICE FLAGGED FOR REVIEW
=====================================
Invoice #: INV-2025-0001
Date: 2026-07-26T16:00:00Z
Reason: Validation Failed

Issues Found:
  ⚠ Math mismatch: subtotal ($1000) + tax ($100) + shipping ($0) = $1100, but total is $1099.99 (diff: $0.01)
  ⚠ Line items sum ($950) does not match subtotal ($1000)

Next Steps:
1. Review the JSON file for accuracy
2. Verify amounts in the PDF
3. Fix line item totals if needed
4. Move to ../processed/ once corrected
```

## Daily Summary CSV

The CSV includes all invoices processed that day:

```csv
fileName,invoiceNumber,invoiceDate,dueDate,paymentTerms,vendorName,...,invoiceNumber_confidence,totalAmount_confidence,vendor_confidence,...,validationPassed,status
invoice1.pdf,20031881,17-APR-2025,17-MAY-2025,Net 30,BRANSON CORP,...,high,high,high,...,n/a,processed
invoice2.pdf,US689178,09-Jun-2025,16-Jul-2025,Net 30,Tektronix Inc,...,high,high,high,...,n/a,processed
```

Columns include:
- `validationPassed`: "true", "false", or "n/a" (if validation not run)
- `status`: "processed", "needs_review", "validation_failed", or "error"

Useful for:
- Daily audit trails
- Tracking extraction success rates
- Reconciliation with ERP uploads

## Handling Needs Review

Invoices in `needs_review/` contain a `REVIEW_NOTE.txt` file explaining which critical fields failed:

```
INVOICE FLAGGED FOR REVIEW
=====================================
Invoice #: US689178
Date: 2026-07-26T16:00:00Z
Reason: Low Confidence on Critical Fields

Issues Found:
  ⚠ purchaseOrderNumber: low confidence
  📝 Note: purchaseOrderNumber is missing.

Next Steps:
1. Review the JSON file for accuracy
2. Compare invoice PDF against extracted data
3. Once verified, move this folder to ../processed/
```

**To approve and move to processed:**
1. Review the invoice and JSON
2. Manually fix any errors in the JSON if needed
3. Move the folder from `needs_review/` to `processed/`

## Cleanup Script

To reset everything and test from scratch:

```bash
npm run cleanup
```

This removes all:
- PDFs in `input/`
- Files in `output/processed/`
- Files in `output/needs_review/`
- Files in `output/validation_failed/`
- Files in `output/daily_summaries/`

Ready for a fresh test run!

## Cost

**GitHub Models Free Tier:**
- ~150 requests/day
- ~250,000 tokens/day
- Cost: $0

**Typical usage:**
- 3 invoices ≈ 11,000 tokens
- 1 large invoice (25k chars) ≈ 3,000 tokens (truncated)

## Limitations

- Large invoices (>12k chars) are truncated to prevent token limits
- AI extraction quality depends on PDF legibility and format consistency
- Confidence scoring is AI-based, not a formal algorithm
- Validation checks are based on heuristics and may have tolerance issues

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

**"Invoices going to needs_review when I don't expect it"**
- Check your `CRITICAL_CONFIDENCE_FIELDS` setting in `.env`
- The invoice has low confidence on one of those critical fields
- Review the REVIEW_NOTE.txt to see which fields failed

**"How do I make validation stricter/looser"**
- Edit `.env` and adjust `MIN_AMOUNT`, `MAX_AMOUNT`, and `TOLERANCE`
- Or change which fields are critical in `CRITICAL_CONFIDENCE_FIELDS`

## License

ISC
