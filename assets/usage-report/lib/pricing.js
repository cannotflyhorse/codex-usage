'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PRICING_PATH = path.join(__dirname, '..', 'pricing.json');

function loadPricing(file = PRICING_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const aliasToModel = new Map();
  for (const [key, def] of Object.entries(raw.models || {})) {
    aliasToModel.set(key.toLowerCase(), key);
    for (const alias of def.aliases || []) aliasToModel.set(String(alias).toLowerCase(), key);
  }
  return { raw, aliasToModel, fallback: raw.fallback_model };
}

/** 把日志里出现的模型名归一到价格表 key。 */
function resolveModel(pricing, modelName) {
  if (!modelName) return { key: pricing.fallback, matched: false };
  const direct = pricing.aliasToModel.get(String(modelName).toLowerCase());
  if (direct) return { key: direct, matched: true };

  // 处理 "deepseek-v4-pro[1M]" / "xxx:free" 这类装饰后缀
  const stripped = String(modelName).toLowerCase().replace(/[\[(].*?[\])]/g, '').split(':')[0].trim();
  if (stripped.length < 3) return { key: pricing.fallback, matched: false };
  const loose = pricing.aliasToModel.get(stripped);
  if (loose) return { key: loose, matched: true };

  for (const [alias, key] of pricing.aliasToModel) {
    if (stripped.includes(alias) || alias.includes(stripped)) return { key, matched: true };
  }
  return { key: pricing.fallback, matched: false };
}

function minutesOfDay(date) {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function parseHhMm(value) {
  const [h, m] = String(value).split(':').map(Number);
  return h * 60 + (m || 0);
}

/** DeepSeek 的峰谷判定基于 UTC 星期与时间窗。 */
function isPeak(date, pricing) {
  const weekdays = pricing.raw.peak_weekdays_utc || [1, 2, 3, 4, 5];
  if (!weekdays.includes(date.getUTCDay())) return false;
  const min = minutesOfDay(date);
  return (pricing.raw.peak_windows_utc || []).some((w) => {
    const start = parseHhMm(w.start);
    const end = parseHhMm(w.end);
    return start <= end ? min >= start && min < end : min >= start || min < end;
  });
}

/** 取某模型在指定时刻的单价档位（每 1M token 的美元价）。 */
function rateFor(pricing, modelKey, date) {
  const def = pricing.raw.models[modelKey] || pricing.raw.models[pricing.fallback];
  const tier = isPeak(date, pricing) ? 'peak' : 'off_peak';
  return { tier, rate: def[tier], label: def.label || modelKey };
}

/**
 * 计算一次 API 调用的费用。
 * usage: { input, cached, cacheWrite, output, reasoning }
 */
function costOfCall(pricing, modelKey, date, usage) {
  const { tier, rate, label } = rateFor(pricing, modelKey, date);
  const cached = Math.max(0, Math.min(usage.cached || 0, usage.input || 0));
  const miss = pricing.raw.input_tokens_include_cached === false
    ? Math.max(0, usage.input || 0)
    : Math.max(0, (usage.input || 0) - cached);
  const output = Math.max(0, usage.output || 0);
  const million = 1_000_000;
  const cost = (cached / million) * rate.cache_hit
    + (miss / million) * rate.cache_miss
    + (output / million) * rate.output;
  return {
    cost,
    tier,
    rate,
    modelLabel: label,
    miss,
    cached,
    output,
    breakdown: {
      cacheHit: (cached / million) * rate.cache_hit,
      cacheMiss: (miss / million) * rate.cache_miss,
      output: (output / million) * rate.output,
    },
  };
}

module.exports = { loadPricing, resolveModel, isPeak, rateFor, costOfCall, PRICING_PATH };
