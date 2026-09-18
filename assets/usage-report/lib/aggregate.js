'use strict';

const path = require('node:path');
const { resolveModel, costOfCall } = require('./pricing');
const { profileAt } = require('./profiles');

const EMPTY_TOTALS = () => ({
  calls: 0,
  input: 0,
  cached: 0,
  cacheWrite: 0,
  output: 0,
  reasoning: 0,
  total: 0,
  cost: 0,
  peakCost: 0,
  offPeakCost: 0,
  dollarSavedByCache: 0,
});

function addInto(acc, call) {
  acc.calls += 1;
  acc.input += call.input;
  acc.cached += call.cached;
  acc.cacheWrite += call.cacheWrite;
  acc.output += call.output;
  acc.reasoning += call.reasoning;
  acc.total += call.total;
  acc.cost += call.cost;
  if (call.tier === 'peak') acc.peakCost += call.cost;
  else acc.offPeakCost += call.cost;
  // 若这些缓存命中的 token 按未命中价计费，会多花多少
  acc.dollarSavedByCache += (call.cached / 1_000_000) * (call.rate.cache_miss - call.rate.cache_hit);
  return acc;
}

function finalize(acc) {
  return {
    ...acc,
    cacheHitRate: acc.input > 0 ? acc.cached / acc.input : 0,
    avgCostPerCall: acc.calls > 0 ? acc.cost / acc.calls : 0,
  };
}

function localDateKey(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 为一次调用附加模型解析结果与费用。 */
function priceCall(pricing, call, modelName) {
  const { key, matched } = resolveModel(pricing, modelName);
  const breakdown = costOfCall(pricing, key, new Date(call.atMs), {
    input: call.input,
    cached: call.cached,
    cacheWrite: call.cacheWrite,
    output: call.output,
    reasoning: call.reasoning,
  });
  return { ...call, modelKey: key, modelResolved: matched, modelName: modelName || key, ...breakdown };
}

function dominantModel(session) {
  const counts = new Map();
  for (const call of session.calls) {
    const model = session.turnModels[call.turnId];
    if (!model) continue;
    counts.set(model, (counts.get(model) || 0) + 1);
  }
  let best = null;
  let bestCount = -1;
  for (const [model, count] of counts) {
    if (count > bestCount) {
      best = model;
      bestCount = count;
    }
  }
  return best;
}

/**
 * history: deepseek-key-switch 的切换时间轴（已按时间升序）。
 * 每一笔调用按发生时刻归属到当时生效的 key；覆盖不到的记 profile = null。
 */
function summarizeSession(pricing, session, history = []) {
  const fallbackModel = dominantModel(session);
  const calls = session.calls.map((call) => priceCall(pricing, call, session.turnModels[call.turnId] || fallbackModel));
  for (const call of calls) call.profile = profileAt(history, call.atMs);
  const totals = finalize(calls.reduce(addInto, EMPTY_TOTALS()));

  const turnMap = new Map();
  for (const call of calls) {
    const key = call.turnId || call.responseId || call.at;
    let turn = turnMap.get(key);
    if (!turn) {
      turn = { turnId: key, rootTurnId: call.rootTurnId, startedAt: call.at, atMs: call.atMs, calls: 0, input: 0, cached: 0, output: 0, reasoning: 0, total: 0, cost: 0, tier: call.tier, profile: call.profile };
      turnMap.set(key, turn);
    } else if (turn.profile !== call.profile) {
      // 一轮里跨了 key 就标成混合，不硬选一个
      turn.profile = null;
    }
    turn.calls += 1;
    turn.input += call.input;
    turn.cached += call.cached;
    turn.output += call.output;
    turn.reasoning += call.reasoning;
    turn.total += call.total;
    turn.cost += call.cost;
    turn.lastAt = call.at;
    turn.atMs = call.atMs;
  }

  const models = new Map();
  for (const call of calls) {
    const entry = models.get(call.modelKey) || { key: call.modelKey, label: call.modelLabel, calls: 0, total: 0, cost: 0 };
    entry.calls += 1;
    entry.total += call.total;
    entry.cost += call.cost;
    models.set(call.modelKey, entry);
  }

  const splitMap = new Map();
  for (const call of calls) {
    const bucketKey = call.profile || '';
    const entry = splitMap.get(bucketKey) || { name: call.profile, ...EMPTY_TOTALS() };
    addInto(entry, call);
    splitMap.set(bucketKey, entry);
  }
  const profileSplit = [...splitMap.values()].map(finalize).sort((a, b) => b.cost - a.cost);

  const lastCall = calls[calls.length - 1];
  const cwd = session.cwd || null;
  return {
    id: session.threadId || path.basename(session.file, '.jsonl'),
    file: session.file,
    cwd,
    project: cwd ? path.basename(cwd) : '(未知目录)',
    modelProvider: session.modelProvider,
    originator: session.originator,
    startedAt: session.startedAt || (calls[0] && calls[0].at) || null,
    firstCallAt: calls[0] ? calls[0].at : null,
    lastActivityAt: lastCall ? lastCall.at : null,
    lastActivityMs: lastCall ? lastCall.atMs : 0,
    models: [...models.values()].sort((a, b) => b.cost - a.cost),
    modelLabel: lastCall ? lastCall.modelLabel : null,
    totals,
    profileSplit,
    turns: [...turnMap.values()].sort((a, b) => a.atMs - b.atMs),
    calls,
  };
}

function bucketBy(sessions, keyOf) {
  const buckets = new Map();
  for (const session of sessions) {
    for (const call of session.calls) {
      const key = keyOf(call);
      if (key == null) continue;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { key, ...EMPTY_TOTALS() };
        buckets.set(key, bucket);
      }
      addInto(bucket, call);
    }
  }
  return buckets;
}

/** 按 key 档案把一组调用分组汇总。profile 为 null 的归入 name: null（未归属）。 */
function groupByProfile(calls) {
  const buckets = new Map();
  for (const call of calls) {
    const bucketKey = call.profile || '';
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = { name: call.profile, ...EMPTY_TOTALS() };
      buckets.set(bucketKey, bucket);
    }
    addInto(bucket, call);
  }
  const out = new Map();
  for (const [key, bucket] of buckets) out.set(key, finalize(bucket));
  return out;
}

function buildSnapshot({ sessions, pricing, now = new Date(), recentCallLimit = 40, history = [] }) {
  const enriched = sessions.map((s) => summarizeSession(pricing, s, history));
  enriched.sort((a, b) => b.lastActivityMs - a.lastActivityMs);

  const allCalls = enriched.flatMap((s) => s.calls).sort((a, b) => a.atMs - b.atMs);
  const todayKey = localDateKey(now);
  const monthPrefix = todayKey.slice(0, 7);

  const totalsAll = finalize(allCalls.reduce(addInto, EMPTY_TOTALS()));
  const todayCalls = allCalls.filter((c) => localDateKey(new Date(c.atMs)) === todayKey);
  const totalsToday = finalize(todayCalls.reduce(addInto, EMPTY_TOTALS()));
  const monthCalls = allCalls.filter((c) => localDateKey(new Date(c.atMs)).startsWith(monthPrefix));
  const totalsMonth = finalize(monthCalls.reduce(addInto, EMPTY_TOTALS()));

  const byDay = [...bucketBy(enriched, (c) => localDateKey(new Date(c.atMs))).entries()]
    .map(([key, bucket]) => ({ date: key, ...finalize(bucket) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const byModelMap = new Map();
  for (const call of allCalls) {
    const entry = byModelMap.get(call.modelKey) || { key: call.modelKey, label: call.modelLabel, ...EMPTY_TOTALS() };
    addInto(entry, call);
    byModelMap.set(call.modelKey, entry);
  }
  const byModel = [...byModelMap.values()].map(finalize).sort((a, b) => b.cost - a.cost);

  const profileAll = groupByProfile(allCalls);
  const profileToday = groupByProfile(todayCalls);
  const profileMonth = groupByProfile(monthCalls);
  const byProfile = [...profileAll.values()]
    .map((row) => ({
      ...row,
      today: profileToday.get(row.name || '') || null,
      month: profileMonth.get(row.name || '') || null,
    }))
    .sort((a, b) => b.cost - a.cost);

  const activeSession = enriched[0] || null;
  const recentCalls = allCalls.slice(-recentCallLimit).reverse().map((call) => {
    const owner = enriched.find((s) => s.calls.includes(call));
    return {
      at: call.at,
      atMs: call.atMs,
      sessionId: owner ? owner.id : null,
      project: owner ? owner.project : null,
      turnId: call.turnId,
      profile: call.profile,
      modelLabel: call.modelLabel,
      tier: call.tier,
      input: call.input,
      cached: call.cached,
      output: call.output,
      reasoning: call.reasoning,
      total: call.total,
      cost: call.cost,
      cacheHitRate: call.input > 0 ? call.cached / call.input : 0,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    currency: { code: pricing.raw.currency || 'USD', usdToCny: pricing.raw.usd_to_cny || null },
    totals: { all: totalsAll, today: totalsToday, month: totalsMonth },
    byDay,
    byModel,
    byProfile,
    recentCalls,
    activeSessionId: activeSession ? activeSession.id : null,
    sessions: enriched.map((s) => ({
      id: s.id,
      project: s.project,
      cwd: s.cwd,
      modelLabel: s.modelLabel,
      models: s.models,
      startedAt: s.startedAt,
      lastActivityAt: s.lastActivityAt,
      lastActivityMs: s.lastActivityMs,
      totals: s.totals,
      profileSplit: s.profileSplit,
      turns: s.turns,
      callCount: s.calls.length,
    })),
    pricing: {
      peakWindows: pricing.raw.peak_windows_utc,
      weekdays: pricing.raw.peak_weekdays_utc,
      models: Object.fromEntries(
        Object.entries(pricing.raw.models).map(([key, def]) => [key, { label: def.label, peak: def.peak, off_peak: def.off_peak }]),
      ),
    },
  };
}

module.exports = { buildSnapshot, summarizeSession, EMPTY_TOTALS, addInto, finalize, localDateKey };
