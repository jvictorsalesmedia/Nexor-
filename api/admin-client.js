const jsonHeaders = { "Content-Type": "application/json" };

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || serviceKey;
    if (!supabaseUrl || !serviceKey) throw new Error("Supabase server env is missing.");

    const token = String(req.headers.authorization || "").replace("Bearer ", "").trim();
    if (!token) return res.status(401).json({ error: "Missing admin session." });

    const caller = await authUser(supabaseUrl, anonKey, token);
    const profile = await restSingle(supabaseUrl, serviceKey, `/nexor_profiles?id=eq.${encodeURIComponent(caller.id)}&select=id,email,app_role,status`);
    if (!profile || profile.app_role !== "admin" || profile.status !== "ativo") {
      return res.status(403).json({ error: "Admin access required." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const action = String(body.action || "");
    if (action === "create_client") return res.status(200).json(await createClientAccount(supabaseUrl, serviceKey, body, caller.id));
    if (action === "update_client") return res.status(200).json(await updateClientAccount(supabaseUrl, serviceKey, body, caller.id));
    if (action === "delete_client") return res.status(200).json(await deleteClientAccount(supabaseUrl, serviceKey, body));
    if (action === "set_client_subscription") return res.status(200).json(await setClientSubscription(supabaseUrl, serviceKey, body));
    if (action === "set_client_login") return res.status(200).json(await setClientLogin(supabaseUrl, serviceKey, body));

    res.status(400).json({ error: "Unknown action." });
  } catch (error) {
    res.status(400).json({ error: error.message || "Nexor admin API error." });
  }
};

async function createClientAccount(supabaseUrl, serviceKey, body, callerId) {
  const payload = normalizeClientPayload(body);
  if (!payload.businessName || !payload.responsibleName || !payload.email || !payload.accessUsername || !payload.password) {
    throw new Error("Campos obrigatórios ausentes.");
  }

  const auth = await authAdmin(supabaseUrl, serviceKey, "/admin/users", {
    method: "POST",
    body: {
      email: payload.email,
      password: payload.password,
      email_confirm: true,
      user_metadata: {
        full_name: payload.responsibleName,
        business_name: payload.businessName,
        access_username: payload.accessUsername,
        slug: payload.slug
      }
    }
  });
  const user = auth.user || auth;
  if (!user?.id) throw new Error("Usuário não foi criado no Supabase Auth.");

  await upsertProfile(supabaseUrl, serviceKey, {
    id: user.id,
    email: payload.email,
    full_name: payload.responsibleName,
    gender: "neutral",
    app_role: "cliente",
    status: "ativo"
  });

  const client = await upsertClient(supabaseUrl, serviceKey, {
    auth_user_id: user.id,
    business_name: payload.businessName,
    responsible_name: payload.responsibleName,
    document: payload.document,
    email: payload.email,
    whatsapp: payload.whatsapp,
    access_username: payload.accessUsername,
    slug: payload.slug,
    monthly_value: payload.monthlyValue,
    subscription_status: payload.subscriptionStatus,
    payment_due_date: payload.paymentDueDate || null,
    last_payment_date: payload.lastPaymentDate || null,
    notes: payload.notes,
    login_blocked: false,
    created_by: callerId
  });

  await upsertPasswordNote(supabaseUrl, serviceKey, user.id, payload.password, callerId);
  return { client };
}

async function updateClientAccount(supabaseUrl, serviceKey, body, callerId) {
  const payload = normalizeClientPayload(body);
  const client = await restSingle(supabaseUrl, serviceKey, `/nexor_clients?id=eq.${encodeURIComponent(payload.id)}&select=*`);
  if (!client) throw new Error("Cliente não encontrado.");

  const authPatch = {
    email: payload.email,
    user_metadata: {
      full_name: payload.responsibleName,
      business_name: payload.businessName,
      access_username: payload.accessUsername,
      slug: payload.slug
    }
  };
  if (payload.password) authPatch.password = payload.password;
  await authAdmin(supabaseUrl, serviceKey, `/admin/users/${client.auth_user_id}`, {
    method: "PUT",
    body: authPatch
  });

  await upsertProfile(supabaseUrl, serviceKey, {
    id: client.auth_user_id,
    email: payload.email,
    full_name: payload.responsibleName,
    gender: "neutral",
    app_role: "cliente",
    status: "ativo"
  });

  const updated = await upsertClient(supabaseUrl, serviceKey, {
    id: client.id,
    auth_user_id: client.auth_user_id,
    business_name: payload.businessName,
    responsible_name: payload.responsibleName,
    document: payload.document,
    email: payload.email,
    whatsapp: payload.whatsapp,
    access_username: payload.accessUsername,
    slug: payload.slug,
    monthly_value: payload.monthlyValue,
    subscription_status: payload.subscriptionStatus,
    payment_due_date: payload.paymentDueDate || null,
    last_payment_date: payload.lastPaymentDate || null,
    notes: payload.notes,
    login_blocked: Boolean(client.login_blocked)
  });

  if (payload.password) await upsertPasswordNote(supabaseUrl, serviceKey, client.auth_user_id, payload.password, callerId);
  return { client: updated };
}

async function deleteClientAccount(supabaseUrl, serviceKey, body) {
  const client = await restSingle(supabaseUrl, serviceKey, `/nexor_clients?id=eq.${encodeURIComponent(body.clientId || "")}&select=*`);
  if (!client) throw new Error("Cliente não encontrado.");
  await authAdmin(supabaseUrl, serviceKey, `/admin/users/${client.auth_user_id}`, { method: "DELETE" });
  return { ok: true };
}

async function setClientSubscription(supabaseUrl, serviceKey, body) {
  const status = ["pago", "pendente", "atrasado"].includes(body.subscriptionStatus) ? body.subscriptionStatus : "pendente";
  const patch = {
    subscription_status: status,
    last_payment_date: body.lastPaymentDate || null
  };
  if (status === "pago") patch.login_blocked = false;
  const client = await restPatch(supabaseUrl, serviceKey, `/nexor_clients?id=eq.${encodeURIComponent(body.clientId || "")}`, patch);
  return { client };
}

async function setClientLogin(supabaseUrl, serviceKey, body) {
  const client = await restPatch(supabaseUrl, serviceKey, `/nexor_clients?id=eq.${encodeURIComponent(body.clientId || "")}`, {
    login_blocked: Boolean(body.loginBlocked)
  });
  return { client };
}

function normalizeClientPayload(body) {
  const businessName = String(body.businessName || "").trim();
  return {
    id: String(body.id || body.clientId || ""),
    businessName,
    responsibleName: String(body.responsibleName || "").trim(),
    document: String(body.document || "").trim(),
    email: String(body.email || "").trim().toLowerCase(),
    whatsapp: String(body.whatsapp || "").trim(),
    accessUsername: String(body.accessUsername || "").trim().toLowerCase(),
    password: String(body.password || ""),
    monthlyValue: Number(body.monthlyValue || 0),
    subscriptionStatus: ["pago", "pendente", "atrasado"].includes(body.subscriptionStatus) ? body.subscriptionStatus : "pendente",
    paymentDueDate: String(body.paymentDueDate || ""),
    lastPaymentDate: String(body.lastPaymentDate || ""),
    notes: String(body.notes || "").trim(),
    slug: slugify(body.slug || businessName)
  };
}

async function authUser(supabaseUrl, anonKey, token) {
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("Sessão inválida.");
  return response.json();
}

async function authAdmin(supabaseUrl, serviceKey, path, options = {}) {
  const response = await fetch(`${supabaseUrl}/auth/v1${path}`, {
    method: options.method || "GET",
    headers: { ...jsonHeaders, apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.msg || data.error_description || data.error || text || "Erro Auth Admin.");
  return data;
}

async function restSingle(supabaseUrl, serviceKey, path) {
  const rows = await restFetch(supabaseUrl, serviceKey, path);
  return Array.isArray(rows) ? rows[0] : rows;
}

async function restPatch(supabaseUrl, serviceKey, path, body) {
  const rows = await restFetch(supabaseUrl, serviceKey, path, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function upsertProfile(supabaseUrl, serviceKey, body) {
  return upsertRest(supabaseUrl, serviceKey, "/nexor_profiles?on_conflict=id", body);
}

async function upsertClient(supabaseUrl, serviceKey, body) {
  return upsertRest(supabaseUrl, serviceKey, "/nexor_clients?on_conflict=id", body);
}

async function upsertPasswordNote(supabaseUrl, serviceKey, userId, password, updatedBy) {
  return upsertRest(supabaseUrl, serviceKey, "/nexor_user_password_notes?on_conflict=user_id", {
    user_id: userId,
    password_note: password,
    updated_by: updatedBy
  });
}

async function upsertRest(supabaseUrl, serviceKey, path, body) {
  const rows = await restFetch(supabaseUrl, serviceKey, path, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function restFetch(supabaseUrl, serviceKey, path, options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1${path}`, {
    method: options.method || "GET",
    headers: {
      ...jsonHeaders,
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || data?.hint || text || "Erro PostgREST.");
  return data;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || `cliente-${Date.now().toString(36)}`;
}
