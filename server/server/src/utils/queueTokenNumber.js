// Both callers hold the same doctor-day advisory transaction lock before allocating.
// A pending/unpaid reservation never participates in the issued-token sequence.
async function nextQueueTokenNumber(tx, { doctorUserId, appointmentDate, source, profile = {} }) {
  if (profile.tokenNumberingMode === 'alternate') {
    const onlineWantsOdd = profile.onlineTokenParity !== 'even';
    const wantsOdd = source === 'online' ? onlineWantsOdd : !onlineWantsOdd;
    const rows = await tx.$queryRaw`
      SELECT COALESCE(MAX(token_number), 0) AS max FROM appointments
      WHERE doctor_user_id = ${doctorUserId} AND appointment_date = ${appointmentDate}::date
        AND status <> 'pending_payment'
        AND (token_number % 2) = ${wantsOdd ? 1 : 0}
    `;
    const max = Number(rows[0].max);
    return max > 0 ? max + 2 : wantsOdd ? 1 : 2;
  }
  const rows = await tx.$queryRaw`
    SELECT COALESCE(MAX(token_number), 0) AS max FROM appointments
    WHERE doctor_user_id = ${doctorUserId} AND appointment_date = ${appointmentDate}::date
      AND status <> 'pending_payment'
  `;
  return Number(rows[0].max) + 1;
}

module.exports = { nextQueueTokenNumber };
