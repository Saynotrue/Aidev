// LLM 프록시 서버리스 함수 (Vercel Functions, Node.js 런타임).
// 브라우저에 API 키를 노출하지 않기 위한 최소 구성. 실제 로직은 lib/ai-handler.js에 있다.
// 배포 시 Vercel 프로젝트 환경 변수에 NVIDIA_API_KEY를 등록한다.

import { handleAi } from '../lib/ai-handler.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST만 허용됩니다.' });
  }
  // 같은 사이트에서 온 요청만 받으려면 ALLOWED_ORIGIN에 배포 주소를 넣는다 (예: https://example.vercel.app)
  const allowed = process.env.ALLOWED_ORIGIN;
  if (allowed && req.headers.origin && req.headers.origin !== allowed) {
    return res.status(403).json({ error: '허용되지 않은 출처입니다.' });
  }
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'JSON 본문이 필요합니다.' }); }
  }
  const { status, data } = await handleAi(body);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(data);
}
