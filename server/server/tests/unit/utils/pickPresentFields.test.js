/**
 * Unit tests for utils/pickPresentFields.js — shared helper used across most PATCH endpoints in
 * this codebase to build the Prisma `data` object from a request body. Two behaviors matter here
 * and are exactly what the file's own header comment calls out as easy to get wrong:
 *   (1) a field sent as explicit JSON `null` counts as "present" (checked via hasOwnProperty,
 *       not `!= null`), matching express-validator's optional() semantics;
 *   (2) a NOT-NULL-column field sent as explicit null must be rejected with a clean 422 instead
 *       of reaching Prisma as a raw null — which the header comment says otherwise becomes
 *       either an unhandled 500, or (worse) the literal string "null" silently persisted.
 *
 * NOTE on scope: this test substitutes for the "appointment fee/GST calculation" candidate named
 * in this fix group's brief. That logic (appointments.service.js lines ~548-565) is NOT a
 * standalone pure/exported function — it's inlined inside runBookingJob, which also needs a live
 * Postgres transaction, several other DB lookups (doctorProfile, clinic hours/closures, family
 * member ownership, etc.), lockService, and BullMQ wiring, all before the fee math ever runs.
 * appointments.service.js is outside this fix group's file scope, so it can't be refactored to
 * expose the calculation as an isolated pure function either. pickPresentFields.js was chosen
 * instead as a real, security-relevant, pure, already-exported piece of high-risk logic that
 * needs no DB — matching the brief's own stated preference for exactly that shape of test target.
 */
const { pickPresentFields } = require('../../../src/utils/pickPresentFields');
const ApiError = require('../../../src/utils/ApiError');

describe('pickPresentFields', () => {
  test('picks only the allowed fields that are actually present on the body', () => {
    const body = { name: 'Dr. Rao', bio: 'Cardiologist', unrelatedField: 'ignored' };

    const result = pickPresentFields(body, ['name', 'bio', 'consultationFee']);

    expect(result).toEqual({ name: 'Dr. Rao', bio: 'Cardiologist' });
    expect(result).not.toHaveProperty('unrelatedField');
    expect(result).not.toHaveProperty('consultationFee'); // never sent at all -> absent, not undefined-valued
  });

  test('treats an explicit JSON null as "present" for a nullable field, not "absent"', () => {
    const result = pickPresentFields({ bio: null }, ['bio']);

    expect(result).toHaveProperty('bio', null);
  });

  test('throws a 422 VALIDATION_ERROR when a non-nullable field is explicitly set to null', () => {
    const body = { name: null };

    expect(() => pickPresentFields(body, ['name'], ['name'])).toThrow(ApiError);

    try {
      pickPresentFields(body, ['name'], ['name']);
      throw new Error('expected pickPresentFields to throw, it did not');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.details).toEqual([{ field: 'name', message: 'name cannot be null.' }]);
    }
  });

  test('a non-nullable field that is simply absent from the body does not throw', () => {
    const result = pickPresentFields({}, ['name'], ['name']);

    expect(result).toEqual({});
  });

  test('a null value on a field NOT listed as non-nullable passes through untouched', () => {
    const result = pickPresentFields({ phone: null }, ['phone'], ['name']); // 'phone' isn't in nonNullableFields

    expect(result).toEqual({ phone: null });
  });

  test('inherited/prototype properties are never picked up (hasOwnProperty guard, not `in`)', () => {
    const body = Object.create({ inherited: 'should never appear' });
    body.own = 'value';

    const result = pickPresentFields(body, ['own', 'inherited']);

    expect(result).toEqual({ own: 'value' });
  });
});
