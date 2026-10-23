# Online quota and approximate call times

When `maxOnlineBookingsPerDay` is configured, it is the doctor's total online
capacity per date across all clinics, not the minimum of that count and OPD minutes.
An active weekday OPD schedule, booking-date window and no closure are still required.
Walk-ins do not consume the online quota. With no configured quota, legacy time-based
capacity remains unchanged.

Under the doctor-day transaction lock, confirmed/upcoming/completed online bookings
and unexpired payment holds occupy capacity. Cancelled/no-show bookings and expired
holds do not. Estimated call time is opening + (occupied online capacity + 1) × patient
minutes, so 10:00 and five minutes gives 10:05, 10:10, etc. This is not a guaranteed
appointment time. Cancellations may lead to repeated estimates; queue tokens remain
the authority for service order. Estimates may exceed OPD closing or cross midnight;
`estimatedVisitAt` preserves the full instant and the web UI displays its actual date.

## Release requirement

Apply migration `20261021090000_online_quota_estimated_times` and regenerate the Prisma
client before starting this backend/worker. The migration adds two columns, preserves
old exact-time appointments, and excludes estimated appointments from the physical
slot unique index. Do not deploy the new backend without this migration. Back up the
database and uploaded files before recreating production containers. No seed is needed.

