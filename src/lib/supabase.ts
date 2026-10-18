import { createClient } from "@supabase/supabase-js";
import type { User, QrLog, QrConfig, PlantQrConfig, SapMapping, SapRemap, Hierarchy } from "./store";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://qhuytbsufhmzxyzbncdf.supabase.co";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_tXh1X0eY0szqrjZQAx6WNg_eMIuxo52";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

export const isSupabaseConfigured = () => Boolean(supabaseUrl && supabaseAnonKey);

// ================= USERS =================
export async function fetchSupabaseUsers(): Promise<User[] | null> {
  try {
    const { data, error } = await supabase.from("users").select("*");
    if (error || !data) return null;
    return data.map((u) => ({
      ...u,
      locations: typeof u.locations === "string" ? JSON.parse(u.locations) : (u.locations || []),
      lines: typeof u.lines === "string" ? JSON.parse(u.lines) : (u.lines || []),
    }));
  } catch (err) {
    console.warn("Supabase fetch users failed:", err);
    return null;
  }
}

export async function upsertSupabaseUser(user: User): Promise<boolean> {
  try {
    const { error } = await supabase.from("users").upsert({
      email: user.email.toLowerCase().trim(),
      name: user.name,
      password: user.password || "otp_only",
      role: user.role,
      locations: user.locations || [],
      location: user.location || null,
      plant: user.plant || null,
      line: user.line || null,
      lines: user.lines || [],
    });
    return !error;
  } catch {
    return false;
  }
}

export async function deleteSupabaseUser(email: string): Promise<boolean> {
  try {
    const { error } = await supabase.from("users").delete().eq("email", email.toLowerCase().trim());
    return !error;
  } catch {
    return false;
  }
}

// ================= QR LOGS =================
export async function fetchSupabaseLogs(): Promise<QrLog[] | null> {
  try {
    const { data, error } = await supabase
      .from("qr_logs")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(5000);
    if (error || !data) return null;
    return data.map((l) => ({
      ...l,
      id: Number(l.id),
      timestamp: Number(l.timestamp),
    }));
  } catch {
    return null;
  }
}

export async function insertSupabaseLog(log: Omit<QrLog, "id">): Promise<QrLog | null> {
  try {
    const { data, error } = await supabase
      .from("qr_logs")
      .insert({
        qr_code: log.qr_code,
        new_qr_code: log.new_qr_code,
        sap_code: log.sap_code,
        old_sap_code: log.old_sap_code || "",
        description: log.description || "",
        month: log.month || "",
        year: log.year || "",
        week: log.week || "",
        serial: log.serial || "",
        plant: log.plant,
        location: log.location,
        line: log.line,
        user_email: log.user_email,
        timestamp: log.timestamp || Date.now(),
        print_status: log.print_status || "success",
      })
      .select()
      .single();

    if (error || !data) return null;
    return {
      ...data,
      id: Number(data.id),
      timestamp: Number(data.timestamp),
    };
  } catch {
    return null;
  }
}

export async function updateSupabaseLogStatus(id: number, status: "pending" | "success" | "failed"): Promise<boolean> {
  try {
    const { error } = await supabase.from("qr_logs").update({ print_status: status }).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

export async function clearSupabaseLogs(): Promise<boolean> {
  try {
    const { error } = await supabase.from("qr_logs").delete().neq("id", 0);
    return !error;
  } catch {
    return false;
  }
}

// ================= CONFIG =================
export async function fetchSupabaseConfig(): Promise<{ config: QrConfig; plants: PlantQrConfig[] } | null> {
  try {
    const [cfgRes, plantsRes] = await Promise.all([
      supabase.from("qr_config").select("*").eq("id", 1).single(),
      supabase.from("qr_config_plant").select("*"),
    ]);

    if (cfgRes.error && plantsRes.error) return null;

    const baseConfig: QrConfig = cfgRes.data
      ? {
          length: Number(cfgRes.data.length || 22),
          pattern: cfgRes.data.pattern || "numeric",
          sequenceValidation: Boolean(cfgRes.data.sequenceValidation),
          prefix: cfgRes.data.prefix || "",
          suffix: cfgRes.data.suffix || "",
          month_format: cfgRes.data.month_format || "MM",
          year_format: cfgRes.data.year_format || "YY",
          week_format: cfgRes.data.week_format || "WW",
          sap_length: Number(cfgRes.data.sap_length || 10),
          auto_inc_length: Number(cfgRes.data.auto_inc_length || 6),
        }
      : {
          length: 22,
          pattern: "numeric",
          sequenceValidation: false,
          prefix: "",
          suffix: "",
          month_format: "MM",
          year_format: "YY",
          week_format: "WW",
          sap_length: 10,
          auto_inc_length: 6,
        };

    const plantConfigs: PlantQrConfig[] = (plantsRes.data || []).map((p) => ({
      location: p.location,
      plant: p.plant,
      length: Number(p.length || baseConfig.length),
      pattern: p.pattern || baseConfig.pattern,
      sequenceValidation: Boolean(p.sequenceValidation),
      prefix: p.prefix || "",
      suffix: p.suffix || "",
      month_format: p.month_format || baseConfig.month_format,
      year_format: p.year_format || baseConfig.year_format,
      week_format: p.week_format || baseConfig.week_format,
      sap_length: Number(p.sap_length || baseConfig.sap_length),
      auto_inc_length: Number(p.auto_inc_length || baseConfig.auto_inc_length),
    }));

    return { config: baseConfig, plants: plantConfigs };
  } catch {
    return null;
  }
}

export async function updateSupabaseConfig(config: QrConfig): Promise<boolean> {
  try {
    const { error } = await supabase.from("qr_config").upsert({
      id: 1,
      ...config,
    });
    return !error;
  } catch {
    return false;
  }
}

export async function upsertSupabasePlantConfig(config: PlantQrConfig): Promise<boolean> {
  try {
    const { error } = await supabase.from("qr_config_plant").upsert(config, {
      onConflict: "location,plant",
    });
    return !error;
  } catch {
    return false;
  }
}

export async function deleteSupabasePlantConfig(location: string, plant: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("qr_config_plant")
      .delete()
      .eq("location", location)
      .eq("plant", plant);
    return !error;
  } catch {
    return false;
  }
}

// ================= SAP MAPPINGS & REMAP =================
export async function fetchSupabaseSap(): Promise<SapMapping[] | null> {
  try {
    const { data, error } = await supabase.from("sap_mapping").select("*");
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

export async function upsertSupabaseSap(mapping: SapMapping): Promise<boolean> {
  try {
    const { error } = await supabase.from("sap_mapping").upsert(mapping);
    return !error;
  } catch {
    return false;
  }
}

export async function deleteSupabaseSap(sap_code: string): Promise<boolean> {
  try {
    const { error } = await supabase.from("sap_mapping").delete().eq("sap_code", sap_code);
    return !error;
  } catch {
    return false;
  }
}

export async function fetchSupabaseRemap(): Promise<SapRemap[] | null> {
  try {
    const { data, error } = await supabase.from("sap_remap").select("*");
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

export async function upsertSupabaseRemap(remap: SapRemap): Promise<boolean> {
  try {
    const { error } = await supabase.from("sap_remap").upsert(remap);
    return !error;
  } catch {
    return false;
  }
}

export async function deleteSupabaseRemap(old_sap: string): Promise<boolean> {
  try {
    const { error } = await supabase.from("sap_remap").delete().eq("old_sap", old_sap);
    return !error;
  } catch {
    return false;
  }
}

// ================= HIERARCHY =================
export async function fetchSupabaseHierarchy(): Promise<Hierarchy | null> {
  try {
    const { data, error } = await supabase.from("hierarchy").select("*").eq("id", 1).single();
    if (error || !data) return null;
    return {
      locations: typeof data.locations === "string" ? JSON.parse(data.locations) : (data.locations || []),
      plants: typeof data.plants === "string" ? JSON.parse(data.plants) : (data.plants || {}),
      lines: typeof data.lines === "string" ? JSON.parse(data.lines) : (data.lines || {}),
    };
  } catch {
    return null;
  }
}

export async function saveSupabaseHierarchy(hierarchy: Hierarchy): Promise<boolean> {
  try {
    const { error } = await supabase.from("hierarchy").upsert({
      id: 1,
      locations: hierarchy.locations,
      plants: hierarchy.plants,
      lines: hierarchy.lines,
    });
    return !error;
  } catch {
    return false;
  }
}

// ================= REALTIME MULTI-USER SYNC =================
export function setupSupabaseRealtime(callbacks: {
  onNewLog?: (log: QrLog) => void;
  onLogUpdated?: (update: { id: number; print_status: "pending" | "success" | "failed" }) => void;
  onConfigUpdated?: () => void;
  onHierarchyUpdated?: () => void;
  onUsersUpdated?: () => void;
  onSapUpdated?: () => void;
}) {
  const channel = supabase
    .channel("mergex-cloud-sync")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "qr_logs" }, (payload) => {
      if (callbacks.onNewLog && payload.new) {
        callbacks.onNewLog({
          ...payload.new,
          id: Number(payload.new.id),
          timestamp: Number(payload.new.timestamp),
        } as QrLog);
      }
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "qr_logs" }, (payload) => {
      if (callbacks.onLogUpdated && payload.new) {
        callbacks.onLogUpdated({
          id: Number(payload.new.id),
          print_status: payload.new.print_status,
        });
      }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "qr_config" }, () => {
      callbacks.onConfigUpdated?.();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "qr_config_plant" }, () => {
      callbacks.onConfigUpdated?.();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "hierarchy" }, () => {
      callbacks.onHierarchyUpdated?.();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "users" }, () => {
      callbacks.onUsersUpdated?.();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "sap_mapping" }, () => {
      callbacks.onSapUpdated?.();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "sap_remap" }, () => {
      callbacks.onSapUpdated?.();
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
