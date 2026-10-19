const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qhuytbsufhmzxyzbncdf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_tXh1X0eY0szqrjZQAx6WNg_eMIuxo52';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const OTP_SECRET = process.env.OTP_SECRET || 'mergex_production_secret_key_2026';

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
    const { email, otp, token } = JSON.parse(event.body || '{}');
    if (!email || !otp) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'Email and 6-digit OTP code are required.' }) };
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Verify token
    if (!token) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'No active OTP verification session. Please request a new OTP.' }) };
    }

    let payload = null;
    try {
      payload = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    } catch {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'Invalid verification token. Please request a new code.' }) };
    }

    if (payload.email !== normalizedEmail) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'Email does not match OTP session.' }) };
    }

    if (Date.now() > payload.expiresAt) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'Verification code has expired. Please request a new code.' }) };
    }

    const expectedSignature = crypto.createHmac('sha256', OTP_SECRET)
      .update(`${normalizedEmail}:${String(otp).trim()}:${payload.expiresAt}`)
      .digest('hex');

    if (expectedSignature !== payload.signature) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'Invalid 6-digit code. Please enter the correct code from your email.' }) };
    }

    // Fetch user details from Supabase
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .ilike('email', normalizedEmail)
      .single();

    if (userError || !user) {
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: 'User record not found.' }) };
    }

    if (user.locations && typeof user.locations === 'string') {
      try { user.locations = JSON.parse(user.locations); } catch {}
    }
    if (user.lines && typeof user.lines === 'string') {
      try { user.lines = JSON.parse(user.lines); } catch {}
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, user })
    };
  } catch (err) {
    console.error('verify-otp error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, message: 'Verification error: ' + err.message })
    };
  }
};
