const jsonHeaders = { "Content-Type": "application/json" };

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
    if (!supabaseUrl || !serviceKey) throw new Error("Supabase server env is missing.");

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const payload = normalizeSignupRequest(body);
    validateSignupRequest(payload);

    const existingClients = await restFetch(
      supabaseUrl,
      serviceKey,
      `/nexor_clients?or=(email.eq.${encodeURIComponent(payload.email)},access_username.eq.${encodeURIComponent(payload.accessUsername)})&select=id&limit=1`
    );
    if (existingClients.length) {
      res.status(409).json({ error: "JÃ¡ existe uma conta com este e-mail ou usuÃ¡rio de acesso." });
      return;
    }

    const rows = await restFetch(supabaseUrl, serviceKey, "/nexor_signup_requests", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        business_name: payload.businessName,
        responsible_name: payload.responsibleName,
        document: payload.document,
        email: payload.email,
        whatsapp: payload.whatsapp,
        access_username: payload.accessUsername,
        password_note: payload.password,
        responsible_photo_data_url: payload.photoDataUrl,
        status: "pendente"
      }
    });

    res.status(200).json({ request: rows[0] });
  } catch (error) {
    const message = error.message || "NÃ£o foi possÃ­vel enviar o prÃ©-cadastro.";
    const status = /duplicate|unique|nexor_signup_requests_pending_email/i.test(message) ? 409 : 400;
    res.status(status).json({ error: status === 409 ? "JÃ¡ existe um prÃ©-cadastro pendente para este e-mail." : message });
  }
};

function normalizeSignupRequest(body) {
  const email = String(body.email || "").trim().toLowerCase();
  const businessName = String(body.businessName || "").trim();
  const accessUsername = String(body.accessUsername || email.split("@")[0] || "").trim().toLowerCase();
  return {
    businessName,
    responsibleName: String(body.responsibleName || "").trim(),
    document: String(body.document || "").trim(),
    email,
    whatsapp: String(body.whatsapp || "").trim(),
    accessUsername,
    password: String(body.password || ""),
    photoDataUrl: String(body.photoDataUrl || "")
  };
}

function validateSignupRequest(payload) {
  if (!payload.responsibleName || !payload.email || !payload.password) {
    throw new Error("Informe nome do responsÃ¡vel, e-mail e senha.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    throw new Error("Informe um e-mail vÃ¡lido.");
  }
  if (payload.password.length < 6) {
    throw new Error("Use uma senha com pelo menos 6 caracteres.");
  }
  if (!payload.photoDataUrl || !/^data:image\/(png|jpe?g|webp);base64,/i.test(payload.photoDataUrl)) {
    throw new Error("Envie uma foto do responsÃ¡vel.");
  }
  if (payload.photoDataUrl.length > 1800000) {
    throw new Error("A foto estÃ¡ muito grande. Envie uma imagem menor.");
  }
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
  return Array.isArray(data) ? data : [];
}
