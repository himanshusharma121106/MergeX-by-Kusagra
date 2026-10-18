const nodemailer = require('nodemailer');
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const host = process.env.SMTP_HOST || 'smtp.office365.com';
const port = parseInt(process.env.SMTP_PORT || '587', 10);
const user = process.env.SMTP_USER || '';
const pass = process.env.SMTP_PASS || '';
const from = process.env.SMTP_FROM || user;

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass
      },
      tls: {
        ciphers: 'SSLv3',
        rejectUnauthorized: false
      }
    });
  }
  return transporter;
}

/**
 * Sends a 6-digit OTP email to authorized users
 */
async function sendOtpEmail(toEmail, otpCode, userName = 'Employee') {
  const mailer = getTransporter();

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>MergeX Login Verification Code</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
        .container { max-width: 520px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
        .header { background: #1e3a8a; padding: 28px 24px; text-align: center; color: #ffffff; }
        .logo-title { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; margin: 0; }
        .subtitle { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; opacity: 0.85; margin-top: 6px; font-weight: 600; }
        .content { padding: 32px 28px; }
        .greeting { font-size: 16px; font-weight: 600; margin-bottom: 12px; }
        .text { font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 24px; }
        .otp-box { background: #f1f5f9; border: 2px dashed #cbd5e1; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
        .otp-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #64748b; margin-bottom: 8px; }
        .otp-code { font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 800; letter-spacing: 8px; color: #1d4ed8; margin: 0; }
        .expiry-badge { display: inline-block; margin-top: 10px; font-size: 12px; color: #b45309; background: #fef3c7; padding: 4px 10px; border-radius: 9999px; font-weight: 600; }
        .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 24px; text-align: center; font-size: 11px; color: #94a3b8; line-height: 1.5; }
        .warning { font-size: 12px; color: #64748b; border-left: 3px solid #3b82f6; padding-left: 12px; margin-top: 24px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 class="logo-title">PG GROUP · MergeX</h1>
          <div class="subtitle">QR Remapping & Tracking System</div>
        </div>
        <div class="content">
          <div class="greeting">Hello, ${userName}</div>
          <div class="text">
            You requested a one-time verification code to securely access the <strong>MergeX System</strong>.
          </div>
          
          <div class="otp-box">
            <div class="otp-label">One-Time Password (OTP)</div>
            <div class="otp-code">${otpCode}</div>
            <div class="expiry-badge">⏱ Valid for 10 minutes</div>
          </div>

          <div class="warning">
            If you did not request this verification code, please ignore this email or contact your IT security department immediately.
          </div>
        </div>
        <div class="footer">
          © ${new Date().getFullYear()} PG Group · Internal Production Systems<br>
          Sent from automated verification service (${from})
        </div>
      </div>
    </body>
    </html>
  `;

  const info = await mailer.sendMail({
    from: `"MergeX Security" <${from}>`,
    to: toEmail,
    subject: `${otpCode} is your MergeX login verification code`,
    text: `Your MergeX one-time login verification code is: ${otpCode}. It expires in 10 minutes.`,
    html
  });

  return info;
}

module.exports = {
  getTransporter,
  sendOtpEmail
};
