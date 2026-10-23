jest.mock('nodemailer', () => {
  const transport = {sendMail:jest.fn().mockResolvedValue({messageId:'mock-email'})};
  return { createTransport:jest.fn(() => transport), testTransport:transport };
});
jest.mock('../../../src/config/logger', () => ({info:jest.fn(),warn:jest.fn(),error:jest.fn()}));
jest.mock('../../../src/config/env', () => ({isProduction:true}));

const nodemailer = require('nodemailer');
const { sendEmail, sendVerificationEmail } = require('../../../src/services/emailService');
const { authOtpTemplate } = require('../../../src/services/emailTemplates');
const original = {};
beforeAll(() => {
  for (const key of ['EMAIL_PROVIDER','EMAIL_SERVICE','EMAIL_USER','SMTP_HOST','EMAIL_FROM','EMAIL_REPLY_TO']) original[key] = process.env[key];
  Object.assign(process.env,{EMAIL_PROVIDER:'smtp',EMAIL_SERVICE:'smtp',EMAIL_USER:'noreply@bookadoctors.com',SMTP_HOST:'smtp.example.test',EMAIL_FROM:'BookADoctors <noreply@bookadoctors.com>',EMAIL_REPLY_TO:'support@bookadoctors.com'});
});
afterAll(() => {
  for (const [key,value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('a plain notification is delivered as branded HTML plus complete plain text, without a real network send', async () => {
  await sendEmail({to:'patient@example.test',subject:'Payment received',text:'₹500 recorded.',type:'payment',amount:'₹500.00',details:[{label:'Receipt number',value:'CDR-EXAMPLE'}]});
  const transport = nodemailer.testTransport;
  expect(transport.sendMail).toHaveBeenLastCalledWith(expect.objectContaining({
    from:'BookADoctors <noreply@bookadoctors.com>',replyTo:'support@bookadoctors.com',
    html:expect.stringContaining('CDR-EXAMPLE'),text:expect.stringContaining('Receipt number: CDR-EXAMPLE'),
    attachments:[expect.objectContaining({cid:'bookadoctors-brand-logo@bookadoctors.com',contentType:'image/png',contentDisposition:'inline',content:expect.any(Buffer)})],
  }));
});
test('already-formatted OTP markup is preserved, not wrapped twice', async () => {
  const message = authOtpTemplate({email:'patient@example.test',otp:'123456',purpose:'register'});
  await sendVerificationEmail({to:'patient@example.test',...message});
  const transport = nodemailer.testTransport;
  expect(transport.sendMail).toHaveBeenLastCalledWith(expect.objectContaining({html:message.html,text:message.text,
    attachments:[expect.objectContaining({cid:'bookadoctors-brand-logo@bookadoctors.com'})]}));
});
test('does not attach unrelated artwork to a caller-supplied HTML message without a CID', async () => {
  await sendEmail({to:'patient@example.test',subject:'Custom message',text:'Plain',html:'<p>Custom content</p>'});
  expect(nodemailer.testTransport.sendMail.mock.calls.at(-1)[0].attachments).toBeUndefined();
});
