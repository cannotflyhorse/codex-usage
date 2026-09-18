'use strict';

// 把「这次 API 调用用的是哪把 DeepSeek key」还原出来。
//
// 会话日志（rollout-*.jsonl）只记 token，不记 provider/key，所以归属只能靠
// 外部时间轴推导：deepseek-key-switch 技能每次真正切换时往
// ~/.codex/deepseek-key-history.jsonl 追加一条记录，这里按调用时间落桶。
//
// 时间轴覆盖不到的调用（历史文件被删、或技能启用之前的旧用量）归入「未归属」，
// 不会硬塞给某一把 key。

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const STORE_FILE = 'deepseek-keys.json';
const HISTORY_FILE = 'deepseek-key-history.jsonl';

/** Key 指纹：sha256 前 10 位十六进制，与 deepseek_key.ps1 的 Get-KeyId 一致。 */
function keyIdOf(key) {
  if (typeof key !== 'string' || !key) return '';
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 10);
}

function maskOf(key) {
  if (typeof key !== 'string' || !key) return '(空)';
  if (key.length <= 12) return '***';
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 读取 deepseek-key-switch 的档案库。没登记过档案时返回 available: false。 */
function loadKeyStore(codexHome) {
  const storePath = path.join(codexHome, STORE_FILE);
  const store = readJsonFile(storePath);
  if (!store || typeof store !== 'object' || !store.profiles) {
    return { available: false, active: null, storePath, profiles: [] };
  }
  const profiles = Object.entries(store.profiles)
    .filter(([, def]) => def && typeof def.key === 'string' && def.key)
    .map(([name, def]) => ({
      name,
      label: def.label || '',
      key: def.key,
      keyId: keyIdOf(def.key),
      mask: maskOf(def.key),
      updatedAt: def.updated_at || null,
    }));
  return { available: profiles.length > 0, active: store.active || null, storePath, profiles };
}

/** 读取切换时间轴，按时间升序。坏行直接跳过，不影响面板。 */
function loadHistory(codexHome) {
  const historyPath = path.join(codexHome, HISTORY_FILE);
  let raw;
  try {
    raw = fs.readFileSync(historyPath, 'utf8');
  } catch {
    return { available: false, historyPath, entries: [] };
  }
  const entries = [];
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    try {
      const obj = JSON.parse(text);
      const atMs = Number.isFinite(obj.atMs) ? Number(obj.atMs) : Date.parse(obj.at);
      if (!Number.isFinite(atMs)) continue;
      entries.push({
        at: obj.at || new Date(atMs).toISOString(),
        atMs,
        from: obj.from || null,
        to: obj.to || null,
        keyId: obj.key_id || null,
        note: obj.note || null,
      });
    } catch {
      /* 忽略坏行 */
    }
  }
  entries.sort((a, b) => a.atMs - b.atMs);
  return { available: entries.length > 0, historyPath, entries };
}

/**
 * 某个时刻生效的档案名。
 * 时间轴没有覆盖到（早于第一条记录）时返回 null —— 调用方应归入「未归属」。
 */
function profileAt(entries, atMs) {
  let current = null;
  for (const entry of entries) {
    if (entry.atMs <= atMs) current = entry.to;
    else break;
  }
  return current;
}

/** 从聚合结果里挑出面板需要的字段，避免把整行内部结构透出去。 */
function shapeTotals(row) {
  if (!row) return null;
  return {
    calls: row.calls,
    input: row.input,
    cached: row.cached,
    output: row.output,
    total: row.total,
    cost: row.cost,
    cacheHitRate: row.cacheHitRate,
    peakCost: row.peakCost,
    offPeakCost: row.offPeakCost,
    dollarSavedByCache: row.dollarSavedByCache,
    avgCostPerCall: row.avgCostPerCall,
  };
}

/** 把 key 档案、切换时间轴、余额合并成快照里的 profiles 段。 */
function buildProfilesSection(snapshot, keyStore, history, nowMs = Date.now()) {
  const current = history.available ? profileAt(history.entries, nowMs) : null;
  const find = (name) => snapshot.byProfile.find((row) => row.name === name) || null;
  const unattributedRow = snapshot.byProfile.find((row) => !row.name) || null;

  const items = keyStore.profiles.map((profile) => {
    const row = find(profile.name);
    return {
      name: profile.name,
      label: profile.label,
      mask: profile.mask,
      keyId: profile.keyId,
      active: profile.name === current,
      totals: shapeTotals(row),
      today: row ? shapeTotals(row.today) : null,
      month: row ? shapeTotals(row.month) : null,
      balance: balanceFor(profile),
    };
  });

  return {
    available: keyStore.available,
    storePath: keyStore.storePath,
    historyPath: history.historyPath,
    historyAvailable: history.available,
    historySince: history.available ? history.entries[0].at : null,
    current,
    items,
    unattributed: unattributedRow ? shapeTotals(unattributedRow) : null,
  };
}

// 余额查询放在 server 层注入，避免 lib 之间互相依赖
let balanceProvider = () => null;
function setBalanceProvider(fn) { balanceProvider = fn; }
function balanceFor(profile) { return balanceProvider(profile.name, profile.keyId); }

module.exports = {
  loadKeyStore,
  loadHistory,
  profileAt,
  keyIdOf,
  maskOf,
  shapeTotals,
  buildProfilesSection,
  setBalanceProvider,
  STORE_FILE,
  HISTORY_FILE,
};
