const DEFAULT_RULES = {
  minAmount: 0.01,
  maxAmount: 10000000,
  tolerance: 1.0
};

function validateAmounts(data, rules = DEFAULT_RULES) {
  const issues = [];

  if (data.totalAmount === null || data.totalAmount === undefined) {
    issues.push("Total amount is missing");
    return { valid: false, issues };
  }

  if (typeof data.totalAmount !== "number") {
    issues.push(`Total amount is not a number: ${data.totalAmount}`);
    return { valid: false, issues };
  }

  if (data.totalAmount <= 0) {
    // FIX: merged zero and negative checks — was reporting two issues for zero
    issues.push(`Total amount must be greater than zero: $${data.totalAmount}`);
  } else if (data.totalAmount < rules.minAmount) {
    issues.push(`Total amount below minimum ($${rules.minAmount}): $${data.totalAmount}`);
  } else if (data.totalAmount > rules.maxAmount) {
    issues.push(`Total amount exceeds maximum ($${rules.maxAmount}): $${data.totalAmount}`);
  }

  // Math check: subtotal + tax + shipping = total
  const subtotal = data.subtotal ?? 0;
  const tax = data.tax ?? 0;
  const shipping = data.shippingCost ?? 0;
  const calculatedTotal = subtotal + tax + shipping;
  const difference = Math.abs(calculatedTotal - data.totalAmount);

  if (difference > rules.tolerance) {
    issues.push(
      `Math mismatch: subtotal ($${subtotal}) + tax ($${tax}) + shipping ($${shipping}) = $${calculatedTotal.toFixed(2)}, but total is $${data.totalAmount} (diff: $${difference.toFixed(2)})`
    );
  }

  // Line items sum vs subtotal
  if (data.lineItems && data.lineItems.length > 0) {
    const lineItemsTotal = data.lineItems.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
    const lineItemDiff = Math.abs(lineItemsTotal - subtotal);

    if (lineItemDiff > rules.tolerance) {
      issues.push(
        `Line items sum ($${lineItemsTotal.toFixed(2)}) does not match subtotal ($${subtotal}) (diff: $${lineItemDiff.toFixed(2)})`
      );
    }
  }

  return { valid: issues.length === 0, issues };
}

module.exports = { validateAmounts, DEFAULT_RULES };
