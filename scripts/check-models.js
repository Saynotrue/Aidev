// NVIDIA 모델 후보를 같은 한국어 과제로 시험해 본다: 사용 가능 여부(단종 410 등), 응답 시간, JSON 형식, 원문 인용 정확도.
// 실행: npm run check-models                 (기본 후보)
//       npm run check-models -- 모델A 모델B   (직접 지정)
// 결과를 보고 .env에 쉼표로 순서대로 적는다.
//   NVIDIA_MODEL=빠른모델,예비모델            (요청 단계: 10초 안팎이 목표)
//   NVIDIA_MODEL_COLLECT=정확한모델,예비모델  (수집 단계: 시간보다 정확도)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.js';
import { callLlmJson, llmConfig, DEFAULT_MODELS, DEFAULT_COLLECT_MODELS } from '../lib/llm.js';
import { isGrounded } from '../lib/grounding.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(ROOT);

const CANDIDATES = process.argv.slice(2).length ? process.argv.slice(2) : [
  ...new Set([...DEFAULT_MODELS.split(','), ...DEFAULT_COLLECT_MODELS.split(',')]),
  'mistralai/mistral-large-4-1t-a52b',
  'deepseek-ai/deepseek-v4.1-flash',
];

// 실제 장학금 공고 형식을 본뜬 시험용 원문 (평가 기준이 명확하도록 직접 작성)
const SOURCE = `이름: 시험용 대학생 장학금
지원 대상: 공고일 기준 본인 또는 보호자가 경기도에 1년 이상 주민등록을 둔 대학 재학생
선정 기준: [성적기준] 직전 학기 평점 3.0 이상 (4.5 만점)
[소득기준] 학자금 지원구간 8구간 이하
지원 금액: 1인당 200만원`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['checks', 'summary'],
  properties: {
    checks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'status', 'reason', 'evidence'],
        properties: {
          label: { type: 'string' },
          status: { type: 'string', enum: ['ok', 'check', 'fail'] },
          reason: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    summary: { type: 'string' },
  },
};

const SYSTEM = `너는 장학금 자격 조건을 설명하는 도우미다. 원문의 자격 조건을 항목별로 나누고 사용자 조건과 비교한다.
status: ok=충족, check=확인 필요, fail=미충족. evidence에는 원문 문장을 글자 그대로 복사한다. 한국어로 짧게 쓴다.`;
const USER = `사용자: 22세, 경기 수원시 거주, 대학 재학, 직전 학기 3.5, 학자금 지원구간 4구간\n\n<benefit>\n${SOURCE}\n</benefit>`;

const base = llmConfig();
if (!base.apiKey) {
  console.error('.env에 NVIDIA_API_KEY가 없습니다.');
  process.exit(1);
}

console.log(`후보 ${CANDIDATES.length}개 시험 중… (모델별 1~2회 호출)\n`);
const rows = [];
for (const model of CANDIDATES) {
  const t0 = Date.now();
  try {
    const out = await callLlmJson({
      config: { ...base, models: [model], model }, system: SYSTEM, user: USER, schema: SCHEMA,
      maxTokens: 2048, timeoutMs: 45000, retries: 0,
    });
    const quotes = out.checks.flatMap((c) => c.evidence || []);
    const grounded = quotes.filter((q) => isGrounded(q, SOURCE)).length;
    const statuses = out.checks.map((c) => `${c.label}:${c.status}`).join(' ');
    rows.push({ model, ok: true, sec: (Date.now() - t0) / 1000, note: `인용 ${grounded}/${quotes.length} 원문 일치 | ${statuses}` });
  } catch (err) {
    rows.push({ model, ok: false, sec: (Date.now() - t0) / 1000, note: err.message.slice(0, 120) });
  }
  const r = rows.at(-1);
  console.log(`${r.ok ? '✅' : '❌'} ${r.model.padEnd(38)} ${r.sec.toFixed(1).padStart(5)}초  ${r.note}`);
}

const good = rows.filter((r) => r.ok).sort((a, b) => a.sec - b.sec);
console.log(good.length
  ? `\n사용 가능 ${good.length}개 (빠른 순): ${good.map((r) => r.model).join(', ')}`
  : '\n사용 가능한 모델이 없습니다. https://build.nvidia.com/models 에서 다른 모델 ID를 찾아 인자로 넣어 보세요.');
console.log('정답 기준: 거주 지역·성적·소득 모두 ok, 인용은 전부 원문 일치가 이상적입니다.');
