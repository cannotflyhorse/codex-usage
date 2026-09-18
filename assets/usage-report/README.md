# Codex 用量面板（usage-report）

实时统计每次对话消耗了多少 token、缓存命中了多少、折合多少钱，并把花费按 DeepSeek API Key（公司／个人）拆开。

用量数据全部来自本机 Codex 日志，不出本机。**唯一的外发请求是查余额**：向 `api.deepseek.com/user/balance` 发一个 GET，且只在配置了 key 档案时才会发。

有两种看法：**桌面置顶悬浮窗**（推荐，随时瞄一眼）和 **Codex 内嵌网页面板**（信息更全）。

## 悬浮窗（实时置顶）

```
双击 float-panel.cmd      # 右上角出现一个置顶小窗，2 秒刷新一次
```

窗口很小，显示几行信息：本次对话的花费与 token、缓存命中数与命中率、最近 12 次调用的迷你柱状图、**每把 key 的今日花费与余额**、今日/本月金额与当前峰谷时段。鼠标悬停在窗口上会弹出更详细的提示（项目名、调用次数、输入输出、缓存省下的钱、累计花费）。

标题旁的蓝色文字是当前生效的 key 档案名；带 `●` 的是当前档案，`○` 是另一把。

金额默认以**人民币**显示（按 `pricing.json` 里的 `usd_to_cny` 换算，默认 7.15）。想换回美元或改汇率：右键菜单切换货币，或直接改 `pricing.json` 里的 `usd_to_cny`。

操作方式：

| 操作 | 效果 |
|---|---|
| 按住窗口拖动 | 移动位置（位置会被记住） |
| 双击窗口 | 打开完整网页面板 |
| 点 `—` | 折叠/展开，折叠后只剩一行数字 |
| 点 `✕` | 退出悬浮窗 |
| 右键 | 菜单：切换货币、紧凑模式、窗口置顶开关、刷新间隔（1/5 秒）、打开完整面板、退出 |

悬浮窗自带自愈：发现面板服务没在跑就自动拉起；服务中途挂掉也会隔一阵重试。窗口由 Windows PowerShell 或 pwsh 直接运行 WPF，不装任何依赖，也不占用 Codex 的界面。

开机自启：`Win+R` 输入 `shell:startup`，把 `float-panel.cmd` 的快捷方式丢进去。

## 按 API Key 区分（公司与个人）

如果你用 deepseek-key-switch 技能登记了多把 DeepSeek key 并来回切换，面板会把花费按 key 拆开。

依据是两个文件，都由 deepseek-key-switch 维护，本面板**只读**：

| 文件 | 作用 |
|---|---|
| `%CODEX_HOME%\deepseek-keys.json` | 有哪几把 key（面板只用来显示掩码和查余额，不会打印完整 key） |
| `%CODEX_HOME%\deepseek-key-history.jsonl` | 每笔调用按发生时刻落到当时生效的那把 key 上 |

没有这两个文件时，按 key 的区域自动隐藏，面板退化成全局统计，不会报错。

三个口径要分清，别混着看：

| 数字 | 是什么 |
|---|---|
| 每把 key 的金额 | 本地日志 token × `pricing.json` 单价算出的**估算值** |
| 每把 key 的余额 | 查询那一刻的**实时值**（TTL 60 秒），不是「这把 key 花了多少」 |
| 未归属 | 时间轴没覆盖到的调用，不摊给任何一把 key |

DeepSeek 没有提供账单或用量查询接口，所以「公司这周花了多少」这种问题只能靠本地日志估算，对不上官方账单是正常的。

## 快速开始

```
双击 float-panel.cmd            # 桌面悬浮窗（自动拉起后台服务）
双击 start-panel.cmd            # 只启动后台网页服务（无窗口），地址 http://127.0.0.1:8787
双击 run-panel.cmd              # 前台启动网页服务，保留控制台便于看日志（Ctrl+C 停止）
双击 stop-panel.cmd             # 停止网页服务
node server.js                  # 同上，前台启动
node server.js --once           # 只在命令行打印一次汇总，不启服务
node server.js --once --json    # 输出原始 JSON，方便喂给别的脚本
pwsh -File float-panel.ps1 -Once  # 悬浮窗的数据自检，只打印一次摘要不开窗
node verify.js                  # 自检：用 DOM 桩跑一遍前端渲染逻辑
```

想开机自动常驻：按 `Win+R` 输入 `shell:startup`，把 `start-panel.cmd` 的快捷方式丢进去即可。

面板已作为标签页开在 Codex 右侧；服务器常驻后，页面通过 SSE 自动刷新（文件一变，约 0.7 秒内推送新数据），无需手动刷新。

## 统计口径

数据源是 `%USERPROFILE%\.codex\sessions\` 与 `archived_sessions\` 下的 `rollout-*.jsonl`，读取其中 `token_usage_record` 事件。已核对：每条记录对应**一次**真实 API 调用（`response_id` 唯一），逐条累加与 Codex 自己记录的会话累计值完全一致。

每次调用取这些字段：

| 字段 | 含义 |
|---|---|
| `input_tokens` | 本次输入总 token（已包含缓存命中的部分） |
| `cached_input_tokens` | 其中命中前缀缓存的 token |
| `output_tokens` | 输出 token（含 `reasoning_output_tokens` 思考 token） |
| `total_tokens` | 本次合计 |

于是：

- **缓存命中数** = `cached_input_tokens`
- **未命中输入** = `input_tokens − cached_input_tokens`
- **命中率** = 命中 ÷ 输入

费用 = 命中 token × 命中单价 + 未命中 token × 未命中单价 + 输出 token × 输出单价。每条调用按其**自身发生时刻**判断高峰/低谷，因此跨时段的长对话也能算准。

## 价格表

单价写在 [pricing.json](pricing.json)，单位是「美元 / 每 100 万 token」，数值取自 DeepSeek 官方 API 价格表（`api-docs.deepseek.com/quick_start/pricing`，2026-09-17 抓取）：

| 模型 | 缓存命中 | 缓存未命中 | 输出 |
|---|---|---|---|
| DeepSeek-V4.1-Flash（高峰） | $0.006 | $0.3 | $1.2 |
| DeepSeek-V4.1-Flash（低谷） | $0.003 | $0.15 | $0.6 |
| DeepSeek-V4-Pro（高峰） | $0.044 | $1.32 | $3.96 |
| DeepSeek-V4-Pro（低谷） | $0.022 | $0.66 | $1.98 |

高峰时段按官方定义：**UTC 周一至周五 01:00-04:00 与 06:00-10:00**，即北京时间 09:00-12:00 与 14:00-18:00；其余时间为低谷，单价减半。日志里的 legacy 名称 `deepseek-v4-flash` 官方说明按 Flash 价格计费，已在 `pricing.json` 的 `aliases` 里映射。

官网调价后，直接改 `pricing.json` 的数字即可，面板会自动重算（刷新页面或等下一次推送）。`usd_to_cny` 控制面板上 CNY 显示所用的汇率。

## 面板看什么

- 顶部卡片：本次对话 tokens 与花费、今日、本月、全部历史累计
- 当前对话：本次会话的输入/命中/未命中/输出构成条、命中率、最近几轮明细
- 实时调用流水：最近 40 次调用，逐条显示用量、命中率、金额，并标注高峰/低谷
- 每日图表：柱状是 token，折线是金额
- 历史对话：所有会话排行，点开看逐轮明细

## 文件结构

```
usage-report/
├─ float-panel.ps1         桌面置顶悬浮窗（WPF）
├─ float-panel.cmd         悬浮窗启动器
├─ float-panel.state.json  悬浮窗位置等状态（自动生成）
├─ server.js               HTTP + SSE 服务，静态资源与 API
├─ pricing.json            单价、峰谷时段、汇率
├─ lib/pricing.js          价格表加载、模型名归一、峰谷判定、单次计费
├─ lib/scanner.js          扫描会话日志（按 mtime 缓存，只重读变化的文件）
├─ lib/aggregate.js        按会话 / 轮次 / 天 / 模型聚合
└─ public/                 网页面板前端（原生 JS + SVG 图表，无第三方依赖）
```

## 已知限制

- 费用是**按标价估算**，不含赠送额度、折扣、汇率波动，最终以 DeepSeek 账单为准。
- 只统计 Codex 日志里记录的模型调用；未识别的模型名会回退到 `fallback_model` 的价格，面板上该会话的模型名会照原样显示，便于你自行核对。
- 面板只监听 `127.0.0.1`，不对外暴露。
