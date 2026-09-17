# 定价表配置

金额完全由 `assets/usage-report/pricing.json` 决定，日志里只有 token 数。用户在别的模型上跑 Codex 时，这里必须补上对应价格，否则会套用 `fallback_model` 的价格，金额会偏。

## 结构

```json
{
  "currency": "USD",
  "usd_to_cny": 7.15,
  "input_tokens_include_cached": true,
  "peak_windows_utc": [{ "start": "01:00", "end": "04:00" }, { "start": "06:00", "end": "10:00" }],
  "peak_weekdays_utc": [1, 2, 3, 4, 5],
  "fallback_model": "deepseek-flash",
  "models": {
    "模型标识": {
      "label": "显示名",
      "aliases": ["日志里可能出现的模型名"],
      "peak":     { "cache_hit": 0.006, "cache_miss": 0.3,  "output": 1.2 },
      "off_peak": { "cache_hit": 0.003, "cache_miss": 0.15, "output": 0.6 }
    }
  }
}
```

单价单位是**美元 / 每 100 万 token**，分三档：缓存命中的输入、缓存未命中的输入、输出。

## 关键字段

- `aliases`：日志 `turn_context` 事件里的模型名要能匹配到这里，否则会回退。带 `[1M]` 之类后缀的写法也放进 aliases。
- `input_tokens_include_cached`：Codex 记录的 `input_tokens` 是否已包含缓存命中部分。OpenAI 风格（含）填 `true`，Anthropic 风格（不含）填 `false`。填错会重复或漏算输入费。
- `peak_windows_utc` / `peak_weekdays_utc`：只有提供商按时段调价时才需要。不用峰谷定价的模型，把 `peak` 和 `off_peak` 填成同样的数字即可。
- `usd_to_cny`：人民币展示用的汇率，只影响显示，不影响计价逻辑。
- `fallback_model`：模型名匹配不上时套用谁的价。

## 给新模型补价格

1. 看用户的 `$CODEX_HOME/config.toml`，找到 `model`、`model_provider` 和 `[model_providers.*]` 的 `base_url`，确认实际提供商。
2. 去该提供商官方价格页取三档单价（缓存命中输入 / 未命中输入 / 输出），注意单位是「每百万 token」还是「每千 token」。
3. 在 `models` 下加一条，`aliases` 填上日志里会出现的模型名。
4. 改完直接重跑 `node assets/usage-report/server.js --once` 核对金额是否合理；面板会把模型名原样显示在会话列表里，便于比对是否匹配成功。

DeepSeek 官方价格（2026-09 抓取，供参考）：Flash 高峰 $0.006 / $0.3 / $1.2、低谷半价；Pro 高峰 $0.044 / $1.32 / $3.96、低谷半价。高峰时段为 UTC 周一至周五 01:00-04:00 与 06:00-10:00，即北京时间 09:00-12:00 与 14:00-18:00。
