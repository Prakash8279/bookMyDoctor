const fs = require('fs');
const path = require('path');

// Keep the approved artwork as a normal bundled asset instead of duplicating a long base64 blob
// in source code. The PNG is copied into the server image with src/ and remains available without
// any external request, tracking URL, or dependency on the web frontend at runtime.
const EMAIL_LOGO_CID = 'bookadoctors-brand-logo@bookadoctors.com';
const logoPath = path.join(__dirname, '..', 'assets', 'brand-logo.png');
let cachedLogoContent;

function emailLogoAttachment() {
  cachedLogoContent ||= fs.readFileSync(logoPath);
  return {
    filename: 'bookadoctors-logo.png',
    content: cachedLogoContent,
    contentType: 'image/png',
    contentDisposition: 'inline',
    cid: EMAIL_LOGO_CID,
  };
}

module.exports = { EMAIL_LOGO_CID, emailLogoAttachment };
