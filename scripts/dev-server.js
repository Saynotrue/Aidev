// 로컬 개발 서버: 정적 파일 + /api/ai 프록시. 외부 패키지 없이 node:http만 사용한다.
// 실행: npm run dev  →  http://localhost:5173

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(ROOT);
const { handleAi } = await import('../lib/ai-handler.js');

const PORT = Number(process.env.PORT) || 5173;
const MAX_BODY = 64 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};
// 브라우저에 공개할 경로만 허용한다 (.env, scripts/, lib/, data/raw 등은 제공하지 않음)
const PUBLIC = [/^\/index\.html$/, /^\/css\/[\w.-]+\.css$/, /^\/js\/[\w.-]+\.js$/, /^\/data\/benefits(\.sample)?\.json$/,
  /^\/favicon\.ico$/, /^\/manifest\.webmanifest$/, /^\/icons\/[\w.-]+\.(svg|png)$/];

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/ai') {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST만 허용됩니다.' });
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { error: '잘못된 요청 본문입니다.' }); }
    const { status, data } = await handleAi(body, { root: ROOT });
    return send(res, status, data);
  }

  if (pathname === '/') pathname = '/index.html';
  if (req.method !== 'GET' || !PUBLIC.some((re) => re.test(pathname))) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  try {
    const file = await readFile(path.join(ROOT, pathname));
    return send(res, 200, file, MIME[path.extname(pathname)] || 'application/octet-stream');
  } catch {
    return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  }
});

server.listen(PORT, () => {
  console.log(`받을지도 개발 서버: http://localhost:${PORT}`);
  if (!process.env.NVIDIA_API_KEY) console.log('  (NVIDIA_API_KEY 없음: AI 기능 없이 규칙 기반으로만 동작합니다)');
});
