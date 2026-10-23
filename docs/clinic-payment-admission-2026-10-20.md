# Full clinic payment before queue admission

- A reservation remains visible in appointments while its payment is pending or partial. Its booking token is not an active queue position.
- New unpaid bookings do not create live queue entries. A minimum online advance confirms the reservation/token but does not admit it to the live queue.
- Final clinic collection or full online payment upserts a waiting queue entry transactionally. Existing called/in-consultation states are not reset by settlement. Legacy on-hold rows are promoted.
- All queue lists, waiting counts and patient own-status queries exclude unpaid/partial/refunded appointments, including existing rows created before this release. Existing data is not rewritten.
- Confirm, check-in, call, start, complete and no-show require full payment on the backend. Cancellation remains allowed. Zero-total visits need no artificial receipt.
- Clinical status updates use an atomic paid-state predicate; queue transitions recheck payment after taking the appointment row lock used by payment collection. The API exposes a boolean payment-admission flag without exposing private platform fee totals.
- Web appointment actions are disabled and display Payment required until collection is complete. Mobile callers are protected by the same API rules; this release does not publish a new native application binary.
- Verification uses service/UI regression tests and read-only production checks. No real receipt, refund or appointment is created for testing.
