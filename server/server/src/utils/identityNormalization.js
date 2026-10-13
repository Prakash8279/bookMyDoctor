/**
 * Canonical identity values used everywhere a User row is created or looked up.
 * Keeping these rules in one place is important: a unique database column only prevents
 * duplicates when every caller stores the same logical value in the same representation.
 */
function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function getPhoneSearchVariants(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];
  return [
    { phone: normalized },
    { phone: `+91${normalized}` },
    { phone: `+91 ${normalized}` },
    { phone: `0${normalized}` },
    { phone: `91${normalized}` },
  ];
}

module.exports = { normalizeEmail, normalizePhone, getPhoneSearchVariants };
