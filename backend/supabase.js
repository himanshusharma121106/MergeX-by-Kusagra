const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';

let supabase = null;
let isConnected = false;
let lastCheckTime = 0;

function getClient() {
  if (!supabase && SUPABASE_URL && SUPABASE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false }
    });
  }
  return supabase;
}

// Check if Supabase tables have been initialized
async function checkSupabaseAvailable() {
  const now = Date.now();
  if (isConnected && now - lastCheckTime < 60000) {
    return true;
  }
  try {
    const client = getClient();
    if (!client) return false;
    const { data, error } = await client.from('users').select('email').limit(1);
    if (!error) {
      isConnected = true;
      lastCheckTime = now;
      return true;
    }
    isConnected = false;
    return false;
  } catch {
    isConnected = false;
    return false;
  }
}

const supabaseService = {
  getClient,
  checkSupabaseAvailable,

  // Users
  async getUser(email, password) {
    const client = getClient();
    const { data, error } = await client
      .from('users')
      .select('*')
      .eq('email', email)
      .eq('password', password)
      .single();
    if (error || !data) return null;
    return data;
  },

  async getUserByEmail(email) {
    const client = getClient();
    const { data, error } = await client
      .from('users')
      .select('*')
      .ilike('email', email.trim())
      .single();
    if (error || !data) return null;
    return data;
  },

  async listUsers() {
    const client = getClient();
    const { data, error } = await client.from('users').select('*');
    if (error) throw error;
    return data || [];
  },

  async upsertUser(user) {
    const client = getClient();
    const { data, error } = await client.from('users').upsert(user);
    if (error) throw error;
    return data;
  },

  async deleteUser(email) {
    const client = getClient();
    const { error } = await client.from('users').delete().eq('email', email);
    if (error) throw error;
    return true;
  },

  // Config
  async getConfig() {
    const client = getClient();
    const { data: cfg } = await client.from('qr_config').select('*').eq('id', 1).single();
    const { data: plants } = await client.from('qr_config_plant').select('*');
    return {
      config: cfg || {
        length: 22, pattern: 'numeric', sequenceValidation: false,
        prefix: '', suffix: '', month_format: 'MM', year_format: 'YY',
        week_format: 'WW', sap_length: 10, auto_inc_length: 6,
        config_password: 'admin@pg123'
      },
      plants: plants || []
    };
  },

  async updateConfig(config) {
    const client = getClient();
    const { error } = await client.from('qr_config').upsert({ id: 1, ...config });
    if (error) throw error;
    return true;
  },

  async upsertPlantConfig(plantConfig) {
    const client = getClient();
    const { error } = await client.from('qr_config_plant').upsert(plantConfig);
    if (error) throw error;
    return true;
  },

  async deletePlantConfig(location, plant) {
    const client = getClient();
    const { error } = await client.from('qr_config_plant').delete().eq('location', location).eq('plant', plant);
    if (error) throw error;
    return true;
  },

  // SAP
  async listSap() {
    const client = getClient();
    const { data, error } = await client.from('sap_mapping').select('*');
    if (error) throw error;
    return data || [];
  },

  async upsertSap(sap) {
    const client = getClient();
    const { error } = await client.from('sap_mapping').upsert(sap);
    if (error) throw error;
    return true;
  },

  async deleteSap(sap_code) {
    const client = getClient();
    const { error } = await client.from('sap_mapping').delete().eq('sap_code', sap_code);
    if (error) throw error;
    return true;
  },

  // Remap
  async listRemap() {
    const client = getClient();
    const { data, error } = await client.from('sap_remap').select('*');
    if (error) throw error;
    return data || [];
  },

  async upsertRemap(remap) {
    const client = getClient();
    const { error } = await client.from('sap_remap').upsert(remap);
    if (error) throw error;
    return true;
  },

  async deleteRemap(old_sap) {
    const client = getClient();
    const { error } = await client.from('sap_remap').delete().eq('old_sap', old_sap);
    if (error) throw error;
    return true;
  },

  // Hierarchy
  async getHierarchy() {
    const client = getClient();
    const { data } = await client.from('hierarchy').select('*').eq('id', 1).single();
    if (!data) return { locations: [], plants: {}, lines: {} };
    return {
      locations: data.locations || [],
      plants: data.plants || {},
      lines: data.lines || {}
    };
  },

  async updateHierarchy(hierarchy) {
    const client = getClient();
    const { error } = await client.from('hierarchy').upsert({ id: 1, ...hierarchy });
    if (error) throw error;
    return true;
  },

  // QR Logs
  async checkDuplicate(qr_code, new_qr_code) {
    const client = getClient();
    const codes = [qr_code, new_qr_code].filter(Boolean);
    const filter = codes.map(c => `qr_code.eq."${c}",new_qr_code.eq."${c}"`).join(',');
    const { data } = await client.from('qr_logs').select('id').or(filter).limit(1);
    return data && data.length > 0;
  },

  async getLastSerial(sap_code, line) {
    const client = getClient();
    const { data } = await client
      .from('qr_logs')
      .select('serial')
      .eq('sap_code', sap_code)
      .eq('line', line)
      .order('id', { ascending: false })
      .limit(1);
    if (data && data.length > 0) return data[0].serial;
    return null;
  },

  async insertLog(log) {
    const client = getClient();
    const { data, error } = await client.from('qr_logs').insert(log).select().single();
    if (error) throw error;
    return data;
  },

  async updateLogStatus(id, print_status) {
    const client = getClient();
    const { error } = await client.from('qr_logs').update({ print_status }).eq('id', id);
    if (error) throw error;
    return true;
  },

  async clearLogs() {
    const client = getClient();
    const { error } = await client.from('qr_logs').delete().neq('id', 0);
    if (error) throw error;
    return true;
  },

  async getLogs({ limit = 50, offset = 0, plant, location, line, user, search }) {
    const client = getClient();
    let query = client.from('qr_logs').select('*', { count: 'exact' });

    if (plant) query = query.eq('plant', plant);
    if (location) query = query.eq('location', location);
    if (line) query = query.eq('line', line);
    if (user) query = query.eq('user_email', user);
    if (search) {
      query = query.or(`qr_code.ilike.%${search}%,new_qr_code.ilike.%${search}%,sap_code.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data, count, error } = await query
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return { rows: data || [], total: count || 0 };
  },

  async getStats() {
    const client = getClient();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tsToday = todayStart.getTime();
    const tsWeek = tsToday - 6 * 86400000;

    const { data: allSuccess } = await client
      .from('qr_logs')
      .select('plant, location, line, user_email, timestamp')
      .eq('print_status', 'success');

    const logs = allSuccess || [];
    const total = logs.length;
    const today = logs.filter(l => l.timestamp >= tsToday).length;
    const week = logs.filter(l => l.timestamp >= tsWeek).length;

    const byLine = {}, byUser = {}, byPlant = {}, byLocation = {};
    logs.forEach(l => {
      byLine[l.line] = (byLine[l.line] || 0) + 1;
      byUser[l.user_email] = (byUser[l.user_email] || 0) + 1;
      byPlant[l.plant] = (byPlant[l.plant] || 0) + 1;
      byLocation[l.location] = (byLocation[l.location] || 0) + 1;
    });

    return {
      total,
      today,
      week,
      byLine: Object.entries(byLine).map(([key, count]) => ({ key, count })),
      byUser: Object.entries(byUser).map(([key, count]) => ({ key, count })),
      byPlant: Object.entries(byPlant).map(([key, count]) => ({ key, count })),
      byLocation: Object.entries(byLocation).map(([key, count]) => ({ key, count }))
    };
  }
};

module.exports = supabaseService;
