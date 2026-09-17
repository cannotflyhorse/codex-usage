'use strict';

const state = {
  snapshot: null,
  currency: 'CNY',
  selectedSession: null,
  lastCallKey: null,
  lastUpdate: 0,
};

const el = (id) => document.getElementById(id);

function fmtTokens(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function fmtInt(n) {
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—';
}

function money(usd) {
  const value = Number.isFinite(usd) ? usd : 0;
  const rate = state.snapshot?.currency?.usdToCny;
  if (state.currency === 'CNY' && rate) return `¥${(value * rate).toFixed(value * rate >= 100 ? 2 : 3)}`;
  if (value === 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(5)}`;
  if (value < 100) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function pct(value) {
  return `${((value || 0) * 100).toFixed(1)}%`;
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtClock(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function ago(iso) {
  if (!iso) return '';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} 小时前`;
  return `${Math.round(seconds / 86400)} 天前`;
}

function usageBar(totals) {
  const sum = Math.max(1, totals.cached + (totals.input - totals.cached) + totals.output);
  const hit = (totals.cached / sum) * 100;
  const miss = ((totals.input - totals.cached) / sum) * 100;
  const out = (totals.output / sum) * 100;
  return `<div class="bar"><span class="hit" style="width:${hit}%"></span><span class="miss" style="width:${miss}%"></span><span class="out" style="width:${out}%"></span></div>
    <div class="legend">
      <span><i class="i-hit"></i>缓存命中 ${fmtTokens(totals.cached)}</span>
      <span><i class="i-miss"></i>未命中 ${fmtTokens(totals.input - totals.cached)}</span>
      <span><i class="i-out"></i>输出 ${fmtTokens(totals.output)}</span>
    </div>`;
}

function renderCards(snapshot) {
  const active = snapshot.sessions.find((s) => s.id === snapshot.activeSessionId) || null;
  const { all, today, month } = snapshot.totals;
  const activeTotals = active ? active.totals : null;
  const cards = [
    {
      label: '本次对话',
      value: activeTotals ? fmtInt(activeTotals.total) : '—',
      sub: activeTotals
        ? `${activeTotals.calls} 次调用 · 命中率 ${pct(activeTotals.cacheHitRate)}`
        : '暂无进行中的对话',
      highlight: true,
    },
    {
      label: '本次对话花费',
      value: activeTotals ? money(activeTotals.cost) : '—',
      sub: activeTotals ? `缓存已省 ${money(activeTotals.dollarSavedByCache)}` : '—',
    },
    { label: '今日', value: money(today.cost), sub: `${fmtTokens(today.total)} tokens · ${today.calls} 次调用` },
    { label: '本月', value: money(month.cost), sub: `${fmtTokens(month.total)} tokens · ${month.calls} 次调用` },
    {
      label: '全部历史',
      value: money(all.cost),
      sub: `${fmtTokens(all.total)} tokens · ${snapshot.sessions.length} 个对话 · 命中率 ${pct(all.cacheHitRate)}`,
    },
  ];
  el('cards').innerHTML = cards
    .map(
      (c) => `<div class="card${c.highlight ? ' highlight' : ''}">
        <div class="label"><span>${c.label}</span></div>
        <div class="value">${c.value}</div>
        <div class="sub">${c.sub}</div>
      </div>`,
    )
    .join('');
}

function renderActive(snapshot) {
  const active = snapshot.sessions.find((s) => s.id === snapshot.activeSessionId);
  el('active-hint').textContent = active ? `最近活动 ${ago(active.lastActivityAt)}` : '';
  if (!active) {
    el('active-session').innerHTML = '<p class="empty">还没有记录到用量调用。</p>';
    return;
  }
  const t = active.totals;
  const turns = [...active.turns].slice(-8).reverse();
  el('active-session').innerHTML = `
    <div class="stat-row">
      <div class="stat"><div class="k">对话</div><div class="v" style="font-size:13px">${active.project}</div></div>
      <div class="stat"><div class="k">模型</div><div class="v" style="font-size:13px">${active.modelLabel || '—'}</div></div>
      <div class="stat"><div class="k">调用次数</div><div class="v">${t.calls}</div></div>
      <div class="stat"><div class="k">合计 tokens</div><div class="v">${fmtInt(t.total)}</div></div>
      <div class="stat"><div class="k">花费</div><div class="v">${money(t.cost)}</div></div>
      <div class="stat"><div class="k">命中率</div><div class="v">${pct(t.cacheHitRate)}</div></div>
    </div>
    ${usageBar(t)}
    <div class="table-wrap" style="max-height:200px;margin-top:12px">
      <table>
        <thead><tr><th>最近轮次</th><th class="num">调用</th><th class="num">输入</th><th class="num">缓存</th><th class="num">输出</th><th class="num">合计</th><th class="num">金额</th></tr></thead>
        <tbody>${turns
          .map(
            (turn) => `<tr>
            <td>${fmtClock(turn.lastAt || turn.startedAt)}</td>
            <td class="num">${turn.calls}</td>
            <td class="num">${fmtInt(turn.input)}</td>
            <td class="num">${fmtInt(turn.cached)}</td>
            <td class="num">${fmtInt(turn.output)}</td>
            <td class="num">${fmtInt(turn.total)}</td>
            <td class="num">${money(turn.cost)}</td>
          </tr>`,
          )
          .join('')}</tbody>
      </table>
    </div>`;
}

function renderDailyChart(snapshot) {
  const days = snapshot.byDay.slice(-14);
  if (days.length === 0) {
    el('daily-chart').innerHTML = '<p class="empty">暂无数据。</p>';
    return;
  }
  const width = 640;
  const height = 190;
  const pad = { top: 14, right: 46, bottom: 26, left: 46 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const maxTokens = Math.max(...days.map((d) => d.total), 1);
  const maxCost = Math.max(...days.map((d) => d.cost), 1e-9);
  const slot = innerW / days.length;
  const barW = Math.min(38, slot * 0.55);

  const bars = days
    .map((d, i) => {
      const h = (d.total / maxTokens) * innerH;
      const x = pad.left + i * slot + (slot - barW) / 2;
      const y = pad.top + innerH - h;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="url(#g1)"><title>${d.date}: ${fmtInt(d.total)} tokens / ${money(d.cost)}</title></rect>`;
    })
    .join('');

  const points = days.map((d, i) => {
    const x = pad.left + i * slot + slot / 2;
    const y = pad.top + innerH - (d.cost / maxCost) * innerH;
    return [x, y];
  });
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const dots = points
    .map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="#e3873c"><title>${days[i].date}: ${money(days[i].cost)}</title></circle>`)
    .join('');

  const labels = days
    .map((d, i) => {
      const x = pad.left + i * slot + slot / 2;
      return `<text x="${x.toFixed(1)}" y="${height - 8}" fill="#8b98a9" font-size="10" text-anchor="middle">${d.date.slice(5)}</text>`;
    })
    .join('');

  el('daily-chart').innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="每日用量与花费">
      <defs>
        <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2f81f7" stop-opacity="0.95" />
          <stop offset="100%" stop-color="#2f81f7" stop-opacity="0.25" />
        </linearGradient>
      </defs>
      ${bars}
      <path d="${line}" fill="none" stroke="#e3873c" stroke-width="2" />
      ${dots}
      ${labels}
      <text x="6" y="${pad.top + 4}" fill="#8b98a9" font-size="10">${fmtTokens(maxTokens)}</text>
      <text x="${width - 6}" y="${pad.top + 4}" fill="#8b98a9" font-size="10" text-anchor="end">${money(maxCost)}</text>
    </svg>`;
}

function renderCalls(snapshot) {
  const rows = snapshot.recentCalls;
  const tbody = el('calls-table').querySelector('tbody');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">暂无调用记录。</td></tr>';
    return;
  }
  const newestKey = `${rows[0].atMs}|${rows[0].total}`;
  const isFresh = state.lastCallKey !== null && state.lastCallKey !== newestKey;
  state.lastCallKey = newestKey;

  tbody.innerHTML = rows
    .map((call, index) => {
      const miss = call.input - call.cached;
      const tier = call.tier === 'peak'
        ? '<span class="pill peak">高峰</span>'
        : '<span class="pill off">低谷</span>';
      return `<tr class="${isFresh && index === 0 ? 'fresh' : ''}">
        <td>${fmtTime(call.at)} ${tier}</td>
        <td>${call.project || '—'}</td>
        <td class="num">${fmtInt(call.input)}</td>
        <td class="num">${fmtInt(call.cached)}</td>
        <td class="num">${fmtInt(miss)}</td>
        <td class="num">${fmtInt(call.output)}${call.reasoning ? ` <span class="muted small">(思考 ${fmtInt(call.reasoning)})</span>` : ''}</td>
        <td class="num">${fmtInt(call.total)}</td>
        <td class="num">${pct(call.cacheHitRate)}</td>
        <td class="num">${money(call.cost)}</td>
      </tr>`;
    })
    .join('');
}

function renderSessions(snapshot) {
  const box = el('sessions');
  if (snapshot.sessions.length === 0) {
    box.innerHTML = '<p class="empty">暂无会话。</p>';
    return;
  }
  if (!state.selectedSession || !snapshot.sessions.some((s) => s.id === state.selectedSession)) {
    state.selectedSession = snapshot.activeSessionId || snapshot.sessions[0].id;
  }
  box.innerHTML = snapshot.sessions
    .map((s) => {
      const isActive = s.id === snapshot.activeSessionId;
      return `<div class="session-row${s.id === state.selectedSession ? ' on' : ''}" data-id="${s.id}">
        <div>
          <div class="name">${s.project}${isActive ? ' <span class="pill">进行中</span>' : ''}</div>
          <div class="meta">${fmtTime(s.lastActivityAt)} · ${ago(s.lastActivityAt)} · ${s.callCount} 次调用 · ${fmtTokens(s.totals.total)} tokens · 命中率 ${pct(s.totals.cacheHitRate)}</div>
        </div>
        <div class="amt"><b>${money(s.totals.cost)}</b><div class="meta">${s.modelLabel || ''}</div></div>
      </div>`;
    })
    .join('');
  box.querySelectorAll('.session-row').forEach((node) => {
    node.addEventListener('click', () => {
      state.selectedSession = node.dataset.id;
      renderSessions(state.snapshot);
      renderDetail(state.snapshot);
    });
  });
}

function renderDetail(snapshot) {
  const session = snapshot.sessions.find((s) => s.id === state.selectedSession);
  if (!session) {
    el('session-detail').innerHTML = '<p class="empty">选择左侧会话查看逐轮明细。</p>';
    return;
  }
  el('detail-title').textContent = session.cwd || session.id;
  const turns = [...session.turns].reverse();
  el('session-detail').innerHTML = `
    <div class="stat-row">
      <div class="stat"><div class="k">会话开始</div><div class="v" style="font-size:13px">${fmtTime(session.startedAt)}</div></div>
      <div class="stat"><div class="k">合计</div><div class="v">${fmtInt(session.totals.total)}</div></div>
      <div class="stat"><div class="k">花费</div><div class="v">${money(session.totals.cost)}</div></div>
      <div class="stat"><div class="k">命中率</div><div class="v">${pct(session.totals.cacheHitRate)}</div></div>
    </div>
    <table>
      <thead><tr><th>轮次时间</th><th class="num">调用</th><th class="num">输入</th><th class="num">缓存</th><th class="num">输出</th><th class="num">合计</th><th class="num">金额</th></tr></thead>
      <tbody>${turns
        .map(
          (turn) => `<tr>
          <td>${fmtTime(turn.startedAt)}</td>
          <td class="num">${turn.calls}</td>
          <td class="num">${fmtInt(turn.input)}</td>
          <td class="num">${fmtInt(turn.cached)}</td>
          <td class="num">${fmtInt(turn.output)}</td>
          <td class="num">${fmtInt(turn.total)}</td>
          <td class="num">${money(turn.cost)}</td>
        </tr>`,
        )
        .join('')}</tbody>
    </table>`;
}

function renderPricing(snapshot) {
  const price = (v) => `$${v.toFixed(v < 0.01 ? 4 : 2)}`;
  const rows = Object.entries(snapshot.pricing.models)
    .map(
      ([key, def]) => `<tr>
      <td>${def.label || key}<div class="muted small">${key}</div></td>
      <td class="num">${price(def.peak.cache_hit)}</td>
      <td class="num">${price(def.peak.cache_miss)}</td>
      <td class="num">${price(def.peak.output)}</td>
      <td class="num">${price(def.off_peak.cache_hit)}</td>
      <td class="num">${price(def.off_peak.cache_miss)}</td>
      <td class="num">${price(def.off_peak.output)}</td>
    </tr>`,
    )
    .join('');
  el('pricing-table').innerHTML = `<table>
    <thead>
      <tr>
        <th rowspan="2">模型</th>
        <th colspan="3" class="num">高峰时段（UTC 01:00-04:00 / 06:00-10:00，周一至周五）</th>
        <th colspan="3" class="num">低谷时段（半价）</th>
      </tr>
      <tr>
        <th class="num">缓存命中</th><th class="num">缓存未命中</th><th class="num">输出</th>
        <th class="num">缓存命中</th><th class="num">缓存未命中</th><th class="num">输出</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="muted small" style="margin-top:8px">单位：美元 / 每 100 万 token。高峰时段对应北京时间 ${snapshot.pricing.peakWindows
    .map((w) => {
      const toLocal = (t) => {
        const [h, m] = t.split(':').map(Number);
        const local = (h + 8) % 24;
        return `${String(local).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      };
      return `${toLocal(w.start)}-${toLocal(w.end)}`;
    })
    .join(' / ')}。</p>`;
  el('pricing-note').textContent = '来源：DeepSeek 官方 API 价格表';
}

function render(snapshot) {
  // 保留表格滚动位置，避免自动刷新时把用户翻到的位置弹回顶部
  const scrolls = [...document.querySelectorAll('.table-wrap, .sessions, .detail')].map((node) => node.scrollTop);
  state.snapshot = snapshot;
  state.lastUpdate = Date.now();
  renderCards(snapshot);
  renderActive(snapshot);
  renderDailyChart(snapshot);
  renderCalls(snapshot);
  renderSessions(snapshot);
  renderDetail(snapshot);
  renderPricing(snapshot);
  const next = document.querySelectorAll('.table-wrap, .sessions, .detail');
  scrolls.forEach((top, index) => {
    if (next[index] && top) next[index].scrollTop = top;
  });
  updateClock();
}

function updateClock() {
  const stamp = state.lastUpdate ? new Date(state.lastUpdate) : null;
  el('updated-at').textContent = stamp ? `更新于 ${fmtClock(stamp.toISOString())}（${ago(stamp.toISOString())}）` : '等待数据…';
  const dot = el('live-dot');
  const stale = !stamp || Date.now() - state.lastUpdate > 15000;
  dot.className = `dot ${stale ? 'stale' : 'live'}`;
}

function connect() {
  const source = new EventSource('/api/stream');
  source.onmessage = (event) => {
    try {
      render(JSON.parse(event.data));
    } catch (error) {
      console.error('解析快照失败', error);
    }
  };
  source.onerror = () => {
    el('live-dot').className = 'dot stale';
  };
}

el('currency-toggle').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  state.currency = button.dataset.cur;
  [...event.currentTarget.children].forEach((b) => b.classList.toggle('on', b === button));
  if (state.snapshot) render(state.snapshot);
});

setInterval(updateClock, 1000);
fetch('/api/snapshot')
  .then((res) => res.json())
  .then((snapshot) => {
    if (!state.snapshot) render(snapshot);
  })
  .catch(() => {});
connect();
