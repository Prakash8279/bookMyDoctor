const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { notificationTemplate, authOtpTemplate } = require('../../../src/services/emailTemplates');
const { EMAIL_LOGO_CID, emailLogoAttachment } = require('../../../src/services/emailBrandAsset');

test('the embedded PNG is exactly the approved website artwork', () => {
  const asset = emailLogoAttachment();
  expect(crypto.createHash('sha256').update(asset.content).digest('hex')).toBe('ed50bd073fc3b178a6bc597995d3b4f98a34d948773427e997f7c5801831695c');
  expect(asset.content.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(asset.content.length).toBe(15858);
  expect(asset.cid).toBe(EMAIL_LOGO_CID);
});

test.each(['payment','otp'])('%s email MIME includes a matching inline logo, without SMTP or network delivery', async kind => {
  const message = kind === 'payment'
    ? notificationTemplate({subject:'Payment received',text:'Synthetic MIME test.',type:'payment'})
    : authOtpTemplate({email:'preview@example.test',otp:'123456',purpose:'register'});
  const transport = nodemailer.createTransport({streamTransport:true,buffer:true,newline:'unix'});
  const result = await transport.sendMail({from:'BookADoctors <noreply@bookadoctors.com>',to:'preview@example.test',...message,attachments:[emailLogoAttachment()]});
  const mime = result.message.toString('utf8');
  expect(mime).toContain('Content-Type: multipart/related');
  expect(mime).toContain(`Content-ID: <${EMAIL_LOGO_CID}>`);
  expect(mime).toContain('Content-Type: image/png');
  expect(mime).toContain('Content-Disposition: inline');
  expect(mime).toContain('iVBORw0KGgo');
});
