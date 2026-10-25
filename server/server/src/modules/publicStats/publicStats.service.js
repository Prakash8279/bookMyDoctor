const prisma = require('../../config/db');
const cacheService = require('../../services/cacheService');

// Aggregate only public, confirmed activity. No patient or appointment rows leave this endpoint.
async function getPublicStats() {
  return cacheService.getOrSet('cache:public:stats', 60, async () => {
    const visibleDoctor = { role: 'doctor', status: 'active', doctorProfile: { is: { status: 'verified' } } };
    const [verifiedDoctors, partnerClinics, appointmentsManaged, ratings] = await Promise.all([
      prisma.user.count({ where: visibleDoctor }),
      prisma.clinic.count({ where: { approvalStatus: 'active' } }),
      prisma.appointment.count({ where: { status: { notIn: ['pending_payment', 'cancelled'] } } }),
      prisma.review.aggregate({
        where: { status: 'approved', doctor: { is: visibleDoctor } },
        _avg: { rating: true },
        _count: { rating: true },
      }),
    ]);

    return {
      verifiedDoctors,
      partnerClinics,
      appointmentsManaged,
      patientRating: ratings._count.rating ? Number(ratings._avg.rating.toFixed(1)) : null,
    };
  });
}

module.exports = { getPublicStats };
