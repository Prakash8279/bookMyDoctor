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
  if (!normalized) return false;
  if (allowedOrigins && allowedOrigins.has(normalized)) return true;
  try {
    const url = new URL(normalized);
    if (
      url.hostname.endsWith('bookadoctors.com') ||
      url.hostname.endsWith('bookmydoctors.me') ||
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname)
    ) {
      return true;
    }
  } catch (_err) {
    // ignore
  }
  return false;
}

module.exports = { normalizeOrigin, buildAllowedOriginSet, isAllowedOrigin };
