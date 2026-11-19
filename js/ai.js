// LLM 프록시(/api/ai) 호출. 이 파일에는 어떤 API 키도 넣지 않는다.
// 프록시가 없는 환경(예: GitHub Pages)에서는 AI 기능을 끄고 규칙 기반 결과만 보여 준다.

const ENDPOINT = 'api/ai';

let available = true;

export class AiUnavailable extends Error {}

export function aiAvailable() {
  return available;
}

async function call(action, payload, timeoutMs = 25000) {
  if (!available) throw new AiUnavailable('AI 기능을 사용할 수 없습니다.');
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(err.name === 'TimeoutError' ? 'AI 응답이 늦어 기본 결과를 보여 드립니다.' : 'AI 서버에 연결하지 못했습니다.');
  }
  // 404/405: 프록시 없음, 503: 서버에 키 없음 → 이번 세션 동안 AI 끔
  if (res.status === 404 || res.status === 405 || res.status === 503) {
    available = false;
    throw new AiUnavailable('AI 기능이 설정되지 않아 규칙 기반 결과만 보여 드립니다.');
  }
  let data = {};
  try { data = await res.json(); } catch { /* 빈 본문 */ }
  if (!res.ok) throw new Error(data.error || `AI 오류 (${res.status})`);
  return data;
}

export const ai = {
  /** 후보 재정렬 → [{ id, score, reason }] */
  rerank: (profile, ids) => call('rerank', { profile, ids }).then((d) => d.results || []),
  /** 조건별 충족 여부 설명 → { checks, summary } */
  explain: (profile, id) => call('explain', { profile, id }),
  /** 지원금별 질문 → { known, answer, evidence } */
  ask: (id, question) => call('ask', { id, question }),
  /** 자연어 → 조건 → { profile } */
  parse: (text) => call('parse', { text }, 15000),
};
