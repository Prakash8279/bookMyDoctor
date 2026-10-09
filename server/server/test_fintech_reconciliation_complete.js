/**
 * BOOKMYDOCTORS — COMPLETE FINANCIAL RECONCILIATION & AUTO-REFUND TEST SUITE
 * 
 * Verifies all 8 Core Production Acceptance Scenarios:
 * TEST 1: Capacity available -> Payment success -> Booking confirmed -> Token assigned -> Refund NOT_REQUIRED
 * TEST 2: Capacity unavailable BEFORE payment -> Booking rejected -> No payment
 * TEST 3: Capacity lost / hold expired before payment verification -> Payment captured -> DB Payment record EXISTS -> Booking NOT confirmed -> Auto-refund created & processed -> 0 orphan payment
 * TEST 4: Duplicate payment webhook -> Exactly 1 DB payment record (idempotent)
 * TEST 5: Duplicate refund webhook -> Exactly 1 DB refund record (idempotent)
 * TEST 6: Refund API retry -> Idempotent, no duplicate refund
 * TEST 7: Webhook reconciliation recovers payment if browser dropped -> Zero orphan payment
 * TEST 8: 55 Successful Payments vs 50 Capacity -> Exactly 50 Confirmed + Exactly 5 Refunded + 0 Orphan + 0 Duplicate
 * TEST 9: Admin Payment Reconciliation Report -> 100% audit accuracy & KPI tracking
 */

const crypto = require('crypto');
const prisma = require('./src/config/db');
const env = require('./src/config/env');
const logger = require('./src/config/logger');
const tokenService = require('./src/services/tokenService');
const appointmentsService = require('./src/modules/appointments/appointments.service');
const paymentsService = require('./src/modules/payments/payments.service');
const razorpayService = require('./src/modules/payments/razorpay.service');
const notificationsService = require('./src/modules/notifications/notifications.service');

// Configure test environment & secrets
env.razorpay.keyId = env.razorpay.keyId || 'rzp_test_TdPsILvgU68iFw';
env.razorpay.keySecret = env.razorpay.keySecret || 'test_secret_for_audit_hmac_12345';
env.razorpay.webhookSecret = env.razorpay.webhookSecret || 'whsec_test_audit_signature_secret_67890';

// Stub notifySystemEventSafe to avoid slow external SMTP connections during load test
notificationsService.notifySystemEventSafe = async () => {};

// Dedicated test constants
const DOCTOR_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CLINIC_ID = '66666666-6666-4666-8666-666666666666';
const AUDIT_DATE = '2026-12-25'; // Friday
const AUDIT_DATE_UTC = new Date(Date.now() + 86400000 * 30); // 30 days ahead
AUDIT_DATE_UTC.setUTCHours(0, 0, 0, 0);
const DATE_STR = AUDIT_DATE_UTC.toISOString().slice(0, 10);

// Global mock gateway store to accurately simulate Razorpay sandbox behavior
const razorpayGatewayOrders = new Map();
const razorpayGatewayPayments = new Map();
const razorpayGatewayRefunds = new Map();

// Intercept global fetch for Razorpay API to simulate sandbox without triggering live API rate-limits
const originalFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  const urlStr = String(url);

  // 1. Razorpay Order creation: POST https://api.razorpay.com/v1/orders
  if (urlStr.includes('/orders') && options.method === 'POST') {
    const body = JSON.parse(options.body || '{}');
    const orderId = 'order_sbx_' + crypto.randomBytes(6).toString('hex');
    const orderObj = {
      id: orderId,
      amount: body.amount,
      currency: body.currency || 'INR',
      receipt: body.receipt,
      status: 'created',
      notes: body.notes || {},
      created_at: Math.floor(Date.now() / 1000),
    };
    razorpayGatewayOrders.set(orderId, orderObj);
    return {
      ok: true,
      status: 200,
      json: async () => orderObj,
    };
  }

  // 2. Razorpay Order fetch: GET https://api.razorpay.com/v1/orders/:id
  if (urlStr.includes('/orders/') && (!options.method || options.method === 'GET')) {
    const orderId = urlStr.split('/orders/')[1].split('?')[0];
    const orderObj = razorpayGatewayOrders.get(orderId) || {
      id: orderId,
      amount: 53550,
      currency: 'INR',
      status: 'paid',
      notes: {},
    };
    return {
      ok: true,
      status: 200,
      json: async () => orderObj,
    };
  }

  // 3. Razorpay Refund creation: POST https://api.razorpay.com/v1/payments/:id/refund
  if (urlStr.includes('/payments/') && urlStr.includes('/refund') && options.method === 'POST') {
    const parts = urlStr.split('/payments/')[1].split('/refund');
    const paymentId = decodeURIComponent(parts[0]);
    const body = JSON.parse(options.body || '{}');
    const refundId = 'rfnd_sbx_' + crypto.randomBytes(6).toString('hex');
    const refundObj = {
      id: refundId,
      payment_id: paymentId,
      amount: body.amount,
      currency: 'INR',
      status: 'processed',
      notes: body.notes || {},
      created_at: Math.floor(Date.now() / 1000),
    };
    razorpayGatewayRefunds.set(refundId, refundObj);
    return {
      ok: true,
      status: 200,
      json: async () => refundObj,
    };
  }

  return originalFetch(url, options);
};

function signOrderPayment(orderId, paymentId) {
  return crypto
    .createHmac('sha256', env.razorpay.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

function signWebhook(rawBody) {
  return crypto
    .createHmac('sha256', env.razorpay.webhookSecret)
    .update(rawBody)
    .digest('hex');
}

async function runFintechReconciliationTestSuite() {
  console.log('================================================================');
  console.log('BOOKMYDOCTORS — COMPLETE FINANCIAL RECONCILIATION & AUDIT TEST');
  console.log('================================================================');
  console.log(`Test Date: ${DATE_STR}`);
  console.log(`Razorpay Key: ${env.razorpay.keyId}`);
  console.log(`Webhook Secret: ${env.razorpay.webhookSecret.slice(0, 10)}...`);

  // Setup Doctor profile with 50 capacity
  await prisma.doctorProfile.upsert({
    where: { userId: DOCTOR_ID },
    create: {
      userId: DOCTOR_ID,
      consultationFee: 500,
      maxOnlineBookingsPerDay: 50,
      onlineBooking: true,
      status: 'verified',
    },
    update: {
      consultationFee: 500,
      maxOnlineBookingsPerDay: 50,
      onlineBooking: true,
      status: 'verified',
    },
  });

  const weekday = AUDIT_DATE_UTC.getUTCDay();
  await prisma.doctorClinicHours.deleteMany({ where: { doctorUserId: DOCTOR_ID } });
  for (let d = 0; d < 7; d++) {
    await prisma.doctorClinicHours.create({
      data: {
        doctorUserId: DOCTOR_ID,
        clinicId: CLINIC_ID,
        weekday: d,
        startTime: '09:00',
        endTime: '18:00',
        slotMinutes: 15,
        status: 'active',
      },
    });
  }

  // Provision test patients
  console.log('\n--- PROVISIONING 60 TEST PATIENT ACCOUNTS ---');
  const testPatients = [];
  for (let i = 1; i <= 60; i++) {
    const patientId = `ffffffff-ffff-4fff-8fff-${String(i).padStart(12, '0')}`;
    const patient = await prisma.user.upsert({
      where: { id: patientId },
      create: {
        id: patientId,
        email: `fintech_audit_patient_${i}@test.com`,
        phone: `+9199999${String(10000 + i)}`,
        passwordHash: 'dummy_hash',
        role: 'patient',
        name: `Fintech Patient ${i}`,
        status: 'active',
      },
      update: {
        email: `fintech_audit_patient_${i}@test.com`,
        phone: `+9199999${String(10000 + i)}`,
        name: `Fintech Patient ${i}`,
        status: 'active',
      },
    });
    testPatients.push(patient);
  }
  console.log(`Successfully provisioned ${testPatients.length} test patients.`);

  // Clean existing bookings for test date
  await prisma.queueToken.deleteMany({ where: { doctorUserId: DOCTOR_ID, queueDate: AUDIT_DATE_UTC } });
  await prisma.refund.deleteMany({ where: { appointment: { doctorUserId: DOCTOR_ID, appointmentDate: AUDIT_DATE_UTC } } });
  await prisma.payment.deleteMany({ where: { doctorUserId: DOCTOR_ID, appointment: { appointmentDate: AUDIT_DATE_UTC } } });
  await prisma.appointment.deleteMany({ where: { doctorUserId: DOCTOR_ID, appointmentDate: AUDIT_DATE_UTC } });

  console.log('\n================================================================');
  console.log('TEST 1: CAPACITY AVAILABLE -> BOOKED & PAID (REFUND NOT REQUIRED)');
  console.log('================================================================');
  const p1 = testPatients[0];
  const req1 = { id: p1.id, role: 'patient' };
  const job1 = await appointmentsService.runBookingJob({
    patientUserId: p1.id,
    doctorUserId: DOCTOR_ID,
    clinicId: CLINIC_ID,
    appointmentDate: DATE_STR,
    source: 'online',
  }, req1);

  const appt1 = await prisma.appointment.findUnique({ where: { id: job1.appointmentId } });

  if (!appt1 || appt1.status !== 'pending_payment') {
    throw new Error(`Test 1 Failed: Expected pending_payment, got ${appt1?.status}`);
  }

  const order1 = await razorpayService.createOrder(appt1.id, req1, 'full');
  const pId1 = 'pay_sbx_test1_' + crypto.randomBytes(4).toString('hex');
  const sig1 = signOrderPayment(order1.orderId, pId1);

  const verify1 = await razorpayService.verifyAndRecordPayment({
    appointmentId: appt1.id,
    razorpayOrderId: order1.orderId,
    razorpayPaymentId: pId1,
    razorpaySignature: sig1,
  }, req1);

  console.log('Test 1 Verification Result:');
  console.log(`  - Appointment Status: ${verify1.appointment.status} (Expected: upcoming)`);
  console.log(`  - Token Assigned: #${verify1.appointment.tokenNumber}`);
  console.log(`  - Payment Status: ${verify1.payment.status} (Expected: paid)`);
  console.log(`  - Refund Required: ${verify1.refund ? 'YES' : 'NO'} (Expected: NO)`);
  if (verify1.appointment.status !== 'upcoming' || verify1.payment.status !== 'paid' || Boolean(verify1.refund)) {
    throw new Error('TEST 1 FAILED');
  }
  console.log('TEST 1 RESULT: ✅ PASS');

  console.log('\n================================================================');
  console.log('TEST 2: CAPACITY BLOCKED BEFORE PAYMENT (NO CAPTURED PAYMENT)');
  console.log('================================================================');
  // Temporarily set capacity to 1
  await prisma.doctorProfile.update({
    where: { userId: DOCTOR_ID },
    data: { maxOnlineBookingsPerDay: 1 },
  });

  const p2 = testPatients[1];
  const req2 = { id: p2.id, role: 'patient' };
  let test2Blocked = false;
  try {
    await appointmentsService.runBookingJob({
      patientUserId: p2.id,
      doctorUserId: DOCTOR_ID,
      clinicId: CLINIC_ID,
      appointmentDate: DATE_STR,
      source: 'online',
    }, req2);
  } catch (err) {
    if (err.code === 'DAILY_ONLINE_LIMIT_REACHED') {
      test2Blocked = true;
    }
  }

  // Restore capacity to 50
  await prisma.doctorProfile.update({
    where: { userId: DOCTOR_ID },
    data: { maxOnlineBookingsPerDay: 50 },
  });

  console.log(`Test 2 Blocked Over-Capacity Booking: ${test2Blocked ? 'YES (DAILY_ONLINE_LIMIT_REACHED)' : 'NO'}`);
  if (!test2Blocked) throw new Error('TEST 2 FAILED');
  console.log('TEST 2 RESULT: ✅ PASS');

  console.log('\n================================================================');
  console.log('TEST 3: HOLD EXPIRED / CANCELLED -> AUTO-REFUND & 0 ORPHAN PAYMENT');
  console.log('================================================================');
  // Patient 2 books an appointment
  const job3 = await appointmentsService.runBookingJob({
    patientUserId: p2.id,
    doctorUserId: DOCTOR_ID,
    clinicId: CLINIC_ID,
    appointmentDate: DATE_STR,
    source: 'online',
  }, req2);
  const appt3 = await prisma.appointment.findUnique({ where: { id: job3.appointmentId } });

  const order3 = await razorpayService.createOrder(appt3.id, req2, 'full');

  // Simulate appointment hold expired or receptionist cancelled while user was on payment gateway
  await prisma.appointment.update({
    where: { id: appt3.id },
    data: { status: 'cancelled' },
  });

  // User completes payment on Razorpay!
  const pId3 = 'pay_sbx_test3_' + crypto.randomBytes(4).toString('hex');
  const sig3 = signOrderPayment(order3.orderId, pId3);

  const verify3 = await razorpayService.verifyAndRecordPayment({
    appointmentId: appt3.id,
    razorpayOrderId: order3.orderId,
    razorpayPaymentId: pId3,
    razorpaySignature: sig3,
  }, req2);

  console.log('Test 3 Verification Result:');
  console.log(`  - Appointment Status: ${verify3.appointment.status} (Expected: cancelled)`);
  console.log(`  - Booking Confirmed: ${verify3.bookingConfirmed} (Expected: false)`);
  console.log(`  - Payment Status: ${verify3.payment.status} (Expected: refunded)`);
  console.log(`  - Refund Status: ${verify3.refund?.status} (Expected: processed)`);
  console.log(`  - Razorpay Refund ID: ${verify3.refund?.razorpayRefundId}`);
  console.log(`  - User Facing Message: "${verify3.message}"`);

  // Verify in PostgreSQL database
  const dbPayment3 = await prisma.payment.findFirst({ where: { transactionRef: pId3 } });
  const dbRefund3 = await prisma.refund.findFirst({ where: { razorpayPaymentId: pId3 } });

  console.log(`  - DB Payment Record Exists: ${dbPayment3 ? 'YES (' + dbPayment3.id + ')' : 'NO'}`);
  console.log(`  - DB Refund Record Exists: ${dbRefund3 ? 'YES (' + dbRefund3.id + ')' : 'NO'}`);

  if (!dbPayment3 || !dbRefund3 || verify3.appointment.status !== 'cancelled' || dbRefund3.status !== 'processed') {
    throw new Error('TEST 3 FAILED: Payment was orphaned or refund was not created!');
  }
  console.log('TEST 3 RESULT: ✅ PASS (NO ORPHAN PAYMENT, COMPLETE AUDIT RECORD)');

  console.log('\n================================================================');
  console.log('TEST 4: DUPLICATE PAYMENT WEBHOOK IDEMPOTENCY');
  console.log('================================================================');
  const p3 = testPatients[2];
  const req3 = { id: p3.id, role: 'patient' };
  const job4 = await appointmentsService.runBookingJob({
    patientUserId: p3.id,
    doctorUserId: DOCTOR_ID,
    clinicId: CLINIC_ID,
    appointmentDate: DATE_STR,
    source: 'online',
  }, req3);
  const appt4 = await prisma.appointment.findUnique({ where: { id: job4.appointmentId } });

  const order4 = await razorpayService.createOrder(appt4.id, req3, 'full');
  const pId4 = 'pay_sbx_test4_' + crypto.randomBytes(4).toString('hex');

  const webhookBody4 = Buffer.from(JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: pId4,
          order_id: order4.orderId,
          amount: 53550,
          currency: 'INR',
          status: 'captured',
        },
      },
    },
  }));

  // Deliver webhook 1st time
  const wh1 = await razorpayService.reconcilePendingPaymentsFromWebhook(webhookBody4, signWebhook(webhookBody4));
  // Deliver webhook 2nd time (duplicate)
  const wh2 = await razorpayService.reconcilePendingPaymentsFromWebhook(webhookBody4, signWebhook(webhookBody4));
  // Deliver webhook 3rd time (duplicate)
  const wh3 = await razorpayService.reconcilePendingPaymentsFromWebhook(webhookBody4, signWebhook(webhookBody4));

  const whPaymentsCount = await prisma.payment.count({ where: { transactionRef: pId4 } });
  console.log(`Webhook Deliveries: 3, Database Payment Records Created: ${whPaymentsCount}`);
  if (whPaymentsCount !== 1) {
    throw new Error(`TEST 4 FAILED: Expected 1 payment record, found ${whPaymentsCount}`);
  }
  console.log('TEST 4 RESULT: ✅ PASS (EXACTLY 1 RECORD CREATED)');

  console.log('\n================================================================');
  console.log('TEST 5: DUPLICATE REFUND WEBHOOK IDEMPOTENCY');
  console.log('================================================================');
  const refundId5 = dbRefund3.id;
  const razorpayRefundId5 = dbRefund3.razorpayRefundId;

  const refundWebhookBody = Buffer.from(JSON.stringify({
    event: 'refund.processed',
    payload: {
      refund: {
        entity: {
          id: razorpayRefundId5,
          payment_id: pId3,
          amount: 53550,
          status: 'processed',
          notes: { refundId: refundId5, appointmentId: appt3.id },
        },
      },
    },
  }));

  const rwh1 = await razorpayService.reconcilePendingPaymentsFromWebhook(refundWebhookBody, signWebhook(refundWebhookBody));
  const rwh2 = await razorpayService.reconcilePendingPaymentsFromWebhook(refundWebhookBody, signWebhook(refundWebhookBody));

  const dbRefundCount = await prisma.refund.count({ where: { id: refundId5 } });
  console.log(`Refund Webhook Deliveries: 2, DB Refund Records Count: ${dbRefundCount}`);
  if (dbRefundCount !== 1 || !rwh2.alreadyProcessed) {
    throw new Error('TEST 5 FAILED: Duplicate refund webhook not idempotent');
  }
  console.log('TEST 5 RESULT: ✅ PASS');

  console.log('\n================================================================');
  console.log('TEST 6: REFUND API RETRY IDEMPOTENCY');
  console.log('================================================================');
  let retryBlocked = false;
  try {
    await razorpayService.retryRefund(refundId5, { id: 'admin-1', role: 'admin' });
  } catch (err) {
    if (err.code === 'REFUND_ALREADY_PROCESSED') {
      retryBlocked = true;
    }
  }
  console.log(`Refund Retry on already processed refund correctly guarded: ${retryBlocked ? 'YES' : 'NO'}`);
  if (!retryBlocked) throw new Error('TEST 6 FAILED');
  console.log('TEST 6 RESULT: ✅ PASS');

  console.log('\n================================================================');
  console.log('TEST 7: SERVER CRASH / TIMEOUT AFTER RAZORPAY CAPTURE (RECONCILIATION)');
  console.log('================================================================');
  const p4 = testPatients[3];
  const req4 = { id: p4.id, role: 'patient' };
  const job7 = await appointmentsService.runBookingJob({
    patientUserId: p4.id,
    doctorUserId: DOCTOR_ID,
    clinicId: CLINIC_ID,
    appointmentDate: DATE_STR,
    source: 'online',
  }, req4);
  const appt7 = await prisma.appointment.findUnique({ where: { id: job7.appointmentId } });

  const order7 = await razorpayService.createOrder(appt7.id, req4, 'full');
  const pId7 = 'pay_sbx_test7_' + crypto.randomBytes(4).toString('hex');

  // Patient paid, but browser crashed before calling /verify.
  // Webhook arrives and recovers the appointment!
  const webhookBody7 = Buffer.from(JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: pId7,
          order_id: order7.orderId,
          amount: 53550,
          currency: 'INR',
          status: 'captured',
        },
      },
    },
  }));

  await razorpayService.reconcilePendingPaymentsFromWebhook(webhookBody7, signWebhook(webhookBody7));

  const recAppt = await prisma.appointment.findUnique({ where: { id: appt7.id } });
  const recPayment = await prisma.payment.findFirst({ where: { transactionRef: pId7 } });

  console.log(`Reconciled Appointment Status: ${recAppt.status} (Expected: upcoming)`);
  console.log(`Reconciled Payment Exists: ${recPayment ? 'YES (' + recPayment.id + ')' : 'NO'}`);
  if (recAppt.status !== 'upcoming' || !recPayment) {
    throw new Error('TEST 7 FAILED: Crash recovery failed!');
  }
  console.log('TEST 7 RESULT: ✅ PASS (NO ORPHAN PAYMENT)');

  console.log('\n================================================================');
  console.log('TEST 8: 55 SUCCESSFUL PAYMENTS vs 50 DAILY CAPACITY');
  console.log('================================================================');
  // Reset clean state for the 55 concurrency test on fresh test date
  const LOAD_DATE_UTC = new Date(Date.now() + 86400000 * 35);
  LOAD_DATE_UTC.setUTCHours(0, 0, 0, 0);
  const LOAD_DATE_STR = LOAD_DATE_UTC.toISOString().slice(0, 10);

  await prisma.doctorProfile.update({
    where: { userId: DOCTOR_ID },
    data: { maxOnlineBookingsPerDay: 50 },
  });

  await prisma.queueToken.deleteMany({ where: { doctorUserId: DOCTOR_ID, queueDate: LOAD_DATE_UTC } });
  await prisma.refund.deleteMany({ where: { appointment: { doctorUserId: DOCTOR_ID, appointmentDate: LOAD_DATE_UTC } } });
  await prisma.payment.deleteMany({ where: { doctorUserId: DOCTOR_ID, appointment: { appointmentDate: LOAD_DATE_UTC } } });
  await prisma.appointment.deleteMany({ where: { doctorUserId: DOCTOR_ID, appointmentDate: LOAD_DATE_UTC } });

  // Create 55 candidate appointments
  // Note: 50 will be confirmed within daily capacity, 5 will exceed daily capacity.
  console.log('Creating 55 appointments for load test...');
  const loadAppointments = [];
  for (let i = 0; i < 55; i++) {
    const pt = testPatients[i];
    const hour = 9 + Math.floor(i / 12);
    const min = (i % 12) * 5;
    const timeStr = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    const appt = await prisma.appointment.create({
      data: {
        patientUserId: pt.id,
        doctorUserId: DOCTOR_ID,
        clinicId: CLINIC_ID,
        appointmentDate: LOAD_DATE_UTC,
        appointmentTime: timeStr,
        source: 'online',
        status: 'pending_payment',
        tokenNumber: i + 1,
        consultationFee: 500,
        convenienceFee: 25,
        emergencyFee: 0,
        gstAmount: 10.5,
        totalAmount: 535.5,
        paymentStatus: 'pending',
      },
    });

    await prisma.queueToken.create({
      data: {
        doctorUserId: DOCTOR_ID,
        clinicId: CLINIC_ID,
        appointmentId: appt.id,
        queueDate: LOAD_DATE_UTC,
        tokenNumber: i + 1,
        status: 'on_hold',
      },
    });

    loadAppointments.push({ appt, patient: pt });
  }

  // Pre-create Razorpay orders for all 55 users
  console.log('Creating 55 Razorpay orders and simulating successful captures...');
  const loadVerifyPayloads = [];
  for (let i = 0; i < 55; i++) {
    const item = loadAppointments[i];
    const req = { id: item.patient.id, role: 'patient' };
    const order = await razorpayService.createOrder(item.appt.id, req, 'full');
    const paymentId = 'pay_sbx_55_' + String(i + 1).padStart(2, '0') + '_' + crypto.randomBytes(4).toString('hex');
    const signature = signOrderPayment(order.orderId, paymentId);
    loadVerifyPayloads.push({
      appointmentId: item.appt.id,
      razorpayOrderId: order.orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature,
      requester: req,
    });
  }

  console.log('Executing 55 CONCURRENT payment verification requests...');
  const verifyResults = await Promise.all(
    loadVerifyPayloads.map((payload) =>
      razorpayService.verifyAndRecordPayment(
        {
          appointmentId: payload.appointmentId,
          razorpayOrderId: payload.razorpayOrderId,
          razorpayPaymentId: payload.razorpayPaymentId,
          razorpaySignature: payload.razorpaySignature,
        },
        payload.requester
      ).catch((err) => ({ error: err.message, code: err.code }))
    )
  );

  let confirmedCount = 0;
  let autoRefundedCount = 0;
  let failedCount = 0;

  for (const r of verifyResults) {
    if (r.bookingConfirmed || (r.appointment && (r.appointment.status === 'upcoming' || r.appointment.status === 'confirmed'))) {
      confirmedCount++;
    } else if (r.status === 'REFUNDED' || r.status === 'REFUND_PENDING') {
      autoRefundedCount++;
    } else {
      failedCount++;
    }
  }

  console.log('\n--- VERIFICATION EXECUTION RESULTS ---');
  console.log(`Total Concurrent Payments Captured: 55`);
  console.log(`Bookings Confirmed:                ${confirmedCount} (Target: 50)`);
  console.log(`Payments Auto-Refunded:            ${autoRefundedCount} (Target: 5)`);
  console.log(`Failed / Unhandled:                ${failedCount} (Target: 0)`);

  // Final Database Accounting Check
  const dbConfirmedAppts = await prisma.appointment.count({
    where: {
      doctorUserId: DOCTOR_ID,
      appointmentDate: LOAD_DATE_UTC,
      status: { in: ['upcoming', 'confirmed'] },
      paymentStatus: 'paid',
    },
  });

  const dbCancelledAppts = await prisma.appointment.count({
    where: {
      doctorUserId: DOCTOR_ID,
      appointmentDate: LOAD_DATE_UTC,
      status: 'cancelled',
      paymentStatus: 'refunded',
    },
  });

  const dbTotalPayments = await prisma.payment.count({
    where: {
      doctorUserId: DOCTOR_ID,
      appointment: { appointmentDate: LOAD_DATE_UTC },
    },
  });

  const dbPaidPayments = await prisma.payment.count({
    where: {
      doctorUserId: DOCTOR_ID,
      status: 'paid',
      appointment: { appointmentDate: LOAD_DATE_UTC },
    },
  });

  const dbRefundedPayments = await prisma.payment.count({
    where: {
      doctorUserId: DOCTOR_ID,
      status: 'refunded',
      appointment: { appointmentDate: LOAD_DATE_UTC },
    },
  });

  const dbProcessedRefunds = await prisma.refund.count({
    where: {
      appointment: { doctorUserId: DOCTOR_ID, appointmentDate: LOAD_DATE_UTC },
      status: 'processed',
    },
  });

  console.log('\n--- FINAL POSTGRESQL DATABASE AUDIT ---');
  console.log(`Total Payment Records in DB:   ${dbTotalPayments} (Expected: 55)`);
  console.log(`Confirmed Upcoming Bookings:   ${dbConfirmedAppts} (Expected: 50)`);
  console.log(`Paid Payment Records:          ${dbPaidPayments} (Expected: 50)`);
  console.log(`Refunded Payment Records:      ${dbRefundedPayments} (Expected: 5)`);
  console.log(`Processed Refund Records:      ${dbProcessedRefunds} (Expected: 5)`);
  console.log(`Cancelled Appointment Records: ${dbCancelledAppts} (Expected: 5)`);

  const orphanPayments = dbTotalPayments < 55 ? 55 - dbTotalPayments : 0;
  console.log(`Orphan Payments:               ${orphanPayments} (Expected: 0)`);

  if (
    confirmedCount !== 50 ||
    autoRefundedCount !== 5 ||
    dbConfirmedAppts !== 50 ||
    dbTotalPayments !== 55 ||
    dbProcessedRefunds !== 5 ||
    orphanPayments !== 0
  ) {
    throw new Error('TEST 8 FAILED: Financial reconciliation criteria not satisfied!');
  }
  console.log('TEST 8 RESULT: ✅ PASS (50 CONFIRMED, 5 REFUNDED, 0 ORPHAN)');

  console.log('\n================================================================');
  console.log('TEST 9: ADMIN PAYMENT RECONCILIATION REPORT VERIFICATION');
  console.log('================================================================');
  const report = await paymentsService.getPaymentReconciliationReport({
    doctorId: DOCTOR_ID,
    date: LOAD_DATE_STR,
    page: 1,
    pageSize: 100,
  });

  console.log('Reconciliation Report KPI Summary:');
  console.log(`  - Total Payments Tracked: ${report.kpi.totalPayments}`);
  console.log(`  - Booked & Paid Count:    ${report.kpi.bookedAndPaidCount}`);
  console.log(`  - Refunded Count:         ${report.kpi.refundedCount}`);
  console.log(`  - Refund Pending Count:   ${report.kpi.refundPendingCount}`);
  console.log(`  - Refund Failed Count:    ${report.kpi.refundFailedCount}`);
  console.log(`  - Unreconciled Count:     ${report.kpi.unreconciledCount}`);
  console.log(`  - Total Financial Volume: Rs. ${report.kpi.totalAmount}`);

  if (
    report.kpi.totalPayments !== 55 ||
    report.kpi.bookedAndPaidCount !== 50 ||
    report.kpi.refundedCount !== 5 ||
    report.kpi.unreconciledCount !== 0
  ) {
    throw new Error('TEST 9 FAILED: Reconciliation report KPI figures incorrect!');
  }
  console.log('TEST 9 RESULT: ✅ PASS (100% RECONCILED)');

  console.log('\n================================================================');
  console.log('FINAL AUDIT SUMMARY: ALL 9 CRITICAL FINTECH TESTS PASSED! ✅');
  console.log('================================================================');

  process.exit(0);
}

runFintechReconciliationTestSuite().catch((err) => {
  console.error('\n❌ AUDIT SUITE FAILED:', err);
  process.exit(1);
});
