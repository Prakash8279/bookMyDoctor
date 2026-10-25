jest.mock('../../../src/config/db', () => ({
  user: { count: jest.fn() },
  clinic: { count: jest.fn() },
  appointment: { count: jest.fn() },
  review: { aggregate: jest.fn() },
}));
jest.mock('../../../src/services/cacheService', () => ({
  getOrSet: jest.fn((_key, _ttl, fetch) => fetch()),
}));

const prisma = require('../../../src/config/db');
const { getPublicStats } = require('../../../src/modules/publicStats/publicStats.service');

beforeEach(() => jest.clearAllMocks());

test('counts only public doctors, active clinics and confirmed bookings', async () => {
  prisma.user.count.mockResolvedValue(2);
  prisma.clinic.count.mockResolvedValue(3);
  prisma.appointment.count.mockResolvedValue(14);
  prisma.review.aggregate.mockResolvedValue({ _avg: { rating: 4.666 }, _count: { rating: 3 } });

  await expect(getPublicStats()).resolves.toEqual({
    verifiedDoctors: 2, partnerClinics: 3, appointmentsManaged: 14, patientRating: 4.7,
  });
  expect(prisma.appointment.count).toHaveBeenCalledWith({
    where: { status: { notIn: ['pending_payment', 'cancelled'] } },
  });
  expect(prisma.review.aggregate).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ status: 'approved' }),
  }));
});

test('shows no rating before the first approved review', async () => {
  prisma.user.count.mockResolvedValue(0);
  prisma.clinic.count.mockResolvedValue(0);
  prisma.appointment.count.mockResolvedValue(0);
  prisma.review.aggregate.mockResolvedValue({ _avg: { rating: null }, _count: { rating: 0 } });
  await expect(getPublicStats()).resolves.toMatchObject({ patientRating: null });
});
