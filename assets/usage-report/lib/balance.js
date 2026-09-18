'use strict';

// DeepSeek 余额查询。只有「当前余额」这一个口径，没有历史账单接口，
// 所以面板显示的是查询时刻的实时余额，不是某个时间段花了多少。
//
// 结果带 TTL 缓存：面板每 2 秒刷新一次，不能每次都打 API。

const BALANCE_URL = 'https://api.deepseek.com/user/balance';
const DEFAULT_TTL_MS = 60_000;

/** name -> { fetchedAt, keyId, data } */
const cache = new Map();

async function fetchBalance(key, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(BALANCE_URL, {
      headers: { authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, available: false, error: `HTTP ${res.status}`, fetchedAt: Date.now() };
    }
    const body = await res.json();
    const info = Array.isArray(body.balance_infos) ? body.balance_infos[0] : null;
    return {
      ok: true,
      available: Boolean(body.is_available),
      currency: info ? info.currency : '',
      total: info ? Number(info.total_balance) : null,
      granted: info ? Number(info.granted_balance) : null,
      toppedUp: info ? Number(info.topped_up_balance) : null,
      error: '',
      fetchedAt: Date.now(),
    };
  } catch (error) {
    return {
      ok: false,
      available: false,
      error: error && error.name === 'AbortError' ? '请求超时' : String((error && error.message) || error),
      fetchedAt: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 按 TTL 逐个刷新。key 变了立刻重查，失败保留上一次的结果。 */
async function refreshBalances(profiles, { ttlMs = DEFAULT_TTL_MS, force = false } = {}) {
  const now = Date.now();
  for (const profile of profiles) {
    const hit = cache.get(profile.name);
    if (!force && hit && hit.keyId === profile.keyId && now - hit.fetchedAt < ttlMs) continue;
    const data = await fetchBalance(profile.key);
    if (!data.ok && hit && hit.keyId === profile.keyId) {
      // 网络抖动不该把上次的余额抹掉，保留旧值并标注失败
      data.lastGood = hit.data;
    }
    cache.set(profile.name, { fetchedAt: data.fetchedAt, keyId: profile.keyId, data });
  }

  const live = new Set(profiles.map((p) => p.name));
  for (const name of [...cache.keys()]) {
    if (!live.has(name)) cache.delete(name);
  }
}

function balanceSnapshot(name, keyId) {
  const hit = cache.get(name);
  if (!hit || hit.keyId !== keyId) return null;
  const { lastGood, ...data } = hit.data;
  return { ...data, ageMs: Date.now() - hit.fetchedAt, lastGood: lastGood || undefined };
}

module.exports = { refreshBalances, balanceSnapshot, fetchBalance, BALANCE_URL };
