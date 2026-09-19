/**
 * Integration test for config/swagger.js — the new OpenAPI scaffold (item 3 of this fix group) —
 * using supertest against a minimal standalone Express app, rather than the real src/app.js.
 *
 * Why not require src/app.js directly: app.js pulls in routes/index.js, which mounts every
 * module's router, several of which open REAL connections at require-time — middleware/
 * rateLimiter.js instantiates a RedisStore against config/redis.js's ioredis client, and
 * jobs/bookingQueue.js opens a second ioredis connection for BullMQ — the instant those modules
 * are required, regardless of whether any route is ever hit. None of that infrastructure exists
 * in this sandbox (no test DB, no test Redis — see tests/setupEnv.js's header comment), and
 * faithfully mocking every one of those modules just to prove `/api-docs` responds would test the
 * mocks far more than it tests config/swagger.js itself. Instead this test builds the smallest
 * real Express app that mounts swagger-ui-express with the ACTUAL generated spec, exactly the way
 * app.js's own `if (!env.isProduction) { app.use('/api-docs', swaggerUi.serve, ...) }` block
 * does (see app.js's mount-point comment) — real config/swagger.js output, real swagger-ui-
 * express, real HTTP round-trip via supertest, just without the unrelated infra cascade.
 */
const express = require('express');
const request = require('supertest');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('../../src/config/swagger');

function buildDocsOnlyApp() {
  const app = express();
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  // Also expose the raw JSON, the same way an operator could point an external tool (Postman,
  // Redoc, a contract-testing job) at it without scraping the rendered HTML page.
  app.get('/api-docs.json', (req, res) => res.json(swaggerSpec));
  return app;
}

describe('config/swagger.js generated spec', () => {
  test('carries the expected API title/version and at least one real @openapi-annotated path', () => {
    expect(swaggerSpec.info.title).toBe('BookMyDoctor24 API');
    expect(swaggerSpec.info.version).toBe('1.0.0');

    // auth.routes.js is the worked example annotated in this fix group (register/login/refresh/
    // me) — swagger-jsdoc must have actually picked up its @openapi blocks via the apis glob.
    expect(swaggerSpec.paths).toHaveProperty('/auth/login');
    expect(swaggerSpec.paths['/auth/login']).toHaveProperty('post');
    expect(swaggerSpec.paths['/auth/login'].post.responses).toHaveProperty('200');
    expect(swaggerSpec.paths['/auth/login'].post.responses).toHaveProperty('401');

    expect(swaggerSpec.paths).toHaveProperty('/auth/register');
    expect(swaggerSpec.paths).toHaveProperty('/auth/refresh');
    expect(swaggerSpec.paths).toHaveProperty('/auth/me');
    // /auth/me is the one annotated route that actually requires a bearer token — confirms the
    // securitySchemes wiring in config/swagger.js reached the generated operation.
    expect(swaggerSpec.paths['/auth/me'].get.security).toEqual([{ bearerAuth: [] }]);
  });
});

describe('GET /api-docs (Swagger UI mount)', () => {
  test('serves the Swagger UI HTML page', async () => {
    const app = buildDocsOnlyApp();

    // swagger-ui-express's root serves a redirect to an index page carrying the trailing slash;
    // supertest follows redirects by default via superagent, so this lands on the real HTML page.
    const res = await request(app).get('/api-docs/');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('swagger-ui');
  });

  test('GET /api-docs.json returns the raw spec with the annotated auth paths', async () => {
    const app = buildDocsOnlyApp();

    const res = await request(app).get('/api-docs.json');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.info.title).toBe('BookMyDoctor24 API');
    expect(res.body.paths).toHaveProperty('/auth/login');
  });
});
