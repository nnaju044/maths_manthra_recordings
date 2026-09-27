/**
 * services/email.service.js
 * Email service using Nodemailer for sending OTP codes.
 * Supports Gmail, custom SMTP, and other transports via environment variables.
 */
const nodemailer = require('nodemailer');

/**
 * Create reusable transporter using environment variables.
 *
 * Required env vars:
 *   SMTP_HOST     — e.g. smtp.gmail.com
 *   SMTP_PORT     — e.g. 587
 *   SMTP_USER     — e.g. yourapp@gmail.com
 *   SMTP_PASS     — app password (NOT your Gmail login password)
 *   SMTP_FROM     — e.g. "Maths Manthra" <noreply@mathsmanthra.com>
 *
 * For Gmail:
 *   1. Enable 2FA on Google account
 *   2. Generate an "App Password" at https://myaccount.google.com/apppasswords
 *   3. Use that as SMTP_PASS
 */
function createTransporter() {

  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  const secure = process.env.SMTP_SECURE === 'true';

  console.log('[SMTP CONFIG]', {
    host,
    port,
    secure,
    user: process.env.SMTP_USER,
  });

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    pool: true,
    maxConnections: 3,
    maxMessages: 50,

    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

let transporter = null;

/**
 * Get (or lazily create) the transporter singleton.
 */
function getTransporter() {
  if (!transporter) {
    transporter = createTransporter();
  }
  return transporter;
}

/**
 * Send OTP email to a student.
 *
 * @param {string} to      — Recipient email
 * @param {string} otp     — The 6-digit OTP code
 * @returns {Promise<object>} Nodemailer send result
 */
async function sendOTPEmail(to, otp) {
  const from = process.env.SMTP_FROM || `"Maths Manthra" <${process.env.SMTP_USER}>`;
  const appName = process.env.APP_NAME || 'Maths Manthra';

  const mailOptions = {
    from,
    to,
    subject: `${otp} — Your Certificate Verification Code | ${appName}`,
    text: [
      `Your certificate verification code is: ${otp}`,
      '',
      'This code expires in 10 minutes.',
      'If you did not request this code, please ignore this email.',
      '',
      `— ${appName} Academy`,
    ].join('\n'),
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="margin:0;padding:0;background:#f4f6f8;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
        <div style="max-width:480px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          
          <!-- Header -->
          <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:32px 24px;text-align:center;">
            <div style="font-size:36px;margin-bottom:8px;">🎓</div>
            <h1 style="color:#ffffff;font-size:22px;margin:0;font-weight:700;">${appName}</h1>
            <p style="color:rgba(255,255,255,0.85);font-size:13px;margin:6px 0 0;">Certificate Verification</p>
          </div>

          <!-- Body -->
          <div style="padding:32px 24px;">
            <p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 24px;">
              Use the following verification code to access your certificates:
            </p>

            <!-- OTP Box -->
            <div style="background:#f0f4ff;border:2px dashed #667eea;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
              <div style="font-size:36px;font-weight:800;letter-spacing:12px;color:#333;font-family:monospace;">
                ${otp}
              </div>
            </div>

            <p style="color:#888;font-size:13px;line-height:1.5;margin:0 0 8px;">
              ⏱️ This code expires in <strong>10 minutes</strong>.
            </p>
            <p style="color:#888;font-size:13px;line-height:1.5;margin:0;">
              If you did not request this code, you can safely ignore this email.
            </p>
          </div>

          <!-- Footer -->
          <div style="background:#f9fafb;padding:16px 24px;text-align:center;border-top:1px solid #eee;">
            <p style="color:#aaa;font-size:11px;margin:0;">
              📐 ${appName} Academy — Private Recorded Classes Portal
            </p>
          </div>
        </div>
      </body>
      </html>
    `,
  };

  const transport = getTransporter();
  const result = await transport.sendMail(mailOptions);
  console.log(`[EMAIL] OTP sent to ${to} — MessageId: ${result.messageId}`);
  return result;
}

/**
 * Verify transporter connection (useful for health checks / startup).
 */
async function verifyConnection() {
  try {
    const transport = getTransporter();
    await transport.verify();
    console.log('[EMAIL] SMTP connection verified ✓');
    return true;
  } catch (err) {
    console.error('[EMAIL] SMTP connection failed:', err.message);
    return false;
  }
}

module.exports = {
  sendOTPEmail,
  verifyConnection,
};
