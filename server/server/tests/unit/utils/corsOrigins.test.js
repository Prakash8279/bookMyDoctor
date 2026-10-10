const { buildAllowedOriginSet, isAllowedOrigin } = require('../../../src/utils/corsOrigins');

describe('CORS origin allow-list', () => {
  test('allows only exact configured origins after URL normalization', () => {
    const allowed = buildAllowedOriginSet('https://app.example.com/, http://localhost:5173');

    expect(isAllowedOrigin('https://app.example.com', allowed)).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173', allowed)).toBe(true);
    expect(isAllowedOrigin('https://localhost.attacker.example', allowed)).toBe(false);
    expect(isAllowedOrigin('https://app.example.com.attacker.example', allowed)).toBe(false);
  });

  test('permits requests with no Origin header for native mobile clients and command-line health checks', () => {
    expect(isAllowedOrigin(undefined, buildAllowedOriginSet('https://app.example.com'))).toBe(true);
  });
});
