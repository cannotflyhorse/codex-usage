'use strict';

const fsp = require('node:fs/promises');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { loadPricing, PRICING_PATH } = require('./lib/pricing');
const { scanSessions, SESSION_DIRS, CODEX_HOME } = require('./lib/scanner');
const { buildSnapshot } = require('./lib/aggregate');

const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_PORT = 8787;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function parseArgs(argv) {
  const args = { port: DEFAULT_PORT, once: false, open: false, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') args.port = Number(argv[++i]) || DEFAULT_PORT;
    else if (arg.startsWith('--port=')) args.port = Number(arg.slice(7)) || DEFAULT_PORT;
    else if (arg === '--once') args.once = true;
    else if (arg === '--json') { args.once = true; args.json = true; }
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

async function buildCurrentSnapshot() {
  const pricing = loadPricing();
  const sessions = await scanSessions();
  return buildSnapshot({ sessions, pricing });
}

function signatureOf(snapshot) {
  const s = snapshot.sessions;
  return [
    s.length,
    snapshot.totals.all.calls,
    Math.round(snapshot.totals.all.total),
    Math.round(snapshot.totals.all.cost * 10000),
    snapshot.activeSessionId,
    s.reduce((acc, item) => acc + item.callCount, 0),
  ].join('|');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`用法: node server.js [--port 8787] [--once] [--json] [--quiet]

  --port <n>   监听端口（默认 ${DEFAULT_PORT}，被占用时自动顺延）
  --once       只输出一次快照后退出（适合脚本/命令行查看）
  --json       与 --once 连用，输出原始 JSON
  --quiet      不打印启动横幅`);
    return;
  }

  if (args.once) {
    const snapshot = await buildCurrentSnapshot();
    if (args.json) console.log(JSON.stringify(snapshot, null, 2));
    else printSummary(snapshot);
    return;
  }

  const clients = new Set();
  let current = await buildCurrentSnapshot();
  let currentSignature = signatureOf(current);
  let pending = null;

  const broadcast = () => {
    const payload = `data: ${JSON.stringify(current)}\n\n`;
    for (const res of clients) {
      res.write(payload);
    }
  };

  async function refresh(reason) {
    try {
      const next = await buildCurrentSnapshot();
      const nextSignature = signatureOf(next);
      current = next;
      if (nextSignature !== currentSignature) {
        currentSignature = nextSignature;
        broadcast();
      } else {
        // 数据未变也要让前端知道连接是活的
        for (const res of clients) res.write(': keep-alive\n\n');
      }
    } catch (error) {
      if (!args.quiet) console.error(`[usage-report] 扫描失败(${reason}): ${error.message}`);
    }
  }

  function scheduleRefresh(reason) {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      void refresh(reason);
    }, 700);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (url.pathname === '/api/snapshot') {
        const body = JSON.stringify(current);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(body);
        return;
      }
      if (url.pathname === '/api/stream') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        res.write(`data: ${JSON.stringify(current)}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (url.pathname === '/api/pricing') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(current.pricing));
        return;
      }
      if (url.pathname === '/api/meta') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ codexHome: CODEX_HOME, sessionDirs: SESSION_DIRS, pricingPath: PRICING_PATH, pid: process.pid }));
        return;
      }

      const rel = url.pathname === '/' ? '/index.html' : url.pathname;
      const target = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
      if (!target.startsWith(PUBLIC_DIR)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const data = await fsp.readFile(target);
      res.writeHead(200, { 'content-type': MIME[path.extname(target)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    } catch (error) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
    }
  });

  const port = await listen(server, args.port);
  const banner = `http://127.0.0.1:${port}`;
  if (!args.quiet) {
    console.log('[usage-report] 面板已启动');
    console.log(`  地址: ${banner}`);
    console.log(`  日志: ${SESSION_DIRS.join('  ')}`);
    console.log(`  单价: ${PRICING_PATH}`);
    console.log('  Ctrl+C 退出');
  }
  process.stdout.write(`USAGE_REPORT_URL=${banner}\n`);

  for (const dir of SESSION_DIRS) {
    try {
      fs.watch(dir, { recursive: true }, () => scheduleRefresh('watch'));
    } catch {
      /* 目录不存在或平台不支持递归监听时，退化为轮询 */
    }
  }
  setInterval(() => scheduleRefresh('poll'), 3000);
  setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 20000);

  const shutdown = () => {
    for (const res of clients) res.end();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function listen(server, startPort) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    const attempt = () => {
      server.once('error', (error) => {
        if (error.code === 'EADDRINUSE' && port < startPort + 12) {
          port += 1;
          attempt();
        } else reject(error);
      });
      server.listen(port, '127.0.0.1', () => resolve(port));
    };
    attempt();
  });
}

function printSummary(snapshot) {
  const usd = (value) => `$${value.toFixed(4)}`;
  const { all, today, month } = snapshot.totals;
  console.log(`快照时间: ${snapshot.generatedAt}`);
  console.log(`全部: ${all.calls} 次调用 | 输入 ${all.input.toLocaleString()} (缓存命中 ${(all.cacheHitRate * 100).toFixed(1)}%) | 输出 ${all.output.toLocaleString()} | 合计 ${all.total.toLocaleString()} tokens | ${usd(all.cost)}`);
  console.log(`今日: ${today.calls} 次调用 | 合计 ${today.total.toLocaleString()} tokens | ${usd(today.cost)}`);
  console.log(`本月: ${month.calls} 次调用 | 合计 ${month.total.toLocaleString()} tokens | ${usd(month.cost)}`);
  console.log('');
  for (const session of snapshot.sessions.slice(0, 10)) {
    console.log(`${session.lastActivityAt}  ${session.project.padEnd(18)}  ${String(session.callCount).padStart(4)} 次  ${usd(session.totals.cost).padStart(10)}  缓存命中 ${(session.totals.cacheHitRate * 100).toFixed(1)}%`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
