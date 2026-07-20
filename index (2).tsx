// Multichat leaderboard + auth relay.
// Deployed on Render. Sits between the private Discord bot and the public
// website: the bot pushes data here (Bearer PUSH_SECRET), the website reads
// it here (no auth needed for public leaderboard reads).
//
// Env vars (set these in the Render dashboard, never commit them):
//   PUSH_SECRET   - must match LEADERBOARD_PUSH_SECRET in the bot's env
//   DATA_FILE     - optional, defaults to ./data.json (persists across
//                   restarts as long as Render's disk isn't wiped; on the
//                   free tier the disk IS ephemeral, so treat this as a
//                   cache the bot will happily refill within a few seconds
//                   of restart, not as a permanent database)
//   PORT          - provided automatically by Render

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const PUSH_SECRET = process.env.PUSH_SECRET || '';
const DATA_FILE = process.env.DATA_FILE || './data.json';

const app = express();
app.use(cors());
app.use(express.json({limit: '2mb'}));

// ---------------------------------------------------------------------
// In-memory store, mirrored to disk so a restart doesn't start completely
// empty (best effort — the bot repushes everything every few seconds
// anyway, so this is just to avoid a blank leaderboard for a moment).
// ---------------------------------------------------------------------
let store = {
  leaderboards: {}, // kind -> { entries: [...], updatedAt }
  authKeys: {},      // key_hash -> { user_id, name, avatar_url }
};

function loadFromDisk() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    store = {leaderboards: parsed.leaderboards || {}, authKeys: parsed.authKeys || {}};
  } catch (e) {
    // no file yet, or corrupt — start fresh
  }
}

let saveTimer = null;
function saveToDiskSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(DATA_FILE, JSON.stringify(store), () => {});
  }, 500);
}

loadFromDisk();

// Active website login sessions: token -> {user_id, name, avatar_url, createdAt}
const sessions = new Map();
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function requirePushSecret(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!PUSH_SECRET || token !== PUSH_SECRET) {
    return res.status(401).json({success: false, error: 'Unauthorized'});
  }
  next();
}

// ---------------------------------------------------------------------
// Bot -> relay: leaderboard pushes
// ---------------------------------------------------------------------
app.post('/push/:kind', requirePushSecret, (req, res) => {
  const kind = String(req.params.kind || '').toLowerCase();
  const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
  store.leaderboards[kind] = {entries, updatedAt: Date.now()};
  saveToDiskSoon();
  res.json({success: true, count: entries.length});
});

// ---------------------------------------------------------------------
// Bot -> relay: API-key push, so the website can authenticate people using
// their existing bot API key. Only a hash of the key is ever sent/stored.
// ---------------------------------------------------------------------
app.post('/push/auth', requirePushSecret, (req, res) => {
  const records = Array.isArray(req.body.records) ? req.body.records : [];
  const nextAuthKeys = {};
  for (const r of records) {
    if (!r || !r.key_hash) continue;
    nextAuthKeys[r.key_hash] = {
      user_id: r.user_id || null,
      name: r.name || 'Unknown',
      avatar_url: r.avatar_url || null,
    };
  }
  store.authKeys = nextAuthKeys;
  saveToDiskSoon();
  res.json({success: true, count: records.length});
});

// ---------------------------------------------------------------------
// Website -> relay: public leaderboard reads
// ---------------------------------------------------------------------
app.get('/leaderboard/:kind', (req, res) => {
  const kind = String(req.params.kind || '').toLowerCase();
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
  const board = store.leaderboards[kind];
  if (!board) {
    return res.json({success: true, entries: [], updatedAt: null});
  }
  res.json({success: true, entries: board.entries.slice(0, limit), updatedAt: board.updatedAt});
});

// ---------------------------------------------------------------------
// Website -> relay: sign in with an existing bot API key
// ---------------------------------------------------------------------
function hashKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

app.post('/auth/login', (req, res) => {
  const apiKey = (req.body && req.body.api_key ? String(req.body.api_key) : '').trim();
  if (!apiKey) {
    return res.status(400).json({success: false, error: 'Missing api_key'});
  }
  const hash = hashKey(apiKey);
  const record = store.authKeys[hash];
  if (!record) {
    return res.status(401).json({success: false, error: 'Invalid or unknown API key'});
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {...record, createdAt: Date.now()});
  res.json({success: true, token, user: record});
});

app.get('/auth/me', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const session = sessions.get(token);
  if (!session || Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return res.status(401).json({success: false, error: 'Not signed in'});
  }
  res.json({success: true, user: session});
});

app.post('/auth/logout', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  sessions.delete(token);
  res.json({success: true});
});

// Periodically drop expired sessions so the Map doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(token);
  }
}, 60 * 60 * 1000);

app.get('/', (req, res) => {
  res.json({success: true, service: 'multichat-leaderboard-relay'});
});

app.listen(PORT, () => {
  console.log(`Leaderboard relay listening on :${PORT}`);
});
