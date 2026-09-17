'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const SESSION_DIRS = [
  path.join(CODEX_HOME, 'sessions'),
  path.join(CODEX_HOME, 'archived_sessions'),
];

/** filePath -> { size, mtimeMs, session } —— 文件未变化时直接复用解析结果。 */
const parseCache = new Map();

async function listSessionFiles(dirs = SESSION_DIRS) {
  const out = [];
  for (const dir of dirs) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true, recursive: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      out.push(path.join(entry.parentPath || entry.path || dir, entry.name));
    }
  }
  return out;
}

function emptySession(file) {
  return {
    file,
    threadId: null,
    sessionId: null,
    cwd: null,
    modelProvider: null,
    originator: null,
    cliVersion: null,
    startedAt: null,
    turnModels: {},
    calls: [],
    malformedLines: 0,
  };
}

function handleLine(session, line) {
  if (line.length < 30) return;
  // 先做廉价的子串判断，避免为体积巨大的 response_item 行付 JSON.parse 的代价
  const isUsage = line.includes('"type":"token_usage_record"');
  const isTurn = line.includes('"type":"turn_context"');
  const isMeta = line.includes('"type":"session_meta"');
  if (!isUsage && !isTurn && !isMeta) return;

  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    session.malformedLines += 1;
    return;
  }
  const payload = obj.payload || {};

  if (obj.type === 'session_meta') {
    session.threadId = payload.id || payload.session_id || session.threadId;
    session.sessionId = payload.session_id || payload.id || session.sessionId;
    session.cwd = payload.cwd || session.cwd;
    session.modelProvider = payload.model_provider || session.modelProvider;
    session.originator = payload.originator || session.originator;
    session.cliVersion = payload.cli_version || session.cliVersion;
    session.startedAt = payload.timestamp || obj.timestamp || session.startedAt;
    return;
  }

  if (obj.type === 'turn_context') {
    if (payload.turn_id && payload.model) session.turnModels[payload.turn_id] = payload.model;
    return;
  }

  const usage = payload.usage;
  if (!usage) return;
  session.calls.push({
    at: obj.timestamp,
    atMs: Date.parse(obj.timestamp),
    threadId: payload.thread_id || session.threadId,
    turnId: payload.turn_id || null,
    rootTurnId: payload.root_turn_id || payload.turn_id || null,
    responseId: payload.response_id || null,
    durationMs: Number.isFinite(payload.duration_ms) ? payload.duration_ms : null,
    input: usage.input_tokens || 0,
    cached: usage.cached_input_tokens || 0,
    cacheWrite: usage.cache_write_input_tokens || 0,
    output: usage.output_tokens || 0,
    reasoning: usage.reasoning_output_tokens || 0,
    total: usage.total_tokens || 0,
    threadTotal: (payload.thread_token_usage || {}).total_tokens || null,
    turnTotal: (payload.turn_token_usage || {}).total_tokens || null,
  });
}

async function readSessionFile(file) {
  const session = emptySession(file);
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) handleLine(session, line);
  } finally {
    rl.close();
    stream.destroy();
  }
  session.calls.sort((a, b) => a.atMs - b.atMs);
  return session;
}

async function scanFile(file) {
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    parseCache.delete(file);
    return null;
  }
  const cached = parseCache.get(file);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.session;
  const session = await readSessionFile(file);
  parseCache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, session });
  return session;
}

async function scanSessions(dirs = SESSION_DIRS) {
  const files = await listSessionFiles(dirs);
  const sessions = await Promise.all(files.map((file) => scanFile(file).catch(() => null)));
  return sessions.filter((s) => s && s.calls.length > 0);
}

module.exports = { scanSessions, listSessionFiles, SESSION_DIRS, CODEX_HOME };
