# Transactional email formatting

- All notification emails without an explicit HTML template receive a branded, inline-CSS, table-based layout through the central email delivery service. This covers payments, bookings, cancellations, queue calls and account-status updates, including future callers.
- HTML and plain-text alternatives both contain the message; SMTP sender and support reply-to configuration are unchanged. Existing formatted registration/password-reset OTPs are preserved rather than double-wrapped.
- Payment emails to patients add receipt/reference, amount actually received, doctor/clinic, visit date and IST time, booking token, payment method, full/advance status and queue-admission guidance. Missing values are omitted. No diagnosis, medical history, platform commission or gateway secret is added.
- Rich email-only fields are not written into the notification database or sent via push. Doctor notifications do not receive the patient's detailed receipt payload.
- Message text and detail labels/values are HTML-escaped. Email action links must stay on bookadoctors.com; unsafe destinations fall back to login. No external font, image or script is required.
- OTP expiry and delivery-failure behavior remain unchanged. Existing inbox emails cannot be retroactively reformatted; subsequent messages use the updated layout.
- Checks use generated synthetic HTML samples and mocked SMTP delivery, not real recipients, bookings or payments. Browser localhost preview was unavailable; cross-client Gmail/Outlook visual acceptance is not claimed. Generated samples are under tmp/email-previews locally and are not deployed.
