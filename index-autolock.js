/**
 * AutoLock Livechat – Vercel + Supabase
 *
 * Ændringer fra original:
 *  - In-memory Map() erstattet med Supabase (PostgreSQL)
 *  - Long-polling erstattet med Server-Sent Events (SSE)
 *  - Rate limiting på /session/start og /message/send
 *  - Auth-middleware på agent-endpoints (/sessions, /messages, /agent/reply)
 *  - CORS begrænset til kendte domæner via ALLOWED_ORIGINS env-variabel
 *  - Input-validering og maks-længder på alle endpoints
 *  - Webhook-secret valideres altid (ingen usikker fallback)
 *
 * Supabase tabeller (kør i Supabase SQL editor):
 * ─────────────────────────────────────────────
 * CREATE TABLE sessions (
 *   id          TEXT PRIMARY KEY,
 *   name        TEXT NOT NULL,
 *   email       TEXT,
 *   phone       TEXT,
 *   lang        TEXT DEFAULT 'da',
 *   status      TEXT DEFAULT 'open',
 *   created_at  TIMESTAMPTZ DEFAULT now()
 * );
 *
 * CREATE TABLE messages (
 *   id          BIGSERIAL PRIMARY KEY,
 *   session_id  TEXT REFERENCES sessions(id),
 *   role        TEXT NOT NULL,  -- 'customer' eller 'agent'
 *   text        TEXT NOT NULL,
 *   created_at  TIMESTAMPTZ DEFAULT now()
 * );
 *
 * CREATE INDEX ON messages(session_id, id);
 * ─────────────────────────────────────────────
 *
 * Miljøvariabler (sæt i Vercel dashboard):
 *   SUPABASE_URL          – Fra Supabase → Project Settings → API
 *   SUPABASE_SERVICE_KEY  – Fra Supabase → Project Settings → API (service_role nøgle)
 *   WEBHOOK_SECRET        – Hemmeligt token delt med Power Automate
 *   AGENT_SECRET          – Hemmeligt token til agent-dashboard (sæt samme i agent-dashboard HTML)
 *   TEAMS_WEBHOOK_URL     – Power Automate webhook URL
 *   ALLOWED_ORIGINS       – Kommasepareret: https://autolock.dk,https://autolock.se,...
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
    console.error(`[boot] FEJL: Miljøvariabel '${key}' mangler. Sæt den i Vercel dashboard.`);
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

// ─── SSE: aktive lyttere pr. session ──────────────────────────────────────────
// Map<sessionId, Set<res>>
const sseClients = new Map();

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

// ─── Rate limiting (in-memory, nulstilles ved server-genstart) ────────────────
// På Vercel er dette per-instans – tilstrækkelig til at afbøde burst-angreb.
// For produktions-grade rate limiting: brug Upstash Redis eller Vercel Edge Middleware.

const rateLimitStore = new Map(); // ip → { count, resetAt }

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
    if (entry.count > maxRequests) {
      return res.status(429).json({ error: 'For mange forespørgsler – prøv igen om lidt' });
    }
    next();
  };
}

// ─── Auth-middleware til agent-endpoints ──────────────────────────────────────

function requireAgentAuth(req, res, next) {
  const token = req.headers['x-agent-secret'] || req.query.agent_secret;
  if (!token || token !== CONFIG.agentSecret) {
    return res.status(401).json({ error: 'Uautoriseret' });
  }
  next();
}

// ─── Hjælpefunktioner ─────────────────────────────────────────────────────────

function makeId()      { return crypto.randomBytes(16).toString('hex'); }
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

// ─── Reminder-timers (in-memory er OK – de er ikke kritiske) ─────────────────

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
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// CORS – kun kendte origins
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && CONFIG.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id, X-Webhook-Secret, X-Agent-Secret');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── POST /session/start ───────────────────────────────────────────────────────
app.post('/session/start',
  rateLimit(10, 60_000), // maks 10 nye sessioner/minut per IP
  async (req, res) => {
    const name  = sanitizeText(req.body.name  || 'Gæst', 100);
    const email = sanitizeText(req.body.email || '', 200) || null;
    const phone = sanitizeText(req.body.phone || '', 30)  || null;
    const lang  = sanitizeLang(req.body.lang);
    const id    = makeId();

    const { error } = await supabase.from('sessions').insert({ id, name, email, phone, lang, status: 'open' });
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

    res.json({ session: { id, name, email, phone, lang, status: 'open' } });
  }
);

// ── POST /message/send ────────────────────────────────────────────────────────
app.post('/message/send',
  rateLimit(30, 60_000), // maks 30 beskeder/minut per IP
  async (req, res) => {
    const sessionId = req.headers['x-session-id'];
    const text      = sanitizeText(req.body.message || '', 2000);

    if (!sessionId) return res.status(400).json({ error: 'X-Session-Id header mangler' });
    if (!text)      return res.status(400).json({ error: 'Besked må ikke være tom' });

    const { data: session, error: sessErr } = await supabase
      .from('sessions').select('*').eq('id', sessionId).single();
    if (sessErr || !session) return res.status(404).json({ error: 'Session ikke fundet' });
    if (session.status === 'closed') return res.status(410).json({ error: 'Chatten er lukket' });

    const { translated: textForAgent, detectedLang } = await detectAndTranslateToDanish(text);

    // Opdater sprog på sessionen hvis auto-detektion finder et ikke-dansk sprog
    if (detectedLang && detectedLang !== 'da' && detectedLang !== session.lang) {
      await supabase.from('sessions').update({ lang: detectedLang }).eq('id', sessionId);
      session.lang = detectedLang;
    }

    const { data: msg, error: msgErr } = await supabase
      .from('messages').insert({ session_id: sessionId, role: 'customer', text: textForAgent })
      .select().single();
    if (msgErr) { console.error('[message/send]', msgErr); return res.status(500).json({ error: 'Kunne ikke gemme besked' }); }

    scheduleReminder(session);
    await sendToTeams(sessionId, session.name, textForAgent);

    res.json({ message: msg });
  }
);

// ── GET /message/sse – Server-Sent Events (erstatter long-poll) ───────────────
// Widget lytter her efter agent-svar i realtid.
app.get('/message/sse', (req, res) => {
  const sessionId = req.headers['x-session-id'] || req.query.session_id;
  if (!sessionId) return res.status(400).json({ error: 'session_id mangler' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Heartbeat hvert 25s for at holde forbindelsen i live
  const hb = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch (_) {} }, 25_000);

  sseSubscribe(sessionId, res);
  req.on('close', () => { clearInterval(hb); sseUnsubscribe(sessionId, res); });
});

// ── POST /webhook/teams ───────────────────────────────────────────────────────
app.post('/webhook/teams', async (req, res) => {
  const secret = req.headers['x-webhook-secret'] || '';
  if (secret !== CONFIG.webhookSecret) return res.status(401).json({ error: 'Uautoriseret' });

  const raw    = sanitizeText(req.body.text || '', 2000);
  const parsed = parseAgentReply(raw);
  if (!parsed) return res.json({ ignored: true, reason: 'Ikke et !svar-kommando' });

  // Find session via short ID
  const { data: sessions } = await supabase
    .from('sessions').select('*').eq('status', 'open').ilike('id', `${parsed.shortId}%`).limit(1);
  const session = sessions?.[0];
  if (!session) return res.json({ ignored: true, reason: 'Session ikke fundet' });

  const textForCustomer = await translateToCustomerLang(parsed.message, session.lang || 'da');

  const { data: msg, error } = await supabase
    .from('messages').insert({ session_id: session.id, role: 'agent', text: textForCustomer })
    .select().single();
  if (error) { console.error('[webhook/teams]', error); return res.status(500).json({ error: 'Kunne ikke gemme besked' }); }

  clearReminder(session.id);
  sseBroadcast(session.id, 'message', msg); // push til widget via SSE
  res.json({ saved: true, message: msg });
});

// ── POST /session/close ───────────────────────────────────────────────────────
app.post('/session/close', async (req, res) => {
  const sessionId = req.headers['x-session-id'];
  if (!sessionId) return res.status(400).json({ error: 'X-Session-Id header mangler' });

  const { data: session } = await supabase.from('sessions').select('name').eq('id', sessionId).single();
  await supabase.from('sessions').update({ status: 'closed' }).eq('id', sessionId);
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

// ── Agent-endpoints (kræver X-Agent-Secret header) ───────────────────────────

// GET /sessions – liste over alle sessioner
app.get('/sessions', requireAgentAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('sessions').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: 'Kunne ikke hente sessioner' });
  res.json({ sessions: data });
});

// GET /messages/:sessionId – hent alle beskeder for en session
app.get('/messages/:sessionId', requireAgentAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('messages').select('*').eq('session_id', req.params.sessionId).order('id');
  if (error) return res.status(500).json({ error: 'Kunne ikke hente beskeder' });
  res.json({ messages: data });
});

// POST /agent/reply – agent sender svar direkte fra dashboard
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
  res.json({ message: msg });
});

// ── GET /health ───────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const port = CONFIG.port;
app.listen(port, () => {
  console.log(`✅ Livechat server kører på port ${port}`);
  console.log(`   Tilladte origins: ${CONFIG.allowedOrigins.join(', ')}`);
  console.log(`   Teams webhook sat: ${CONFIG.teamsWebhookUrl ? 'ja' : '⚠️  mangler TEAMS_WEBHOOK_URL'}`);
});

module.exports = app; // kræves af Vercel
