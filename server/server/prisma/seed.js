/**
 * Dev-only database seed script (`npm run seed`): creates the 5 demo accounts matching
 * the ones already used across the frontend (admin/superadmin/doctor/patient/receptionist
 * @connectdoctor.test), plus a handful of specializations/cities/areas and one demo clinic
 * so the app isn't empty on first run. Responsibility: idempotent — safe to re-run, upserts
 * rather than inserts. Real passwords are hashed here via bcrypt, never stored plain.
 *
 * Run this AFTER `npx prisma migrate dev --name init` and the manual_sql files (001, 002,
 * 003 — NOT 000, that one is sandbox-only, see README.md). Mirrors
 * prisma/manual_sql/seed_demo_data.sql (the SQL-only stand-in used to verify this schema in
 * an environment with no npm/network access) — keep the two in sync if either changes.
 */
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

// Guard against ever running this against a real production database: DEMO_ACCOUNTS below
// creates admin/superadmin logins with fixed, publicly-documented passwords (they're shown
// in the app's own demo-login UI). That's fine for dev/staging, but if `npm run seed` were
// ever pointed at a production DATABASE_URL — by accident, or by copy-pasting a deploy script
// — it would create real, known-password privileged accounts. Refuse outright instead.
if (process.env.NODE_ENV === 'production') {
  console.error('[seed] refusing to run: NODE_ENV=production. This script creates demo accounts with known passwords and must never touch a production database.');
  process.exit(1);
}

const prisma = new PrismaClient();

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;

const DEMO_ACCOUNTS = [
  { email: 'admin@connectdoctor.test', password: 'Admin#DC2026!Test', role: 'admin', name: 'Admin User', phone: '9000000001' },
  { email: 'superadmin@connectdoctor.test', password: 'Super#DC2026!Test', role: 'superadmin', name: 'Super Admin', phone: '9000000002' },
  { email: 'doctor@connectdoctor.test', password: 'Doctor#DC2026!Test', role: 'doctor', name: 'Dr. Priya Sharma', phone: '9000000003' },
  { email: 'patient@connectdoctor.test', password: 'Patient#DC2026!Test', role: 'patient', name: 'Rahul Verma', phone: '9000000004' },
  { email: 'receptionist@connectdoctor.test', password: 'Reception#DC2026!Test', role: 'receptionist', name: 'Anita Desai', phone: '9000000005' },
];

async function main() {
  console.log('Seeding reference data...');

  // NOTE: these used to be human-readable slug ids ("seed-city-mumbai" etc). Every backend
  // route validates :id-shaped params/query values with isUUID(), so a slug id 422'd on any
  // request touching these rows (doctor's OPD-schedule clinic dropdown, patient search filtered
  // by city/area, GET /clinics/:id, GET /receptionists?clinicId=...). Fixed to real UUIDs here —
  // see manual_sql/004_fix_seed_uuid_ids.sql for the one-time migration of a database that
  // already has the old slug ids.
  const mumbai = await prisma.city.upsert({
    where: { id: '11111111-1111-4111-8111-111111111111' },
    update: {},
    create: { id: '11111111-1111-4111-8111-111111111111', name: 'Mumbai', state: 'Maharashtra' },
  });
  await prisma.city.upsert({ where: { id: '22222222-2222-4222-8222-222222222222' }, update: {}, create: { id: '22222222-2222-4222-8222-222222222222', name: 'Delhi', state: 'Delhi' } });
  await prisma.city.upsert({ where: { id: '33333333-3333-4333-8333-333333333333' }, update: {}, create: { id: '33333333-3333-4333-8333-333333333333', name: 'Bangalore', state: 'Karnataka' } });

  const andheri = await prisma.area.upsert({
    where: { id: '55555555-5555-4555-8555-555555555555' },
    update: {},
    create: { id: '55555555-5555-4555-8555-555555555555', cityId: mumbai.id, name: 'Andheri West', pincode: '400058' },
  });
  await prisma.area.upsert({ where: { id: '44444444-4444-4444-8444-444444444444' }, update: {}, create: { id: '44444444-4444-4444-8444-444444444444', cityId: mumbai.id, name: 'Bandra West', pincode: '400050' } });

  const generalSpec = await prisma.specialization.upsert({
    where: { name: 'General Physician' },
    update: {},
    create: { name: 'General Physician', icon: 'stethoscope', description: 'General health checkups and common illnesses' },
  });
  await prisma.specialization.upsert({ where: { name: 'Cardiologist' }, update: {}, create: { name: 'Cardiologist', icon: 'heart', description: 'Heart and cardiovascular conditions' } });
  await prisma.specialization.upsert({ where: { name: 'Dermatologist' }, update: {}, create: { name: 'Dermatologist', icon: 'skin', description: 'Skin, hair, and nail conditions' } });

  console.log('Seeding demo accounts...');
  const userIds = {};
  for (const account of DEMO_ACCOUNTS) {
    const passwordHash = await bcrypt.hash(account.password, SALT_ROUNDS);
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: {},
      create: {
        email: account.email,
        passwordHash,
        role: account.role,
        name: account.name,
        phone: account.phone,
        city: 'Mumbai',
        status: 'active',
      },
    });
    userIds[account.role] = user.id;
  }

  await prisma.patientProfile.upsert({
    where: { userId: userIds.patient },
    update: {},
    create: { userId: userIds.patient, gender: 'male', address: 'Andheri West, Mumbai' },
  });

  await prisma.doctorProfile.upsert({
    where: { userId: userIds.doctor },
    update: {},
    create: {
      userId: userIds.doctor,
      specializationId: generalSpec.id,
      qualification: 'MBBS, MD',
      registrationNumber: 'MH-12345',
      experienceYears: 8,
      consultationFee: 500,
      emergencyFee: 800,
      languages: ['English', 'Hindi'],
      bio: 'General physician with 8 years of experience.',
      status: 'verified',
      onlineBooking: true,
      emergencyAvailable: true,
    },
  });

  await prisma.receptionistProfile.upsert({
    where: { userId: userIds.receptionist },
    update: {},
    create: { userId: userIds.receptionist, since: new Date() },
  });

  console.log('Seeding demo clinic...');
  const clinic = await prisma.clinic.upsert({
    where: { id: '66666666-6666-4666-8666-666666666666' },
    update: {},
    create: {
      id: '66666666-6666-4666-8666-666666666666',
      name: 'BookMyDoctor24 Demo Clinic',
      phone: '9000000010',
      address: 'Andheri West, Mumbai',
      cityId: mumbai.id,
      areaId: andheri.id,
      approvalStatus: 'active',
      emergencyAvailable: true,
      paymentCashEnabled: true,
      paymentUpiEnabled: true,
    },
  });

  await prisma.doctorClinic.upsert({
    where: { doctorUserId_clinicId: { doctorUserId: userIds.doctor, clinicId: clinic.id } },
    update: {},
    create: { doctorUserId: userIds.doctor, clinicId: clinic.id, isOwner: true, isPrimary: true, onlineBooking: true },
  });

  await prisma.receptionistProfile.update({
    where: { userId: userIds.receptionist },
    data: { clinicId: clinic.id },
  });

  console.log('Seeding clinic hours (Mon-Sat, 10:00-18:00, 15 min slots)...');
  for (let weekday = 1; weekday <= 6; weekday += 1) {
    await prisma.doctorClinicHours.upsert({
      where: { doctorUserId_clinicId_weekday: { doctorUserId: userIds.doctor, clinicId: clinic.id, weekday } },
      update: {},
      create: { doctorUserId: userIds.doctor, clinicId: clinic.id, weekday, startTime: '10:00', endTime: '18:00', slotMinutes: 15 },
    });
  }

  console.log('Seed complete. Demo accounts (all share the domain @connectdoctor.test):');
  DEMO_ACCOUNTS.forEach((a) => console.log(`  ${a.role.padEnd(13)} ${a.email}  /  ${a.password}`));
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
