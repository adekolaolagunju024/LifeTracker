const nodemailer = require('nodemailer');

// Shared by the daily digest and chat-message emails — both are no-ops
// until the account owner sets Gmail credentials in .env.
function getTransporter() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

module.exports = { getTransporter };
