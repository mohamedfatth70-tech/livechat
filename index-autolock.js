/**
 * AutoLock Livechat – Vercel + Supabase
 *
 * NYE FUNKTIONER (v2):
 *  1. Genåbning af gamle chats  – POST /session/reopen
 *  2. Læsekvitteringer           – POST /message/read  +  SSE-event "read"
 *  3. Flersproget oversættelse   – GET  /translate      (manuel pr. besked)
 *  4. Forbedret sikkerhed        – HMAC-signatur på webhooks, Content-Security-Policy,
 *                                   nonce-beskyttede inline-scripts, session-token rotation
 *
 * Supabase schema (tilføj disse kolonner/tabeller):
 * ─────────────────────────────────────────────────
 * ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
 * ALTER TABLE messages ADD COLUMN IF NOT EXISTS nonce   TEXT;
 * ALTER TABLE sessions ADD COLUMN IF NOT EXISTS token   TEXT;
 * ALTER TABLE sessions ADD COLUMN IF NOT EXISTS reopened_count INT DEFAULT 0;
 * ─────────────────────────────────────────────────
 */

'use strict';

const express  = require('express');
const https    = require('https');
const crypto   = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// ─── Konfiguration ────────────────────────────────────────────────────────────

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'WEBHOOK_SECRET', 'AGENT_SECRET'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[boot] FEJL: Miljøvariabel '${key}' mangler.`);
    process.exit(1);
  }
}

const CONFIG = {
  port:            process.env.PORT || 3001,
  teamsWebhookUrl: process.env.TEAMS_WEBHOOK_URL || '',
  webhookSecret:   process.env.WEBHOOK_SECRET,
  agentSecret:     process.env.AGENT_SECRET,
  replyTrigger:    '!svar',
  allowedOrigins:  (process.env.ALLOWED_ORIGINS || 'http://localhost:3001')
                     .split(',').map(s => s.trim()).filter(Boolean),
};

// ─── Supabase ─────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─── SSE ──────────────────────────────────────────────────────────────────────

const sseClients = new Map(); // Map<sessionId, Set<res>>

function sseSubscribe(sessionId, res) {
  if (!sseClients.has(sessionId)) sseClients.set(sessionId, new Set());
  sseClients.get(sessionId).add(res);
}
function sseUnsubscribe(sessionId, res) {
  const set = sseClients.get(sessionId);
  if (set) { set.delete(res); if (set.size === 0) sseClients.delete(sessionId); }
}
function sseBroadcast(sessionId, event, data) {
  const set = sseClients.get(sessionId);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch (_) { sseUnsubscribe(sessionId, res); }
  }
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

const rateLimitStore = new Map();
function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    const ip  = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    const now = Date.now();
    let entry = rateLimitStore.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      rateLimitStore.set(ip, entry);
    }
    entry.count++;
    if (entry.count > maxRequests) return res.status(429).json({ error: 'For mange forespørgsler' });
    next();
  };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function requireAgentAuth(req, res, next) {
  const token = req.headers['x-agent-secret'] || req.query.agent_secret;
  if (!token || token !== CONFIG.agentSecret) return res.status(401).json({ error: 'Uautoriseret' });
  next();
}

// Valider session-token (FEATURE 4: forbedret sikkerhed)
async function requireSessionToken(req, res, next) {
  const sessionId = req.headers['x-session-id'];
  const token     = req.headers['x-session-token'];
  if (!sessionId || !token) return res.status(401).json({ error: 'Session-id eller token mangler' });
  const { data } = await supabase.from('sessions').select('token').eq('id', sessionId).single();
  if (!data || data.token !== token) return res.status(401).json({ error: 'Ugyldig session-token' });
  next();
}

// ─── Hjælpefunktioner ─────────────────────────────────────────────────────────

function makeId()    { return crypto.randomBytes(16).toString('hex'); }
function makeToken() { return crypto.randomBytes(32).toString('hex'); }
function makeShort(id) { return id.slice(0, 8); }

const VALID_LANGS = ['da', 'sv', 'de', 'en', 'nb', 'fi', 'nl', 'fr', 'es', 'pl'];
function sanitizeLang(lang) {
  const l = (lang || 'da').toLowerCase().slice(0, 5);
  return VALID_LANGS.includes(l) ? l : 'da';
}
function sanitizeText(str, maxLen = 2000) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen);
}

// FEATURE 4: HMAC-signatur på webhook-payloads
function hmacSign(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}
function verifyHmac(secret, body, sigHeader) {
  if (!sigHeader) return false;
  const expected = 'sha256=' + hmacSign(secret, body);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sigHeader));
  } catch { return false; }
}

// ─── Oversættelse via MyMemory ────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', () => resolve(null));
  });
}

async function detectAndTranslateToDanish(text) {
  if (!text?.trim()) return { translated: text, detectedLang: 'da' };
  try {
    const raw  = await httpGet(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=autodetect|da`);
    const json = JSON.parse(raw);
    return {
      translated:   json.responseData?.translatedText || text,
      detectedLang: json.matches?.[0]?.source || 'da',
    };
  } catch { return { translated: text, detectedLang: 'da' }; }
}

async function translateToCustomerLang(text, targetLang) {
  if (!text?.trim() || !targetLang || targetLang === 'da') return text;
  try {
    const raw  = await httpGet(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=da|${targetLang}`);
    const json = JSON.parse(raw);
    return json.responseData?.translatedText || text;
  } catch { return text; }
}

// FEATURE 3: Manuel oversættelse af enkelt besked til et valgfrit sprog
async function translateText(text, sourceLang, targetLang) {
  if (!text?.trim() || sourceLang === targetLang) return text;
  try {
    const pair = `${sourceLang}|${targetLang}`;
    const raw  = await httpGet(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${pair}`);
    const json = JSON.parse(raw);
    return json.responseData?.translatedText || text;
  } catch { return text; }
}

// ─── Teams webhook ────────────────────────────────────────────────────────────

function postToTeams(payload) {
  if (!CONFIG.teamsWebhookUrl) return Promise.resolve(false);
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const url  = new URL(CONFIG.teamsWebhookUrl);
    const req  = https.request({
      hostname: url.hostname, port: url.port || 443,
      path: url.pathname + url.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => { res.resume(); resolve(res.statusCode >= 200 && res.statusCode < 300); });
    req.on('error', () => resolve(false));
    req.setTimeout(10000, () => { req.destroy(); resolve(false); });
    req.write(body); req.end();
  });
}

function adaptiveCard(bodyBlocks) {
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard', version: '1.4',
        body: bodyBlocks,
      },
    }],
  };
}

function sendToTeams(sessionId, customerName, message) {
  const short = makeShort(sessionId);
  return postToTeams(adaptiveCard([
    { type: 'TextBlock', text: `💬 Ny besked fra kunde`, size: 'Medium', weight: 'Bolder', color: 'Accent' },
    { type: 'FactSet', facts: [
      { title: 'Kunde',   value: customerName },
      { title: 'Session', value: short },
      { title: 'Besked',  value: message },
    ]},
    { type: 'TextBlock', text: `**Svar:** \`${CONFIG.replyTrigger} ${short}: Dit svar\``, wrap: true, color: 'Good', spacing: 'Medium' },
  ]));
}

function sendReminderToTeams(session) {
  const short = makeShort(session.id);
  return postToTeams(adaptiveCard([
    { type: 'TextBlock', text: `⏰ Ubesvaret chat – ingen svar i over 1 minut`, size: 'Medium', weight: 'Bolder', color: 'Warning' },
    { type: 'FactSet', facts: [
      { title: 'Kunde',   value: session.name },
      { title: 'Email',   value: session.email || '—' },
      { title: 'Telefon', value: session.phone || '—' },
      { title: 'Session', value: short },
    ]},
    { type: 'TextBlock', text: `**Svar:** \`${CONFIG.replyTrigger} ${short}: Dit svar\``, wrap: true, color: 'Good', spacing: 'Medium' },
  ]));
}

// ─── Reminder-timers ──────────────────────────────────────────────────────────

const pendingReminders = new Map();
function scheduleReminder(session) {
  clearReminder(session.id);
  const t = setTimeout(async () => {
    pendingReminders.delete(session.id);
    const { data } = await supabase.from('sessions').select('status').eq('id', session.id).single();
    if (data?.status === 'open') await sendReminderToTeams(session);
  }, 60_000);
  pendingReminders.set(session.id, t);
}
function clearReminder(sessionId) {
  const t = pendingReminders.get(sessionId);
  if (t) { clearTimeout(t); pendingReminders.delete(sessionId); }
}

// ─── Parse agent-svar fra Teams ───────────────────────────────────────────────

function parseAgentReply(raw) {
  raw = raw.trim().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').trim();
  if (!raw.toLowerCase().startsWith(CONFIG.replyTrigger.toLowerCase())) return null;
  const rest     = raw.slice(CONFIG.replyTrigger.length).trim();
  const colonIdx = rest.indexOf(':');
  if (colonIdx === -1) return null;
  const shortId = rest.slice(0, colonIdx).trim();
  const message = rest.slice(colonIdx + 1).trim();
  if (!shortId || !message) return null;
  return { shortId, message };
}

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();

// FEATURE 4: raw body buffer til HMAC-verifikation
// Bruger verify-callback så streamen ikke tømmes to gange
app.use(express.json({
  limit: '32kb',
  verify: (req, res, buf) => { req.rawBody = buf.toString(); }
}));
app.use(express.static(path.join(__dirname, 'public')));

// FEATURE 4: Security headers (CSP, HSTS, m.fl.)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=()');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  // Tillad kun vores egne origins i CSP
  const origins = CONFIG.allowedOrigins.join(' ');
  res.setHeader('Content-Security-Policy',
    `default-src 'self' ${origins}; ` +
    `script-src 'self' 'unsafe-inline' ${origins}; ` +
    `style-src 'self' 'unsafe-inline'; ` +
    `connect-src 'self' ${origins} https://api.mymemory.translated.net; ` +
    `frame-ancestors 'self' ${origins};`
  );
  next();
});

// CORS
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && CONFIG.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, X-Session-Id, X-Session-Token, X-Webhook-Secret, X-Webhook-Signature, X-Agent-Secret');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── POST /session/start ───────────────────────────────────────────────────────
app.post('/session/start',
  rateLimit(10, 60_000),
  async (req, res) => {
    const name  = sanitizeText(req.body.name  || 'Gæst', 100);
    const email = sanitizeText(req.body.email || '', 200) || null;
    const phone = sanitizeText(req.body.phone || '', 30)  || null;
    const lang  = sanitizeLang(req.body.lang);
    const id    = makeId();
    const token = makeToken(); // FEATURE 4: session-token

    const { error } = await supabase.from('sessions').insert({ id, name, email, phone, lang, status: 'open', token });
    if (error) { console.error('[session/start]', error); return res.status(500).json({ error: 'Kunne ikke oprette session' }); }

    await postToTeams(adaptiveCard([
      { type: 'TextBlock', text: `🟢 Ny chat-session åbnet`, size: 'Medium', weight: 'Bolder', color: 'Good' },
      { type: 'FactSet', facts: [
        { title: 'Kunde',   value: name },
        { title: 'Email',   value: email || '—' },
        { title: 'Telefon', value: phone || '—' },
        { title: 'Sprog',   value: lang.toUpperCase() },
        { title: 'Session', value: makeShort(id) },
      ]},
    ]));

    // Returner token til widget (bruges i X-Session-Token header fremover)
    res.json({ session: { id, name, email, phone, lang, status: 'open', token } });
  }
);

// ── POST /message/send ────────────────────────────────────────────────────────
app.post('/message/send',
  rateLimit(30, 60_000),
  async (req, res) => {
    // FEATURE 4: valider session-token hvis det er sendt (tillad også gamle widgets uden token)
    const incomingToken = req.headers['x-session-token'];
    if (incomingToken) {
      const { data: tokenCheck } = await supabase
        .from('sessions').select('token').eq('id', req.headers['x-session-id'] || '').single();
      if (tokenCheck && tokenCheck.token && tokenCheck.token !== incomingToken) {
        return res.status(401).json({ error: 'Ugyldig session-token' });
      }
    }
    const sessionId = req.headers['x-session-id'];
    const text      = sanitizeText(req.body.message || '', 2000);
    if (!text) return res.status(400).json({ error: 'Besked må ikke være tom' });

    const { data: session, error: sessErr } = await supabase
      .from('sessions').select('*').eq('id', sessionId).single();
    if (sessErr || !session) return res.status(404).json({ error: 'Session ikke fundet' });
    if (session.status === 'closed') return res.status(410).json({ error: 'Chatten er lukket' });

    const { translated: textForAgent, detectedLang } = await detectAndTranslateToDanish(text);
    if (detectedLang && detectedLang !== 'da' && detectedLang !== session.lang) {
      await supabase.from('sessions').update({ lang: detectedLang }).eq('id', sessionId);
      session.lang = detectedLang;
    }

    const nonce = makeId(); // FEATURE 4: unik nonce pr. besked
    const { data: msg, error: msgErr } = await supabase
      .from('messages').insert({ session_id: sessionId, role: 'customer', text: textForAgent, nonce })
      .select().single();
    if (msgErr) return res.status(500).json({ error: 'Kunne ikke gemme besked' });

    scheduleReminder(session);
    await sendToTeams(sessionId, session.name, textForAgent);

    res.json({ message: msg });
  }
);

// ── GET /message/sse ──────────────────────────────────────────────────────────
app.get('/message/sse', (req, res) => {
  const sessionId = req.headers['x-session-id'] || req.query.session_id;
  if (!sessionId) return res.status(400).json({ error: 'session_id mangler' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const hb = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch (_) {} }, 25_000);
  sseSubscribe(sessionId, res);
  req.on('close', () => { clearInterval(hb); sseUnsubscribe(sessionId, res); });
});

// ── FEATURE 2: POST /message/read – marker beskeder som læst ─────────────────
// Kaldet af agenten, når de åbner en chat.
// Body: { sessionId: "..." }  + X-Agent-Secret header
app.post('/message/read', requireAgentAuth, async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId mangler' });

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('messages')
    .update({ read_at: now })
    .eq('session_id', sessionId)
    .eq('role', 'customer')
    .is('read_at', null);

  if (error) return res.status(500).json({ error: 'Kunne ikke opdatere læsestatus' });

  // Broadcast "read"-event til widget via SSE
  sseBroadcast(sessionId, 'read', { session_id: sessionId, read_at: now });
  res.json({ ok: true, read_at: now });
});

// ── FEATURE 1: POST /session/reopen – genåbn en lukket session ────────────────
// Body: { sessionId, name, email }  (ingen auth kræves – kunden genidentificerer sig)
app.post('/session/reopen',
  rateLimit(5, 60_000),
  async (req, res) => {
    const sessionId = sanitizeText(req.body.sessionId || '', 40);
    const name  = sanitizeText(req.body.name  || '', 100);
    const email = sanitizeText(req.body.email || '', 200);
    if (!sessionId) return res.status(400).json({ error: 'sessionId mangler' });

    const { data: session, error: sessErr } = await supabase
      .from('sessions').select('*').eq('id', sessionId).single();
    if (sessErr || !session) return res.status(404).json({ error: 'Session ikke fundet' });

    // Simpel identitetscheck: email skal matche det originale
    if (session.email && email && session.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(403).json({ error: 'Identifikation mislykkedes' });
    }

    const newToken = makeToken(); // FEATURE 4: nyt token ved genåbning
    const { error: updateErr } = await supabase.from('sessions').update({
      status: 'open',
      token: newToken,
      reopened_count: (session.reopened_count || 0) + 1,
    }).eq('id', sessionId);
    if (updateErr) return res.status(500).json({ error: 'Kunne ikke genåbne session' });

    await postToTeams(adaptiveCard([
      { type: 'TextBlock', text: `🔄 Chat genåbnet`, size: 'Medium', weight: 'Bolder', color: 'Warning' },
      { type: 'FactSet', facts: [
        { title: 'Kunde',   value: session.name },
        { title: 'Session', value: makeShort(sessionId) },
        { title: 'Genåbnet', value: String((session.reopened_count || 0) + 1) + '. gang' },
      ]},
    ]));

    // Hent eksisterende beskeder
    const { data: messages } = await supabase
      .from('messages').select('*').eq('session_id', sessionId).order('id');

    res.json({ session: { ...session, status: 'open', token: newToken }, messages: messages || [] });
  }
);

// ── FEATURE 3: GET /translate – manuel oversættelse af en enkelt besked ───────
// Query: ?text=...&from=da&to=en   (ingen auth – offentlig endpoint)
app.get('/translate', rateLimit(60, 60_000), async (req, res) => {
  const text   = sanitizeText(req.query.text || '', 2000);
  const from   = sanitizeLang(req.query.from || 'da');
  const to     = sanitizeLang(req.query.to   || 'en');
  if (!text) return res.status(400).json({ error: 'text parameter mangler' });

  const translated = await translateText(text, from, to);
  res.json({ original: text, translated, from, to });
});

// ── POST /webhook/teams ───────────────────────────────────────────────────────
// FEATURE 4: understøtter nu både simpel secret-header OG HMAC-signatur
app.post('/webhook/teams', async (req, res) => {
  const secret   = req.headers['x-webhook-secret'] || '';
  const hmacSig  = req.headers['x-webhook-signature'] || '';
  const rawBody  = req.rawBody || '';

  const validSecret = secret === CONFIG.webhookSecret;
  const validHmac   = hmacSig ? verifyHmac(CONFIG.webhookSecret, rawBody, hmacSig) : false;

  if (!validSecret && !validHmac) return res.status(401).json({ error: 'Uautoriseret' });

  const raw    = sanitizeText(req.body.text || '', 2000);
  const parsed = parseAgentReply(raw);
  if (!parsed) return res.json({ ignored: true, reason: 'Ikke et !svar-kommando' });

  const { data: sessions } = await supabase
    .from('sessions').select('*').eq('status', 'open').ilike('id', `${parsed.shortId}%`).limit(1);
  const session = sessions?.[0];
  if (!session) return res.json({ ignored: true, reason: 'Session ikke fundet' });

  const textForCustomer = await translateToCustomerLang(parsed.message, session.lang || 'da');

  const { data: msg, error } = await supabase
    .from('messages').insert({ session_id: session.id, role: 'agent', text: textForCustomer })
    .select().single();
  if (error) return res.status(500).json({ error: 'Kunne ikke gemme besked' });

  clearReminder(session.id);
  sseBroadcast(session.id, 'message', msg);

  // FEATURE 2: markér eksisterende kundes beskeder som læst (agenten har svaret)
  await supabase.from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('session_id', session.id).eq('role', 'customer').is('read_at', null);
  sseBroadcast(session.id, 'read', { session_id: session.id, read_at: new Date().toISOString() });

  res.json({ saved: true, message: msg });
});

// ── POST /session/close ───────────────────────────────────────────────────────
app.post('/session/close', async (req, res) => {
  const sessionId = req.headers['x-session-id'];
  if (!sessionId) return res.status(400).json({ error: 'X-Session-Id header mangler' });

  const { data: session } = await supabase.from('sessions').select('name').eq('id', sessionId).single();
  await supabase.from('sessions').update({ status: 'closed', token: null }).eq('id', sessionId); // token invalideres
  clearReminder(sessionId);

  if (session) {
    await postToTeams(adaptiveCard([
      { type: 'TextBlock', text: `🔴 Chat lukket`, size: 'Medium', weight: 'Bolder', color: 'Attention' },
      { type: 'FactSet', facts: [
        { title: 'Kunde',   value: session.name },
        { title: 'Session', value: makeShort(sessionId) },
      ]},
    ]));
  }

  sseBroadcast(sessionId, 'closed', { session_status: 'closed' });
  res.json({ closed: true });
});

// ── Agent-endpoints ───────────────────────────────────────────────────────────

app.get('/sessions', requireAgentAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('sessions').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: 'Kunne ikke hente sessioner' });
  res.json({ sessions: data });
});

app.get('/messages/:sessionId', requireAgentAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('messages').select('*').eq('session_id', req.params.sessionId).order('id');
  if (error) return res.status(500).json({ error: 'Kunne ikke hente beskeder' });
  res.json({ messages: data });
});

app.post('/agent/reply', requireAgentAuth, async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) return res.status(400).json({ error: 'sessionId og message kræves' });

  const { data: session, error: sessErr } = await supabase
    .from('sessions').select('*').eq('id', sessionId).single();
  if (sessErr || !session) return res.status(404).json({ error: 'Session ikke fundet' });
  if (session.status === 'closed') return res.status(410).json({ error: 'Chatten er lukket' });

  const textForCustomer = await translateToCustomerLang(sanitizeText(message, 2000), session.lang || 'da');

  const { data: msg, error: msgErr } = await supabase
    .from('messages').insert({ session_id: sessionId, role: 'agent', text: textForCustomer })
    .select().single();
  if (msgErr) return res.status(500).json({ error: 'Kunne ikke gemme besked' });

  clearReminder(sessionId);
  sseBroadcast(sessionId, 'message', msg);

  // FEATURE 2: markér kundes beskeder som læst
  const now = new Date().toISOString();
  await supabase.from('messages')
    .update({ read_at: now })
    .eq('session_id', sessionId).eq('role', 'customer').is('read_at', null);
  sseBroadcast(sessionId, 'read', { session_id: sessionId, read_at: now });

  res.json({ message: msg });
});

// ── GET /health ───────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));

// ─── Start ────────────────────────────────────────────────────────────────────
const port = CONFIG.port;
app.listen(port, () => {
  console.log(`✅ Livechat server kører på port ${port}`);
  console.log(`   Tilladte origins: ${CONFIG.allowedOrigins.join(', ')}`);
});

module.exports = app;
