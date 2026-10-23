const { EMAIL_LOGO_CID } = require('./emailBrandAsset');
const LOGO_IMAGE = `<img src="cid:${EMAIL_LOGO_CID}" alt="BookADoctors logo" width="44" height="44" style="display:block;width:44px;height:44px;border:0;outline:none;text-decoration:none;border-radius:10px;">`;

const BRAND = {
  name: 'BookADoctors',
  website: 'https://bookadoctors.com',
  supportEmail: 'support@bookadoctors.com',
  primary: '#ad5d3b',
  dark: '#1f2937',
};

function escapeHtml(value) {
  return String(value ?? '')
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
    text: `${title}\n\n${intro}\n\n${otp}\n\nThis code expires in 5 minutes. Never share it with anyone; BookADoctors staff will never ask for it.\n\n${ignore}\n\nSent to ${email}\n${BRAND.website}\n© ${new Date().getUTCFullYear()} BookADoctors. All rights reserved.`,
    html: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f5f1ed;font-family:Arial,Helvetica,sans-serif;color:${BRAND.dark};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f1ed;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #eadfd8;border-radius:16px;overflow:hidden;">
        <tr><td style="background:${BRAND.dark};padding:22px 24px;"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td width="44"><a href="${BRAND.website}" style="text-decoration:none;">${LOGO_IMAGE}</a></td><td style="padding-left:12px;color:#ffffff;font-size:22px;font-weight:700;">${BRAND.name}</td></tr></table></td></tr>
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
          © ${new Date().getUTCFullYear()} BookADoctors. All rights reserved.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

function websiteLink(path = '/login') {
  // Never allow a notification field to redirect an email button to another site.
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\\s]/.test(path)) return `${BRAND.website}/login`;
  const url = new URL(path, BRAND.website);
  return url.origin === BRAND.website ? url.href : `${BRAND.website}/login`;
}

function notificationTemplate({ email, subject, text, type = 'system', details = [], actionPath = '/login', amount }) {
  const category = { payment: 'Payment update', appointment: 'Appointment update', queue: 'Live queue update', system: 'Account update' }[type] || 'BookADoctors update';
  const rows = Array.isArray(details) ? details.filter((r) => r && r.label && r.value != null && r.value !== '') : [];
  const url = websiteLink(actionPath);
  const paragraphs = String(text ?? '').split(/\n+/).filter(Boolean).map((line) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#55514d;overflow-wrap:anywhere;">${escapeHtml(line)}</p>`).join('');
  const amountBlock = amount != null && amount !== '' ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0;background:#f5ebe5;border:1px solid #ead5c9;border-radius:12px;"><tr><td style="padding:18px 20px;"><p style="margin:0 0 4px;color:#75675d;font-size:12px;">Amount received</p><p style="margin:0;color:${BRAND.primary};font-size:30px;font-weight:700;line-height:1.3;">${escapeHtml(amount)}</p></td></tr></table>` : '';
  const detailBlock = rows.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;border:1px solid #e8e1dc;border-radius:12px;table-layout:fixed;"><tbody>${rows.map((r) => `<tr><td width="40%" valign="top" style="padding:12px 14px;border-bottom:1px solid #eee9e5;color:#77706a;font-size:13px;line-height:1.6;overflow-wrap:anywhere;">${escapeHtml(r.label)}</td><td valign="top" style="padding:12px 14px;border-bottom:1px solid #eee9e5;color:${BRAND.dark};font-size:14px;font-weight:600;line-height:1.6;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(r.value)}</td></tr>`).join('')}</tbody></table>` : '';
  return {
    subject,
    text: `${BRAND.name}\n${subject}\n\n${text || ''}${amount != null ? `\n\nAmount received: ${amount}` : ''}${rows.length ? `\n\n${rows.map((r) => `${r.label}: ${r.value}`).join('\n')}` : ''}\n\nOpen BookADoctors: ${url}\n\nNeed help? ${BRAND.supportEmail}\nNever share your password, OTP or payment PIN.`,
    // Table layout + inline styles work without app CSS, scripts, images or web fonts.
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f2ef;color:${BRAND.dark};font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none;font-size:1px;line-height:1px;color:#f5f2ef;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(String(text || '').slice(0, 180))}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f5f2ef"><tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e8e1dc;border-radius:16px;overflow:hidden;">
<tr><td bgcolor="${BRAND.dark}" style="padding:22px 24px;border-top:5px solid ${BRAND.primary};"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td width="44"><a href="${BRAND.website}" style="text-decoration:none;">${LOGO_IMAGE}</a></td><td style="padding-left:12px;"><a href="${BRAND.website}" style="color:#ffffff;text-decoration:none;font-size:22px;line-height:1.4;font-weight:700;">${BRAND.name}</a><div style="color:#d8cec7;font-size:11px;line-height:1.6;">Care without the waiting room.</div></td></tr></table></td></tr>
<tr><td style="padding:26px 24px 24px;"><p style="margin:0 0 10px;color:${BRAND.primary};font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">${category}</p><h1 style="margin:0 0 18px;color:${BRAND.dark};font-size:25px;line-height:1.3;font-weight:700;overflow-wrap:anywhere;">${escapeHtml(subject)}</h1>${paragraphs}${amountBlock}${detailBlock}
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0 18px;"><tr><td bgcolor="${BRAND.primary}" align="center" style="border-radius:9px;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 22px;border:1px solid ${BRAND.primary};border-radius:9px;color:#ffffff;font-size:14px;line-height:1.4;font-weight:700;text-decoration:none;">Open BookADoctors &rarr;</a></td></tr></table>
<p style="margin:0;font-size:12px;line-height:1.7;color:#81786f;">View the latest status securely in your account. If the button does not open, visit <a href="${BRAND.website}/login" style="color:${BRAND.primary};">bookadoctors.com/login</a>.</p></td></tr>
<tr><td bgcolor="#faf8f6" style="padding:20px 24px;border-top:1px solid #eee9e5;"><p style="margin:0 0 6px;font-size:13px;font-weight:700;color:${BRAND.dark};">Need a hand?</p><p style="margin:0;font-size:12px;line-height:1.8;color:#77706a;">Contact <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.primary};text-decoration:underline;">${BRAND.supportEmail}</a><br>This is an automated email. Never share your password, OTP or payment PIN.</p></td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
<p style="max-width:560px;margin:16px 8px 0;font-size:11px;line-height:1.7;color:#81786f;overflow-wrap:anywhere;">${email ? `Sent to ${escapeHtml(email)}<br>` : ''}<a href="${BRAND.website}" style="color:#81786f;text-decoration:none;">bookadoctors.com</a><br>© ${new Date().getUTCFullYear()} BookADoctors. All rights reserved.</p>
</td></tr></table></body></html>`,
  };
}

module.exports = { authOtpTemplate, notificationTemplate };
