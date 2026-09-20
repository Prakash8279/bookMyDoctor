/**
 * OpenAPI/Swagger scaffold. Responsibility: build the OpenAPI spec object from JSDoc `@openapi`
 * comment blocks scattered across the route files, and export it so app.js can mount
 * swagger-ui-express with it. This module does NOT decide whether/where the UI is served —
 * that's app.js's job (gated on `!env.isProduction`, see app.js's mount-point comment) — this
 * file only builds the spec.
 *
 * This codebase has zero API documentation today. Rather than attempt to hand-write a full spec
 * (which drifts from the real routes the moment either changes), swagger-jsdoc generates it from
 * `@openapi` blocks living directly above each route definition — see auth.routes.js for a
 * complete worked example (register/login/refresh/me) other modules can copy the same pattern
 * from. Coverage is intentionally partial for now: only auth.routes.js is annotated. Every other
 * module's routes simply don't contribute any paths to the generated spec yet, which is a safe,
 * additive gap (swagger-jsdoc silently skips files with no `@openapi` blocks) rather than a
 * broken one — annotate more routers the same way to grow it over time.
 */
const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const env = require('./env');

const swaggerDefinition = {
  openapi: '3.0.3',
  info: {
    title: 'BookMyDoctor24 API',
    version: '1.0.0',
    description:
      'BookMyDoctor24 backend API (auth, appointments, clinics, payments, and related modules). ' +
      'This spec is generated from `@openapi` JSDoc comments in src/modules/**/*.routes.js — see ' +
      'auth.routes.js for the worked example other modules should follow. Coverage grows as more ' +
      'routers are annotated; an endpoint missing here simply hasn\'t been documented yet, not ' +
      'necessarily missing from the API.',
  },
  servers: [
    {
      // Matches the app's own PORT default/config (config/env.js) — a relative dev convenience,
      // not a claim about where this spec is actually being served from in any given environment.
      url: `http://localhost:${env.port}`,
      description: 'Local development server',
    },
  ],
  components: {
    securitySchemes: {
      // Every authenticated route in this app expects `Authorization: Bearer <accessToken>`
      // (see middleware/authenticate.js) — never a cookie, matching app.js's CORS `credentials:
      // false` comment. Declared once here and referenced per-operation via `security:
      // [{ bearerAuth: [] }]` rather than applied globally, since public routes (login, register,
      // refresh, health) must NOT show a padlock implying they require a token.
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      // Shared shapes referenced via $ref from multiple operations' JSDoc blocks, so the error
      // envelope (utils/apiResponse.js#fail) and validation envelope only need to be defined once.
      ApiError: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'INVALID_CREDENTIALS' },
              message: { type: 'string', example: 'Invalid email or password.' },
              details: {
                type: 'array',
                nullable: true,
                items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } },
              },
            },
          },
        },
      },
    },
  },
};

const options = {
  definition: swaggerDefinition,
  // Globbed against every module's route file. Deliberately scoped to `*.routes.js` only (not
  // `*.controller.js`/`*.service.js`) — this is where this codebase's own header-comment
  // convention already documents each route's method/path/roles, so `@openapi` blocks live
  // alongside that, not scattered into files that have nothing to do with the HTTP surface.
  apis: [path.join(__dirname, '..', 'modules', '**', '*.routes.js').replace(/\\/g, '/')],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
