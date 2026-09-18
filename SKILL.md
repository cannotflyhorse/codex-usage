---
name: codex-usage
description: 统计和监控 Codex 对话的 token 用量、缓存命中数与花费，并按 DeepSeek API Key（公司／个人）拆分，附带各 key 的实时余额。数据来自本机 Codex 会话日志。当用户问“这次对话用了多少 token”“花了多少钱”“缓存命中多少”“公司/个人 key 各花了多少”“余额还剩多少”，或想要一个实时用量面板、桌面悬浮窗、用量提醒时使用。
---

# Codex 用量

统计本机 Codex 对话消耗的 token、缓存命中量和折算金额，并可按需安装常驻的监控面板。

数据源是 Codex 自己的会话日志（`$CODEX_HOME/sessions` 与 `archived_sessions` 下的 `rollout-*.jsonl`）里的 `token_usage_record` 事件，每次 API 调用一条记录。**日志只记录 token，不记录金额**：钱是按 `pricing.json` 里的单价算出来的，所以价格表是否匹配用户实际用的模型，直接决定金额对不对——报数字前先确认这一点。

下文所有路径都相对于本技能目录。

## 快速查询

只读操作，不改动任何东西：

```bash
node assets/usage-report/server.js --once         # 人类可读的汇总文本
node assets/usage-report/server.js --once --json  # 结构化数据，自行解析后回答用户
```

`--json` 的常用字段：

| 字段 | 含义 |
|---|---|
| `totals.all` / `totals.today` / `totals.month` | `calls` 调用次数、`input` 输入、`cached` 缓存命中、`output` 输出、`total` 合计、`cost` 金额、`cacheHitRate` 命中率、`dollarSavedByCache` 靠缓存省下的钱 |
| `activeSessionId` | 最近活动的对话 |
| `sessions[]` | 每个对话的 `project`、`modelLabel`、`startedAt`、`totals`、`turns[]` 逐轮明细 |
| `recentCalls[]` | 最近 40 次调用，含 `cached`（本次命中数）、`tier`（`peak` 高峰价 / `off_peak` 低谷价） |
| `recentCalls[].profile` | 该次调用归属的 key 档案名；`null` 表示未归属 |
| `byProfile[]` | 按 key 档案拆分的汇总，`name` 为 `null` 的那项是「未归属」；每项含 `today` / `month` |
| `profiles{}` | key 档案、当前生效档案、各 key 余额；`available: false` 表示这台机器还没登记过档案 |
| `currency` | `code` 与 `usdToCny`，用于把美元金额换算成人民币 |

用户说“这次对话”时，取 `activeSessionId` 对应的那个会话，不要用全局累计值回答。

## 按 API Key 区分

会话日志只记 token，**不记这次调用用的是哪把 key**，所以归属只能靠外部时间轴推导：

| 数据 | 来源 | 谁写 |
| --- | --- | --- |
| 有哪几把 key | `%CODEX_HOME%\deepseek-keys.json` | deepseek-key-switch 技能的档案库 |
| 什么时候切的档 | `%CODEX_HOME%\deepseek-key-history.jsonl` | deepseek-key-switch 每次真正切换追加一条 |
| 当前余额 | DeepSeek `GET /user/balance` | 本面板实时查询 |

每笔调用按发生时刻落到当时生效的档案上。悬浮窗和网页面板都会显示每把 key 的今日花费与余额，调用流水表也带 Key 列。

**边界必须说清楚，别把估算当成账单：**

- 时间轴覆盖不到的调用归入「未归属」，不会摊给某一把 key。历史文件被删、或启用本功能之前的旧用量都会落到这里。
- 需要回填时间轴起点时，用 deepseek-key-switch 的 `seed <档案名> [-At <ISO 时间>]`，不要在面板侧硬编码归属。
- **余额是「查询那一刻的实时值」，不是「这把 key 这段时间花了多少」**。DeepSeek 没有账单或用量接口，算不出权威的分 key 花费；面板里的花费始终是本地日志 × `pricing.json` 单价的估算值。回答时不要把两者混为一谈。
- 余额带 60 秒 TTL 缓存，查询失败时保留上一次的数值并标注失败，不会把旧数据抹成 0。

## 安装常驻面板

Windows：

```powershell
pwsh -File scripts/install.ps1              # 默认装到 %USERPROFILE%\.codex\usage-report
pwsh -File scripts/install.ps1 -Autostart   # 额外设置开机自启悬浮窗
pwsh -File scripts/install.ps1 -Uninstall   # 卸载（先备份用户改过的 pricing.json）
```

装好后用户在目标目录双击这些文件：

| 文件 | 作用 |
|---|---|
| `float-panel.cmd` | 置顶悬浮窗，每 2 秒刷新（Windows 专有，WPF 实现） |
| `start-panel.cmd` | 后台启动网页服务，地址 http://127.0.0.1:8787 |
| `run-panel.cmd` | 前台运行网页服务，便于看日志 |
| `stop-panel.cmd` | 停止网页服务 |

悬浮窗标题旁会显示当前生效的 key 档案名，正文多出一块按 key 分行的区域（每把 key 的今日花费 + 余额）；网页面板对应「按 API Key 区分」一节，调用流水也带 Key 列。**没有登记 key 档案时这些区域自动隐藏**，面板退化成原来的样子，不会报错。网页面板是靠读 `deepseek-keys.json` 才能拆分的，所以 deepseek-key-switch 是它的软依赖，不是硬依赖。

macOS / Linux：把 `assets/usage-report/` 复制到任意目录，运行 `node server.js`，浏览器打开 http://127.0.0.1:8787。悬浮窗依赖 WPF，只有 Windows 能用，其他平台用网页面板。

**悬浮窗和网页服务必须由用户自己的账户启动。** 如果 agent 在受限沙箱或服务账户里运行，窗口会创建在那个账户的桌面上，用户看不到，表现为“命令执行成功但没有窗口”。安装脚本本身可以直接跑，只是最后一步启动要交给用户。

## 定价

默认内置 DeepSeek 官方价格（Flash / Pro，区分高峰与低谷时段）。用户换用其他模型时必须先补价格，否则会回退到默认模型的价格而算错金额。价格表结构、峰谷规则和补价步骤见 [references/pricing.md](references/pricing.md)。
