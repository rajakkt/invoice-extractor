// Validation rules for invoice amounts
const DEFAULT_RULES = {
  minAmount: 0.01,
  maxAmount: 10000000,
  tolerance: 1.0 // $1 tolerance for math checks
};

function validateAmounts(data, rules = DEFAULT_RULES) {
  const issues = [];

  // Check totalAmount exists and is a number
  if (data.totalAmount === null || data.totalAmount === undefined) {
    issues.push("Total amount is missing");
    return { valid: false, issues };
  }

  if (typeof data.totalAmount !== "number") {
    issues.push(`Total amount is not a number: ${data.totalAmount}`);
    return { valid: false, issues };
  }

  // Check if negative
  if (data.totalAmount < 0) {
    issues.push(`Total amount is negative: $${data.totalAmount}`);
  }

  // Check if zero
  if (data.totalAmount === 0) {
    issues.push("Total amount is zero");
  }

  // Check if within reasonable range
  if (data.totalAmount < rules.minAmount) {
    issues.push(`Total amount below minimum ($${rules.minAmount}): $${data.totalAmount}`);
  }

  if (data.totalAmount > rules.maxAmount) {
    issues.push(`Total amount exceeds maximum ($${rules.maxAmount}): $${data.totalAmount}`);
  }

  // Math check: subtotal + tax = total (with tolerance)
  const subtotal = data.subtotal ?? 0;
  const tax = data.tax ?? 0;
  const shipping = data.shippingCost ?? 0;
  const calculatedTotal = subtotal + tax + shipping;
  const difference = Math.abs(calculatedTotal - data.totalAmount);

  if (difference > rules.tolerance) {
    issues.push(
      `Math mismatch: subtotal ($${subtotal}) + tax ($${tax}) + shipping ($${shipping}) = $${calculatedTotal}, but total is $${data.totalAmount} (diff: $${difference.toFixed(2)})`
    );
  }

  // Line items validation
  if (data.lineItems && data.lineItems.length > 0) {
    const lineItemsTotal = data.lineItems.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
    const lineItemDiff = Math.abs(lineItemsTotal - subtotal);

    if (lineItemDiff > rules.tolerance) {
      issues.push(
        `Line items sum ($${lineItemsTotal.toFixed(2)}) does not match subtotal ($${subtotal}) (diff: $${lineItemDiff.toFixed(2)})`
      );
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

module.exports = { validateAmounts, DEFAULT_RULES };
