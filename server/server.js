// 零依赖 HTTP 服务：
//   GET  /                 前端页面
//   GET  /<静态资源>        public 目录下的静态文件
//   POST /api/fixture-plans 方案裁决接口
//   GET  /healthz          健康检查
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { solve } from './solver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY_BYTES = 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('请求体过大'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  // 防止路径穿越
  const safePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = await readFile(safePath);
    const ext = path.extname(safePath).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}

async function handlePlan(req, res) {
  let raw;
  try {
    const text = await readBody(req);
    raw = JSON.parse(text);
  } catch (err) {
    sendJson(res, err.statusCode || 400, { error: '请求体不是合法 JSON', detail: err.message });
    return;
  }
  try {
    const result = solve(raw);
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 422, { error: '输入校验失败', detail: err.message });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'POST' && url.pathname === '/api/fixture-plans') {
      await handlePlan(req, res);
    } else if (req.method === 'GET' && url.pathname === '/healthz') {
      sendJson(res, 200, { status: 'ok' });
    } else if (req.method === 'GET') {
      await serveStatic(req, res);
    } else {
      res.writeHead(405, { allow: 'GET, POST' });
      res.end('Method Not Allowed');
    }
  } catch (err) {
    sendJson(res, 500, { error: '服务器内部错误', detail: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`fixture-plan service listening on http://${HOST}:${PORT}`);
});

export { server };
