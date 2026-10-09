'use strict';

function normalizeOrigin(value) {
  try {
    const parsed = new URL(String(value).trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.origin;
  } catch (_err) {
    return null;
  }
}

function buildAllowedOriginSet(configuredValue) {
  return new Set(
    String(configuredValue || '')
      .split(',')
      .map(normalizeOrigin)
      .filter(Boolean)
  );
}

function isAllowedOrigin(origin, allowedOrigins) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  return Boolean(normalized && allowedOrigins.has(normalized));
}

module.exports = { normalizeOrigin, buildAllowedOriginSet, isAllowedOrigin };
