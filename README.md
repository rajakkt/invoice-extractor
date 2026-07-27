# Invoice Extractor

AI-powered invoice PDF extractor using GitHub Models (gpt-4o-mini) with **positional PDF extraction** (pdfjs-dist). Extracts structured invoice data with confidence scoring and automatic categorization for processing or manual review.

> **Branch:** `v2-positional` — uses coordinate-aware PDF extraction for higher accuracy.
> See `main` branch for the original version.

## Features

- **AI-Powered Extraction**: Uses GPT-4o-mini to intelligently extract invoice data from any PDF format
- **Positional PDF Extraction**: Uses pdfjs-dist to extract text with (x,y) coordinates — reconstructs label-value pairs on the same row as `Label:\tValue`
- **Confidence Scoring**: Each extracted field gets a confidence rating (high/medium/low)
- **Smart Retry**: Low-confidence critical fields are automatically re-queried with a focused prompt
- **Deterministic Validation**: Post-process checks catch known AI errors (e.g. invoice number copied to PO field)
- **Configurable Critical Fields**: Choose which fields must be "high" confidence to route to processed/
- **Smart Routing**: Automatically sorts invoices based on critical field confidence
- **Amount Validation**: Optional math/range checks with `--validate` flag
- **Daily Summaries**: Timestamped CSV reports, appends across multiple runs per day
- **No Database Required**: File-based workflow — folder structure is the state machine
- **Audit Trail**: PDF + JSON pairs saved together, REVIEW_NOTE.txt for flagged invoices
- **GitHub Models Free Tier**: Uses GPT-4o on GitHub Models free tier (~- **Cost-Effective**: Uses GitHub Models free tier (~$0 cost for typical volumes) for typical volumes on free tier)

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

### Validation Thresholds

Used only when running `npm start --validate`:

```env
MIN_AMOUNT=0.01        # Minimum invoice amount (dollars)
MAX_AMOUNT=10000000    # Maximum invoice amount (dollars)
TOLERANCE=1.0          # Tolerance for math checks (dollars)
```

## Usage

### Run Extraction

```bash
npm start
```

**What happens:**
1. Reads all PDFs from `input/` folder
2. Pre-processes extracted text (strips noise, barcodes, garbage lines)
3. Extracts structured data using AI (gpt-4o-mini)
4. Runs deterministic post-process checks (e.g. invoice number ≠ PO number)
5. Retries any critical fields with low confidence using a focused second AI call
6. Routes invoices based on confidence:
   - **All critical fields "high"** → `output/processed/`
   - **Any critical field not "high"** → `output/needs_review/`
7. Generates daily CSV summary (appends if run multiple times per day)
8. Deletes PDFs from `input/` after processing (errors go to `needs_review/`)

### Run with Validation

```bash
npm start --validate
```

Adds amount math and range checks. Only runs for invoices that already passed confidence checks.

### Cleanup

```bash
npm run cleanup
```

Empties all output folders and `input/` for a fresh test run.

## Folder Structure

```
invoice-extractor/
+-- input/                          → Drop PDFs here
│   +-- (empty after processing)
│
+-- output/
    +-- processed/                  → Ready for ERP
    │   +-- invoice1.pdf
    │   +-- invoice1.json
    │
    +-- needs_review/               ⚠ Manual review needed
    │   +-- invoice2.pdf
    │   +-- invoice2.json
    │   +-- invoice2_REVIEW_NOTE.txt
    │
    +-- validation_failed/          ❌ Amount validation failed
    │   +-- invoice3.pdf
    │   +-- invoice3.json
    │   +-- invoice3_REVIEW_NOTE.txt
    │
    +-- daily_summaries/
        +-- invoices_2026-07-26.csv
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
  "vendor": { "name": "BRANSON ULTRASONICS CORP.", "address": "120 Park Ridge Road..." },
  "vendor_confidence": "high",
  "billTo": { "name": "HISCO INC", "address": "..." },
  "shipTo": { "name": "HISCO INC", "address": "..." },
  "purchaseOrderNumber": "260425",
  "purchaseOrderNumber_confidence": "high",
  "currency": "USD",
  "lineItems": [
    {
      "lineNumber": "1",
      "partNumber": "1100-410-168",
      "description": "A82-3 B8210 PERF TRAY",
      "quantity": 1,
      "unitPrice": 193.99,
      "totalPrice": 193.99,
      "uom": "Each"
    }
  ],
  "subtotal": 2101.22,
  "subtotal_confidence": "high",
  "tax": null,
  "tax_confidence": "low",
  "shippingCost": null,
  "shippingCost_confidence": "low",
  "totalAmount": 2101.22,
  "totalAmount_confidence": "high",
  "trackingNumber": "610814762069",
  "trackingNumber_confidence": "high",
  "carrier": "FEDEX-PARCEL-INTRA US - GROUND",
  "carrier_confidence": "high",
  "needsHumanReview": false,
  "reviewReason": null
}
```

## How Extraction Works

### Step 1 - Render PDF Pages to Images

`pdfjs-dist` renders each PDF page to a PNG image at 2x scale (~150 DPI). Images are automatically scaled down if they exceed 4 MB. Multi-page invoices produce one image per page, all sent together.

### Step 2 - GPT-4o Vision Extraction

All page images are sent to GPT-4o in a single API call. GPT-4o reads the visual layout -- tables, column alignment, bold headers, indented fields -- exactly as a human would. The system prompt is minimal since GPT-4o handles layout natively:
- `invoiceNumber` = seller's ID, `purchaseOrderNumber` = buyer's PO -- always different
- `invoiceDate` = issue date, not ship date or order date
- Confidence rules: null/empty fields always get `low` confidence

### Step 3 - Deterministic Post-processing

Code checks that don't need AI:
- If `invoiceNumber === purchaseOrderNumber`, the PO is set to `null/low` (known AI misread pattern)

### Step 4 - Retry Low-Confidence Fields

If any critical field comes back with less than `high` confidence, a second focused GPT-4o vision call is made for only those fields. If the retry returns `high` confidence, the result is merged in. If not, the invoice routes to `needs_review/`.

## Confidence Scoring## Confidence Scoring

| Level | Meaning |
|---|---|
| **high** | Field clearly found, not empty, unambiguous |
| **medium** | Field inferred or partially matched |
| **low** | Field missing, null, empty, or not found |

### Routing Rules

Only **critical fields** affect routing:
- **ALL critical fields = "high"** → `processed/`
- **ANY critical field ≠ "high"** (after retry) → `needs_review/`

## Amount Validation (`--validate`)

When enabled, checks high-confidence invoices for:

| Check | Rule |
|---|---|
| Range | $0.01 ≤ total ≤ $10,000,000 |
| Math | subtotal + tax + shipping = total (within $1 tolerance) |
| Line items | Sum of line item totals ≈ subtotal |

Failed invoices go to `validation_failed/` with a REVIEW_NOTE.txt explaining the issues.

## Daily Summary CSV

Appends a row per invoice to `output/daily_summaries/invoices_YYYY-MM-DD.csv`. Running multiple times per day accumulates all results in one file.

Columns: `fileName`, `invoiceNumber`, `invoiceDate`, `dueDate`, `paymentTerms`, `vendorName`, `currency`, `subtotal`, `tax`, `totalAmount`, `purchaseOrderNumber`, `invoiceNumber_confidence`, `totalAmount_confidence`, `vendor_confidence`, `purchaseOrderNumber_confidence`, `trackingNumber`, `validationPassed`, `status`, `error`

## Handling Needs Review

When an invoice goes to `needs_review/`, a `REVIEW_NOTE.txt` is created:

```
INVOICE FLAGGED FOR REVIEW
=====================================
Invoice #: US689178
Date: 2026-07-26T22:00:00Z
Reason: Low Confidence on Critical Fields

Issues Found:
  ⚠ purchaseOrderNumber: low confidence
  📝 Note: purchaseOrderNumber is missing.

Next Steps:
1. Review the JSON file for accuracy
2. Compare invoice PDF against extracted data
3. Once verified, move this folder to ../processed/
```

To approve: fix the JSON if needed, then move the folder to `processed/`.

## Version Comparison

Three branches are available, each using a different approach to extraction:

| | `main` (v1) | `v2-positional` | `v3-vision` (this branch) |
|---|---|---|---|
| **PDF extraction** | pdf-parse (raw text) | pdfjs-dist (x,y coords) | pdfjs-dist (render to PNG) |
| **AI model** | gpt-4o-mini | gpt-4o-mini | **gpt-4o** (vision) |
| **Reads layout** | Flat text stream | Reconstructs rows via coords | Sees it visually |
| **Two-column PDFs** | Prompt workarounds needed | Tab-separated rows | Native visual understanding |
| **Table columns** | May merge (e.g. `1193.99193.99`) | Preserved via X coords | Reads table cells directly |
| **Scanned PDFs** | No (empty text) | No (empty text) | Yes |
| **Prompt complexity** | High (5 rule sections) | Medium | Minimal |
| **Accuracy** | Good | Better | Best |

## Cost

| | `main` (v1) | `v2-positional` | `v3-vision` (this branch) |
|---|---|---|---|
| **GitHub Models free tier** | ~150 req/day | ~150 req/day | ~150 req/day |
| **Cost on free tier** | $0 | $0 | $0 |
| **API calls per invoice** | 1-2 | 1-2 | 1-2 |
| **Tokens per invoice** | ~3k-8k tokens | ~3k-8k tokens | ~1k tokens + image |
| **Cost if paid (per invoice)** | ~$0.001 | ~$0.001 | ~$0.01-0.03 |

> **Free tier is sufficient** for typical AP automation volumes. If you exceed it, GPT-4o vision charges per image -- roughly $0.002-0.006 per page image. A 3-page invoice costs ~$0.01-0.02. GPT-4o-mini text (v1/v2) is ~10-20x cheaper per call but less accurate on complex layouts.

## Limitations## Limitations


- AI confidence scoring is AI-based judgment, not a formal algorithm
- Very long PDFs (many pages) will take longer and use more image tokens

## Next Steps

- **ERP Integration**: Send `processed/` invoices to Infor Vendor Invoice Center
- **Email Automation**: Auto-download invoices from Outlook
- **PO Matching**: 2-way/3-way matching against Purchase Orders in ERP

## Troubleshooting

| Problem | Solution |
|---|---|
| `ERROR: Set your GITHUB_TOKEN` | Check `.env` exists and token has `models` scope |
| `No PDF files in input/` | Drop PDFs into `input/` folder first |
| `Long PDF truncated` | Normal — first 8k + last 4k chars kept |
| Invoice goes to `needs_review` unexpectedly | Check REVIEW_NOTE.txt to see which critical field failed |
| Validation fails on valid invoice | Check REVIEW_NOTE.txt for math details; adjust `TOLERANCE` in `.env` |
| Extraction returns empty text | PDF may be encrypted or corrupted — check the file opens normally in a PDF viewer |

## License

ISC
