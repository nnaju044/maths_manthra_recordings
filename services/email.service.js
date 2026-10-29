/**
 * services/email.service.js
 * Email service using Nodemailer for sending OTP codes.
 * Supports Gmail, custom SMTP, and other transports via environment variables.
 */
const nodemailer = require('nodemailer');

/**
 * Mask an email address for safe logging without exposing student PII.
 * Example: student@mathsmanthra.com -> s***t@mathsmanthra.com
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const parts = email.trim().split('@');
  if (parts.length !== 2) return '***';
  const name = parts[0];
  const domain = parts[1];
  if (name.length <= 2) return `${name[0]}***@${domain}`;
  return `${name[0]}***${name[name.length - 1]}@${domain}`;
}

/**
 * Resolve SMTP transport configuration from environment variables.
 * Automatically aligns port and secure TLS mode when SMTP_SECURE is omitted:
 * - Port 465 uses direct implicit TLS (secure: true)
 * - Port 587 uses opportunistic STARTTLS (secure: false)
 * Preserves explicit SMTP_SECURE setting when provided.
 */
function resolveSmtpConfig() {
  const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();

  let secure;
  if (process.env.SMTP_SECURE !== undefined && process.env.SMTP_SECURE !== '') {
    secure = process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === true;
  } else {
    secure = (port === 465);
  }

  const isConfigured = Boolean(user && pass);

  return {
    host,
    port,
    secure,
    user,
    pass,
    isConfigured,
  };
}

/**
 * Resolve the sender "From" address with safe fallbacks:
 * 1. SMTP_FROM (primary)
 * 2. EMAIL_FROM (documented .env.example fallback)
 * 3. "${APP_NAME}" <${SMTP_USER}> (standard sender fallback)
 * 4. Default no-reply address
 */
function resolveSender(smtpUser) {
  const fromVar = (process.env.SMTP_FROM || process.env.EMAIL_FROM || '').trim();
  if (fromVar) {
    return fromVar;
  }
  const appName = (process.env.APP_NAME || 'Maths Manthra').trim();
  if (smtpUser) {
    return `"${appName}" <${smtpUser}>`;
  }
  return `"${appName}" <noreply@mathsmanthra.com>`;
}

/**
 * Categorize SMTP errors into clear diagnostic categories without leaking credentials or OTPs.
 */
function categorizeSmtpError(err) {
  if (!err) {
    return { category: 'UNKNOWN_ERROR', description: 'An unknown email error occurred.' };
  }

  const msg = (err.message || '').toLowerCase();
  const code = (err.code || '').toUpperCase();
  const responseCode = err.responseCode || (err.response ? parseInt(err.response.slice(0, 3), 10) : null);

  if (err.diagnostic === 'MISSING_CONFIG' || err.code === 'MISSING_CONFIG') {
    return {
      category: 'MISSING_CONFIG',
      description: 'SMTP credentials (SMTP_USER / SMTP_PASS) are not configured in environment variables.',
    };
  }

  if (
    code === 'EAUTH' ||
    responseCode === 535 ||
    msg.includes('username and password not accepted') ||
    msg.includes('invalid credentials') ||
    msg.includes('authentication failed') ||
    msg.includes('badcredentials')
  ) {
    return {
      category: 'AUTH_FAILED',
      description: 'SMTP authentication rejected. For Gmail, verify 2FA and ensure an App Password is used as SMTP_PASS.',
    };
  }

  if (
    code === 'ETIMEDOUT' ||
    code === 'ESOCKETTIMEDOUT' ||
    code === 'ECONNTIMEOUT' ||
    msg.includes('timeout') ||
    msg.includes('timed out')
  ) {
    return {
      category: 'CONNECTION_TIMEOUT',
      description: 'SMTP connection or handshake timed out. Check SMTP_HOST and SMTP_PORT.',
    };
  }

  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    msg.includes('connection refused')
  ) {
    return {
      category: 'CONNECTION_REFUSED',
      description: 'Could not connect to SMTP server. Verify SMTP_HOST and port accessibility.',
    };
  }

  if (
    code === 'ESOCKET' ||
    msg.includes('tls') ||
    msg.includes('ssl') ||
    msg.includes('handshake') ||
    msg.includes('wrong version number') ||
    msg.includes('starttls')
  ) {
    return {
      category: 'TLS_ERROR',
      description: 'SSL/TLS handshake error. Ensure port 465 uses secure: true or port 587 uses secure: false.',
    };
  }

  if (
    responseCode === 550 ||
    responseCode === 553 ||
    responseCode === 554 ||
    msg.includes('sender address rejected') ||
    msg.includes('recipient rejected') ||
    msg.includes('mailbox unavailable')
  ) {
    return {
      category: 'PROVIDER_REJECTED',
      description: 'The email provider rejected the sender or recipient address.',
    };
  }

  if (
    responseCode === 421 ||
    responseCode === 450 ||
    responseCode === 451 ||
    responseCode === 452 ||
    msg.includes('rate limit') ||
    msg.includes('exceeded') ||
    msg.includes('too many')
  ) {
    return {
      category: 'RATE_LIMITED',
      description: 'SMTP provider rate limit or quota exceeded.',
    };
  }

  return {
    category: 'PROVIDER_ERROR',
    description: err.message ? err.message.slice(0, 150) : 'Unexpected SMTP transport failure.',
  };
}

/**
 * Create reusable transporter using environment variables.
 * Fails fast with code MISSING_CONFIG if credentials are not configured.
 */
function createTransporter() {
  const config = resolveSmtpConfig();

  console.log('[SMTP CONFIG]', {
    host: config.host,
    port: config.port,
    secure: config.secure,
    userConfigured: Boolean(config.user),
    passConfigured: Boolean(config.pass),
    sender: resolveSender(config.user),
  });

  if (!config.isConfigured) {
    const err = new Error('SMTP credentials are not configured in environment variables (SMTP_USER / SMTP_PASS).');
    err.code = 'MISSING_CONFIG';
    err.diagnostic = 'MISSING_CONFIG';
    throw err;
  }

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    // Pool only when explicitly requested; ephemeral connections prevent stale frozen sockets in serverless
    pool: process.env.SMTP_POOL === 'true',
    maxConnections: 3,
    maxMessages: 50,

    // Bounded timeouts calibrated for serverless function execution limits
    connectionTimeout: 6000,
    greetingTimeout: 6000,
    socketTimeout: 10000,
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
 * Reset transporter singleton (useful for configuration updates or test environments).
 */
function resetTransporter() {
  transporter = null;
}

/**
 * Send OTP email to a student.
 *
 * @param {string} to      — Recipient email
 * @param {string} otp     — The 6-digit OTP code
 * @returns {Promise<object>} Nodemailer send result
 */
async function sendOTPEmail(to, otp) {
  const from = resolveSender(process.env.SMTP_USER);
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
  console.log(`[EMAIL] OTP sent to ${maskEmail(to)} — MessageId: ${result.messageId}`);
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
  resolveSmtpConfig,
  resolveSender,
  categorizeSmtpError,
  resetTransporter,
  maskEmail,
};
