const { notificationTemplate, authOtpTemplate } = require('../../../src/services/emailTemplates');

describe('branded transaction email', () => {
  test.each(['payment','appointment','queue','system','other'])('formats %s with a mobile-safe layout and plain text alternative', type => {
    const result = notificationTemplate({email:'patient@example.test',subject:'Update received',text:'First line\nSecond line',type});
    expect(result.html).toContain('name="viewport"');
    expect(result.html).toContain('max-width:600px');
    expect(result.html).toContain('role="presentation"');
    expect(result.html).toContain('support@bookadoctors.com');
    expect(result.html).toContain('src="cid:bookadoctors-brand-logo@bookadoctors.com"');
    expect(result.html).toContain('alt="BookADoctors logo"');
    expect(result.html).toContain('Open BookADoctors');
    expect(result.text).toContain('First line\nSecond line');
    expect(result.text).toContain('https://bookadoctors.com/login');
  });
  test('renders receipt and amount as text, escaping every untrusted value', () => {
    const result = notificationTemplate({email:'<user>@example.test',subject:'<script>x</script>',text:'<img src=x onerror=alert(1)>',amount:'₹500.00',details:[{label:'<Receipt>',value:'<svg onload=alert(1)>'},{label:'Empty',value:null}],actionPath:'/patient/payments'});
    expect(result.html).not.toMatch(/<script>|<img src=x|<svg /);
    expect(result.html).toContain('&lt;Receipt&gt;');
    expect(result.html).toContain('&lt;svg');
    expect(result.html).not.toContain('>Empty<');
    expect(result.html).toContain('₹500.00');
    expect(result.text).toContain('Amount received: ₹500.00');
    expect(result.html).toContain('href="https://bookadoctors.com/patient/payments"');
    expect(Buffer.byteLength(result.html)).toBeLessThan(50000);
  });
  test.each(['https://evil.example','//evil.example','/\\evil.example','javascript:alert(1)','/\n/evil.example'])('rejects an unsafe email action: %s', actionPath => {
    const result = notificationTemplate({subject:'Update',text:'Body',actionPath});
    expect(result.text).toContain('Open BookADoctors: https://bookadoctors.com/login');
    expect(result.html).not.toContain('href="https://evil.example');
  });
  test.each(['register','password-reset'])('retains formatted %s OTP and security instructions', purpose => {
    const result = authOtpTemplate({email:'patient@example.test',otp:'123456',purpose});
    expect(result.html).toContain('123456');
    expect(result.html).toContain('src="cid:bookadoctors-brand-logo@bookadoctors.com"');
    expect(result.html).toContain('expires in 5 minutes');
    expect(result.html).toContain('Never share');
    expect(result.text).toContain('123456');
  });
});
