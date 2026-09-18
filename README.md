# codex-usage

统计和监控 Codex 对话的 token 用量、缓存命中数与花费，并可按 DeepSeek API Key（公司／个人）拆分，附带各 key 的实时余额。用量数据全部来自本机 Codex 会话日志。

A Codex skill that reports token usage, prompt-cache hits, and estimated cost per conversation — read straight from your local Codex session logs, optionally split by API key, with live account balances.

## 它解决什么问题

Codex 每次调用模型都会在本地日志里记下 token 用量，但不会告诉你「这次对话花了多少钱」。这个技能把它算出来，并提供两种查看方式：

- **命令行查询**：一条命令得到累计用量、缓存命中率和折算金额
- **常驻监控**：Windows 置顶悬浮窗（每 2 秒刷新）或本地网页面板（趋势图 + 逐轮明细）

## 安装

### 作为 Codex 技能

把这个目录复制到你的 Codex 技能目录，然后新开一个对话：

```bash
git clone https://github.com/cannotflyhorse/codex-usage.git
# Windows（复制到技能目录）
xcopy /E /I codex-usage "%USERPROFILE%\.codex\skills\codex-usage"
# macOS / Linux
cp -r codex-usage ~/.codex/skills/
```

之后直接问 Codex「我这次对话用了多少 token / 花了多少钱 / 缓存命中多少」，它会自动使用这个技能。

### 只要工具面板

只要有 Node.js（无需任何第三方依赖）：

```bash
node assets/usage-report/server.js --once         # 打印一次汇总
node assets/usage-report/server.js               # 启动网页面板 http://127.0.0.1:8787
```

Windows 用户可以直接运行安装脚本，把工具装到 `%USERPROFILE%\.codex\usage-report`：

```powershell
pwsh -File scripts/install.ps1              # 安装
pwsh -File scripts/install.ps1 -Autostart   # 顺带设置开机自启悬浮窗
pwsh -File scripts/install.ps1 -Uninstall   # 卸载（会先备份改过的价格表）
```

## 它读什么数据

`$CODEX_HOME/sessions`（以及 `archived_sessions`）下的 `rollout-*.jsonl`。其中每个 `token_usage_record` 事件对应一次真实 API 调用，字段包括输入、缓存命中输入、输出、推理输出等。逐条累加的结果与 Codex 自己记录的会话累计值一致。

**日志里只有 token，没有钱。** 金额是按 `assets/usage-report/pricing.json` 的单价算出来的：

- 单位：美元 / 每 100 万 token，分「缓存命中输入 / 缓存未命中输入 / 输出」三档
- 默认内置 DeepSeek 官方定价（Flash / Pro，区分高峰与低谷时段）
- 换用其他模型时，按 `references/pricing.md` 补一条价格即可，否则会按回退价计算

价格表里的 `input_tokens_include_cached` 决定 `input_tokens` 是否已包含缓存命中部分（OpenAI 风格包含，Anthropic 风格不包含），填错会让金额偏。

## 按 API Key 拆分（公司与个人）

会话日志里只有 token，**没有「这次调用用的是哪把 key」**，所以归属靠外部时间轴推导。本仓库只读这两个文件，不写：

| 文件 | 作用 |
|---|---|
| `$CODEX_HOME/deepseek-keys.json` | 有哪几把 key（只用来显示掩码和查余额） |
| `$CODEX_HOME/deepseek-key-history.jsonl` | 每次切换追加一条，把每笔调用落到当时生效的那把 key |

这两个文件由配套技能 `deepseek-key-switch` 维护。没有它们时，按 key 的区域会自动隐藏，面板退化成全局统计，不会报错。

三种数字口径不同，别混着看：

| 数字 | 是什么 |
|---|---|
| 每把 key 的金额 | 本地日志 token × 单价算出的**估算值** |
| 每把 key 的余额 | **查询那一刻的实时值**（缓存 60 秒），不是「这把 key 花了多少」 |
| 未归属 | 时间轴没覆盖到的调用，不摊给任何一把 key |

DeepSeek 没有账单或用量查询接口，所以「某把 key 这段时间花了多少」只能靠本地日志估算，对不上官方账单是正常的。

## 隐私

- 用量数据全部来自本机日志，不出本机。
- **唯一的外发请求是查余额**：向 `api.deepseek.com/user/balance` 发一个 GET，且只在配置了 key 档案时才会发；不配 key 就完全不联网。
- 本技能不保存、不打印 API Key，读档案时只取掩码（`sk-abcd...1234`）和 10 位指纹用于显示。
- 面板服务只监听 `127.0.0.1`，不对局域网开放。

## 平台上能用到什么

| 功能 | Windows | macOS / Linux |
|---|---|---|
| 命令行查询 | ✅ | ✅ |
| 网页面板 + SSE 实时刷新 | ✅ | ✅ |
| 置顶悬浮窗 | ✅（WPF，无依赖） | ❌ |

悬浮窗必须由**你自己的账户**启动才会显示在你的桌面上。如果是在受限沙箱或服务账户里启动，窗口会创建在那个账户的桌面上，表现为「命令成功但没有窗口」。

## 目录结构

```
codex-usage/
├─ SKILL.md                   技能说明（查询与安装两条工作流）
├─ references/pricing.md      价格表结构、峰谷规则、补价步骤
├─ scripts/install.ps1        安装 / 自启 / 卸载
└─ assets/usage-report/       工具本体
   ├─ server.js               HTTP + SSE 服务
   ├─ lib/                    日志扫描、聚合、计费、key 归属、余额查询
   ├─ public/                 网页面板（原生 JS + SVG，无依赖）
   ├─ float-panel.ps1         置顶悬浮窗（WPF）
   └─ *.cmd                   双击即用的启动器
```

## 已知限制

- 金额是按标价估算，不含赠送额度、折扣、汇率波动，最终以提供商账单为准。
- 人民币展示依赖 `pricing.json` 里的 `usd_to_cny` 汇率，只影响显示，不影响计价。
- 悬浮窗只支持 Windows。
- 按 key 的花费同样是估算值，且只在启用切换时间轴之后才准确；更早的用量归到时间轴起点对应的 key，或显示为「未归属」。历史起点可用 `deepseek-key-switch` 的 `seed` 回填。
- 余额是查询那一刻的实时值，不是某个时间段的消费额。

## 许可证

MIT
