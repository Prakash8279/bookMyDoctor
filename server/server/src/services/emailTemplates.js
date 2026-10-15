const BRAND = {
  name: 'BookADoctors',
  website: 'https://bookadoctors.com',
  supportEmail: 'support@bookadoctors.com',
  primary: '#ad5d3b',
  dark: '#1f2937',
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function authOtpTemplate({ email, otp, purpose }) {
  const isReset = purpose === 'password-reset';
  const safeEmail = escapeHtml(email);
  const safeOtp = escapeHtml(otp);
  const title = isReset ? 'Password reset code' : 'Verify your email address';
  const intro = isReset
    ? 'We received a request to reset your BookADoctors password. Enter this code on the password reset screen:'
    : 'Enter this code to verify your email address and finish creating your BookADoctors account:';
  const ignore = isReset
    ? 'If you did not request a password reset, you can safely ignore this email. Your password has not been changed.'
    : 'If you did not start a BookADoctors registration, you can safely ignore this email.';

  return {
    subject: isReset ? `Your BookADoctors password reset code: ${otp}` : `Your BookADoctors verification code: ${otp}`,
    text: `${title}\n\n${intro}\n\n${otp}\n\nThis code expires in 5 minutes. Never share it with anyone; BookADoctors staff will never ask for it.\n\n${ignore}\n\nSent to ${email}\n${BRAND.website}\n© 2026 BookADoctors. All rights reserved.`,
    html: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f5f1ed;font-family:Arial,Helvetica,sans-serif;color:${BRAND.dark};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f1ed;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #eadfd8;border-radius:16px;overflow:hidden;">
        <tr><td style="background:${BRAND.dark};padding:22px 28px;color:#ffffff;font-size:22px;font-weight:700;">${BRAND.name}</td></tr>
        <tr><td style="padding:30px 28px;">
          <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:${BRAND.dark};">${title}</h1>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.65;color:#4b5563;">${intro}</p>
          <div style="margin:0 0 22px;padding:18px;text-align:center;background:#fff7f2;border:1px solid #e7c8b9;border-radius:12px;">
            <span style="font-family:Consolas,Monaco,monospace;font-size:34px;font-weight:700;letter-spacing:8px;color:${BRAND.primary};">${safeOtp}</span>
          </div>
          <p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#4b5563;"><strong>This code expires in 5 minutes.</strong></p>
          <p style="margin:0 0 18px;font-size:13px;line-height:1.6;color:#6b7280;">Never share this code with anyone. BookADoctors staff will never ask for your OTP.</p>
          <p style="margin:0;padding-top:18px;border-top:1px solid #eee7e2;font-size:13px;line-height:1.6;color:#6b7280;">${ignore}</p>
        </td></tr>
        <tr><td style="padding:18px 28px;background:#faf8f6;font-size:12px;line-height:1.6;color:#7c6f67;">
          Sent to ${safeEmail}<br>
          <a href="${BRAND.website}" style="color:${BRAND.primary};text-decoration:none;">bookadoctors.com</a> · <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.primary};text-decoration:none;">${BRAND.supportEmail}</a><br>
          © 2026 BookADoctors. All rights reserved.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

module.exports = { authOtpTemplate };
