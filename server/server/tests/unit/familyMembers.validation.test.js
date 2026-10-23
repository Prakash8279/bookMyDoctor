const { validationResult } = require('express-validator');
const { create, update } = require('../../src/modules/familyMembers/familyMembers.validation');

const valid = { name: 'Rohan', relation: 'Son', dateOfBirth: '2010-05-01', gender: 'Male', bloodGroup: 'B+' };
async function errors(chains, body) {
  const req = { body: { ...body }, params: { id: '7c3c0607-989c-4709-a586-9d9ac026fb76' } };
  for (const chain of chains) await chain.run(req);
  return validationResult(req).array();
}
test.each(['name', 'relation', 'dateOfBirth', 'gender', 'bloodGroup'])('%s is compulsory when adding a member', async (field) => {
  for (const value of [undefined, null, '', '   ']) {
    expect(await errors(create, { ...valid, [field]: value })).toEqual(expect.arrayContaining([expect.objectContaining({ path: field })]));
  }
});
test('accepts complete details and an explicitly unknown blood group', async () => {
  expect(await errors(create, valid)).toEqual([]);
  expect(await errors(create, { ...valid, bloodGroup: 'Unknown' })).toEqual([]);
});
test.each(['2999-01-01', '2020-02-31', 'not-a-date'])('rejects invalid/future date %s', async (dateOfBirth) => {
  expect(await errors(create, { ...valid, dateOfBirth })).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'dateOfBirth' })]));
});
test.each(['dateOfBirth', 'gender', 'bloodGroup'])('cannot clear %s on update', async (field) => {
  for (const value of [null, '', '   ']) expect((await errors(update, { [field]: value })).length).toBeGreaterThan(0);
});
test('keeps partial updates supported without permitting explicit empty values', async () => {
  expect(await errors(update, { name: 'Updated name' })).toEqual([]);
});
test('accepts today in India even before midnight UTC', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-20T20:00:00Z'));
  try {
    expect(await errors(create, { ...valid, dateOfBirth: '2026-10-21' })).toEqual([]);
    expect((await errors(create, { ...valid, dateOfBirth: '2026-10-22' })).length).toBeGreaterThan(0);
  } finally { jest.useRealTimers(); }
});
