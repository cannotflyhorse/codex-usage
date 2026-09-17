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
const factory = new Function(`${src}\n;return { render, money, fmtTokens, pct };`);
const app = factory();

const { loadPricing } = require('./lib/pricing');
const { scanSessions } = require('./lib/scanner');
const { buildSnapshot } = require('./lib/aggregate');

(async () => {
  const snapshot = buildSnapshot({ sessions: await scanSessions(), pricing: loadPricing() });
  app.render(snapshot);

  const checks = [
    ['顶部卡片', elements.get('cards').innerHTML.includes('本次对话')],
    ['当前对话面板', elements.get('active-session').innerHTML.includes('命中率')],
    ['每日图表', elements.get('daily-chart').innerHTML.includes('<rect')],
    ['调用流水', elements.get('calls-table>tbody').innerHTML.includes('<tr')],
    ['会话列表', elements.get('sessions').innerHTML.includes('session-row')],
    ['会话明细', elements.get('session-detail').innerHTML.includes('<table')],
    ['单价表', elements.get('pricing-table').innerHTML.includes('缓存命中')],
    ['金额格式', /^\$\d/.test(app.money(1.2345))],
    ['token 格式', app.fmtTokens(2_500_000) === '2.50M'],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项未通过`);
  process.exit(failed === 0 ? 0 : 1);
})();
