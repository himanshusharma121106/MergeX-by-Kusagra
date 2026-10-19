const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qhuytbsufhmzxyzbncdf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_tXh1X0eY0szqrjZQAx6WNg_eMIuxo52';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const OTP_SECRET = process.env.OTP_SECRET || 'mergex_production_secret_key_2026';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.office365.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || 'verify.software2040@pgel.in',
    pass: process.env.SMTP_PASS || 'nsxfmjjkskdrbbtt'
  },
  tls: {
    ciphers: 'SSLv3',
    rejectUnauthorized: false
  }
});

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, message: 'Method Not Allowed' }) };
  }

  try {
    const { email } = JSON.parse(event.body || '{}');
    if (!email || typeof email !== 'string') {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'Corporate email is required.' }) };
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.endsWith('@pgel.in')) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'Only authorized @pgel.in emails are permitted.' }) };
    }

    // Verify user exists in database
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .ilike('email', normalizedEmail)
      .single();

    if (userError || !user) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ success: false, message: 'This email is not registered or authorized in MergeX. Please contact your IT administrator.' })
      };
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000;

    // Stateless HMAC signature
    const signature = crypto.createHmac('sha256', OTP_SECRET)
      .update(`${normalizedEmail}:${otp}:${expiresAt}`)
      .digest('hex');

    const token = Buffer.from(JSON.stringify({ email: normalizedEmail, expiresAt, signature })).toString('base64');

    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#f8fafc;padding:24px;margin:0;">
        <div style="max-width:500px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="background:#1e3a8a;padding:24px;text-align:center;color:#ffffff;">
            <h1 style="margin:0;font-size:22px;font-weight:800;">PG GROUP · MergeX</h1>
            <p style="margin:4px 0 0;font-size:11px;letter-spacing:1px;text-transform:uppercase;opacity:0.85;">QR Remapping Platform</p>
          </div>
          <div style="padding:28px 24px;">
            <p style="font-size:15px;color:#1e293b;margin:0 0 12px;">Hello <b>${user.name || 'PG Employee'}</b>,</p>
            <p style="font-size:14px;color:#475569;margin:0 0 20px;">Use the verification code below to securely sign in to the MergeX system:</p>
            <div style="background:#f1f5f9;border:2px dashed #cbd5e1;border-radius:12px;padding:16px;text-align:center;margin:20px 0;">
              <span style="font-family:monospace;font-size:36px;font-weight:800;letter-spacing:8px;color:#1d4ed8;">${otp}</span>
              <div style="font-size:11px;color:#b45309;margin-top:8px;">⏱ Valid for 10 minutes</div>
            </div>
            <p style="font-size:12px;color:#94a3b8;margin:24px 0 0;border-top:1px solid #f1f5f9;padding-top:12px;">
              If you did not request this verification code, please disregard this email.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    await transporter.sendMail({
      from: `"MergeX Security" <${process.env.SMTP_FROM || 'verify.software2040@pgel.in'}>`,
      to: user.email,
      subject: `${otp} is your MergeX verification code`,
      text: `Your MergeX verification code is: ${otp}. It expires in 10 minutes.`,
      html
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: `OTP sent successfully to ${user.email}`, token })
    };
  } catch (err) {
    console.error('send-otp error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, message: 'Failed to send OTP email: ' + err.message })
    };
  }
};
