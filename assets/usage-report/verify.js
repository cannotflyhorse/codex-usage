// 自检脚本：用最小 DOM 桩在 Node 里跑一遍前端渲染，确认不会抛异常。
// 用法：node verify.js
const fs = require('node:fs');
const path = require('node:path');

const elements = new Map();

function makeEl(id) {
  const target = {
    id,
    innerHTML: '',
    textContent: '',
    className: '',
    scrollTop: 0,
    dataset: {},
    children: [],
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {},
    querySelector(selector) {
      const key = `${id}>${selector}`;
      if (!elements.has(key)) elements.set(key, makeEl(key));
      return elements.get(key);
    },
    querySelectorAll: () => [],
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      return () => {};
    },
    set(t, prop, value) {
      t[prop] = value;
      return true;
    },
  });
}

globalThis.document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  },
  querySelectorAll: () => [],
  addEventListener() {},
};
globalThis.EventSource = class {
  constructor() {}
};
globalThis.fetch = () => Promise.resolve({ json: () => Promise.resolve(null) });
globalThis.setInterval = () => 0;

const src = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
const factory = new Function(`${src}\n;return { render, money, balanceText, fmtTokens, pct };`);
const app = factory();

const { loadPricing } = require('./lib/pricing');
const { scanSessions, CODEX_HOME } = require('./lib/scanner');
const { buildSnapshot } = require('./lib/aggregate');
const { loadKeyStore, loadHistory, buildProfilesSection, setBalanceProvider } = require('./lib/profiles');

(async () => {
  // 自检不联网，余额返回 null，前端应显示占位符而不是崩掉
  setBalanceProvider(() => null);
  const history = loadHistory(CODEX_HOME);
  const keyStore = loadKeyStore(CODEX_HOME);
  const snapshot = buildSnapshot({
    sessions: await scanSessions(),
    pricing: loadPricing(),
    history: history.entries,
  });
  snapshot.profiles = buildProfilesSection(snapshot, keyStore, history);
  app.render(snapshot);

  const callsHtml = elements.get('calls-table>tbody').innerHTML;
  const firstRowHtml = callsHtml.split('<tr')[1] || '';
  const firstRowCells = (firstRowHtml.match(/<td/g) || []).length;
  const profilesHtml = elements.get('profiles').innerHTML;

  const checks = [
    ['顶部卡片', elements.get('cards').innerHTML.includes('本次对话')],
    ['当前对话面板', elements.get('active-session').innerHTML.includes('命中率')],
    ['每日图表', elements.get('daily-chart').innerHTML.includes('<rect')],
    ['调用流水', elements.get('calls-table>tbody').innerHTML.includes('<tr')],
    ['流水 Key 列', firstRowCells === 10],
    ['按 key 面板', keyStore.available
      ? profilesHtml.includes('今日 · 本月')
      : profilesHtml.includes('还没有登记')],
    ['会话列表', elements.get('sessions').innerHTML.includes('session-row')],
    ['会话明细', elements.get('session-detail').innerHTML.includes('<table')],
    ['单价表', elements.get('pricing-table').innerHTML.includes('缓存命中')],
    ['金额格式', /^[¥$]\d/.test(app.money(1.2345)) && /^[¥$]\d/.test(app.money(0.0012345))],
    ['余额占位', app.balanceText(null) === '—'],
    ['token 格式', app.fmtTokens(2_500_000) === '2.50M'],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项未通过`);
  process.exit(failed === 0 ? 0 : 1);
})();
