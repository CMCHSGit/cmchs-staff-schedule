/**
 * Categorizes a location string for color coding, shared by Team view
 * (badge colors) and My schedule (input tinting) so they can't drift out
 * of sync. Matches the company's existing Excel color convention: only
 * Leave, Non-Working Days, and Customer Calls/On Call are highlighted —
 * everything else (Cass Office, Remote Support alone, travel, etc.) is
 * left uncolored, even when combined ("Cass Office / Customer Calls" is
 * still yellow because it contains "Customer Calls").
 */
export function locClass(val) {
  if (!val) return 'loc-blank'
  const v = val.toLowerCase()
  if (v.includes('leave')) return 'loc-leave'
  if (v.includes('non working') || v.includes('non-working') || v.includes('nonwork')) return 'loc-nonwork'
  if (v.includes('customer call') || v.includes('on call') || v.includes('oncall')) return 'loc-special'
  return 'loc-default'
}
