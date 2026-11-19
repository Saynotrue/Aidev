import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforceGrounding, isGrounded } from '../lib/grounding.js';
import { sanitizeProfile, handleAi } from '../lib/ai-handler.js';
import { mkdtempSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 실제 data/benefits.json과 상관없이 샘플 데이터로 테스트한다
const ROOT = mkdtempSync(path.join(tmpdir(), 'hyetaek-'));
mkdirSync(path.join(ROOT, 'data'));
copyFileSync(new URL('../data/benefits.sample.json', import.meta.url), path.join(ROOT, 'data', 'benefits.json'));

const benefit = { name: '청년 월세 지원', target_text: '만 19세~34세 무주택 청년', criteria_text: '기준중위소득 60% 이하' };

test('원문 근거 검사: 공백 차이는 무시, 없는 문장은 거름 (G3)', () => {
  assert.ok(isGrounded('만 19세 ~ 34세', '만 19세~34세 무주택 청년'));
  assert.ok(!isGrounded('만 39세 이하', '만 19세~34세 무주택 청년'));
  const [a, b] = enforceGrounding([
    { label: '나이', status: 'ok', reason: '해당', evidence: ['만 19세~34세'] },
    { label: '소득', status: 'fail', reason: '초과', evidence: ['기준중위소득 50% 이하'] },
  ], benefit);
  assert.equal(a.status, 'ok');
  assert.deepEqual(a.evidence, ['만 19세~34세']);
  assert.equal(b.status, 'check');
  assert.deepEqual(b.evidence, []);
});

test('프로필 화이트리스트: 알 수 없는 필드·값은 버린다', () => {
  const p = sanitizeProfile({ age: '22', sido: '경기도', name: '홍길동', phone: '010', household: ['1인 가구', '기타'], student_status: 'x' });
  assert.equal(p.age, 22);
  assert.equal(p.sido, '');
  assert.equal(p.student_status, '모름');
  assert.deepEqual(p.household, ['1인 가구']);
  assert.ok(!('name' in p) && !('phone' in p));
});

test('API 키가 없으면 503, 알 수 없는 action은 400', async () => {
  assert.equal((await handleAi({ action: 'rerank' }, { env: {} })).status, 503);
  assert.equal((await handleAi({ action: 'hack' }, { env: { NVIDIA_API_KEY: 'test' }, root: ROOT })).status, 400);
});

const chatResponse = (content, finish = 'stop') => new Response(
  JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: finish }] }), { status: 200 },
);

test('explain: NVIDIA 요청 형식과 근거 검증 (fetch 모의)', async (t) => {
  let sent;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sent = { url, headers: init.headers, body: JSON.parse(init.body) };
    const out = { summary: '대부분 충족합니다.', checks: [
      { label: '거주 지역', status: 'ok', reason: '경기 거주', evidence: ['경기도에 1년 이상 거주한 대학 재학생'] },
      { label: '성적', status: 'ok', reason: '충족', evidence: ['평점 4.0 이상'] }, // 원문에 없음 → check
    ] };
    // 모델이 코드 블록과 설명문을 붙여도 JSON을 꺼내야 한다
    return chatResponse(`다음은 결과입니다.\n\`\`\`json\n${JSON.stringify(out)}\n\`\`\``);
  });
  const r = await handleAi(
    { action: 'explain', id: 'sample-002', profile: { age: 22, sido: '경기', student_status: '재학', name: '홍길동' } },
    { env: { NVIDIA_API_KEY: 'test' }, root: ROOT },
  );
  assert.equal(r.status, 200);
  assert.equal(sent.url, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(sent.headers.authorization, 'Bearer test');
  assert.equal(sent.body.model, 'nvidia/nemotron-3.5-lightning-30b-a3b');
  assert.deepEqual(sent.body.chat_template_kwargs, { enable_thinking: false });
  assert.ok(sent.body.max_tokens <= 4096);
  assert.equal(sent.body.messages[0].role, 'system');
  assert.ok(sent.body.messages[0].content.includes('JSON Schema'));
  assert.ok(!JSON.stringify(sent.body).includes('홍길동'), '식별 정보가 LLM으로 가면 안 됨');
  assert.equal(r.data.checks[0].status, 'ok');
  assert.equal(r.data.checks[1].status, 'check');
});

test('형식이 틀린 응답은 오류를 알려 주고 한 번 더 요청한다', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return calls.length === 1
      ? chatResponse('{"known": "yes"}') // known이 boolean이 아니고 필드도 빠짐
      : chatResponse('{"known": false, "answer": "원문에서 확인할 수 없습니다.", "evidence": []}');
  });
  const r = await handleAi({ action: 'ask', id: 'sample-002', question: '휴학생도 돼?' }, { env: { NVIDIA_API_KEY: 'test' }, root: ROOT });
  assert.equal(r.status, 200);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].messages.at(-1).content.includes('형식에 맞지 않습니다'));
  assert.equal(r.data.known, false);
});

test('시·군·구는 해당 시·도 목록에 있는 값만 인정', () => {
  assert.equal(sanitizeProfile({ sido: '경기', sigungu: '수원' }).sigungu, '수원시');
  assert.equal(sanitizeProfile({ sido: '경기', sigungu: '강남구' }).sigungu, '');
  assert.equal(sanitizeProfile({ sido: '', sigungu: '수원시' }).sigungu, '');
});
