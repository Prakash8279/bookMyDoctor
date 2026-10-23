# Email logo and sender avatar

- Authentication and general notification templates use the existing BookADoctors PNG from client/public/logo.png. It is bundled in a small server module and attached with a fixed inline Content-ID, so rendering does not require a remote image fetch or an app filesystem asset mount.
- Both SMTP notification and verification messages attach the image only when the matching CID occurs in the HTML. Sender and reply-to are unchanged. MIME generation and artwork hash tests use a local stream transport, not real email delivery.
- The email body logo is separate from the sender avatar controlled by Gmail and other recipients' mail clients. Do not claim an inline attachment changes that avatar.
- Read-only checks on 20 October: SMTP provider is smtpout.secureserver.net; domain DMARC has p=reject. default._bimi.bookadoctors.com returned NXDOMAIN. No BIMI record or logo certificate was supplied for this task.
- Gmail domain-logo BIMI setup needs a VMC or CMC certificate and appropriate DMARC, plus published certificate/DNS configuration. The user confirmed noreply is a business-mail alias, not a separate Google account. No certificate purchase, account creation, sender-address substitution or DNS mutation is authorized or performed here; no personal Gmail avatar is changed. Sender-avatar work remains pending certificate/configuration availability.
- References: https://knowledge.workspace.google.com/admin/security/set-up-bimi and https://support.google.com/mail/answer/35529
