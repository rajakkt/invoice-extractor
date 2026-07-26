# Invoice PDF Extractor

Reads invoice PDFs and extracts structured data (invoice number, dates, vendor, line items, totals, etc.) using GPT-4o-mini. Saves results as JSON and CSV.

## Setup

1. **Install dependencies** (already done if you cloned this):
   ```
   npm install
   ```

2. **Add your OpenAI API key:**
   ```
   copy .env.example .env
   ```
   Then open `.env` and replace `sk-...your-key-here...` with your real key from https://platform.openai.com/api-keys

## Usage

1. Drop your invoice PDF(s) into the `input/` folder
2. Run:
   ```
   npm start
   ```
3. Results appear in `output/`:
   - One `.json` file per invoice with all extracted fields
   - `invoices.csv` with one row per invoice (summary columns)

## Fields Extracted

| Field | Description |
|---|---|
| invoiceNumber | Invoice # |
| invoiceDate | Date of invoice |
| dueDate | Payment due date |
| paymentTerms | e.g. "Net 30" |
| vendor | Supplier name + address |
| billTo / shipTo | Customer billing and shipping info |
| purchaseOrderNumber | PO # |
| lineItems | Part #, description, qty, unit price, total |
| subtotal / tax / shippingCost / totalAmount | Monetary totals |
| trackingNumber / carrier | Shipping info |

## Cost

Using GPT-4o-mini: approximately **$0.001 per invoice** (very cheap).
