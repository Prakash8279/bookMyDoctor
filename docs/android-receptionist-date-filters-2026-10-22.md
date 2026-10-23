# Receptionist Payments / Reports date filters

User request: add date-wise shortlisting like the doctor panel to the native receptionist section.

- Both screens default to Today (India calendar date), with From/To, Today reset and All dates controls.
- Payments filter both receipt rows and all three collection totals using the payment record's `createdAt`, converted to IST. Refunded/pending receipts may remain visible but do not inflate collections.
- Reports apply the same payment-date filter to receipt history and collection totals. Walk-ins use appointment visit date; check-ins use actual arrival timestamp. This distinction is labelled in the UI.
- Date boundaries are inclusive. Invalid reversed ranges hide the data and show an error; filters remain available even when no records match. Legacy undated payments are available under All dates, not silently assigned to today.
- Complete pagination is loaded with the existing role-scoped APIs before filtering. No unsupported payment date query parameters are sent. Appointment records from outside the selected visit dates remain available for payment-fee lookup.
- Removed constrained ListTile trailing layout from receptionist payment cards; full-width receipt details, amount/status and receipt action wrap without overflowing at 320px with 1.4 text scale.
- New isolated tests cover Today/range/All, invalid ranges, date picker opening, inclusive boundaries across midnight in IST, refund exclusion, separate visit/arrival dates and narrow light/dark layouts. No live payments or bookings are created.

Scope is the Android app. No website/backend/AWS deployment changes are included.

Verification: full suite **225 tests passed**, static analysis **No issues found**, and debug APK built successfully. Logs: `reception-date-full-tests.log`, `reception-date-analysis.log`, `reception-date-build.log` in the BookADoctors task workspace's `tmp` folder. No device was listed by ADB, so this APK has not been installed on the physical phone.
