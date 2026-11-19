// NVIDIA API Catalog (build.nvidia.com) 최소 클라이언트 (Node 전용: 수집 스크립트, LLM 프록시).
// OpenAI 호환 POST https://integrate.api.nvidia.com/v1/chat/completions 를 fetch로 직접 호출한다.
//
// 호스팅 엔드포인트 문서에는 JSON 스키마 강제 옵션(response_format / guided_json)이 없어서,
//   1) 시스템 프롬프트에 JSON 스키마를 넣고
//   2) 응답에서 JSON을 꺼내 스키마(타입·필수 필드)를 검사한 뒤
//   3) 실패하면 오류 내용을 알려 주고 한 번 더 요청한다.
// enum 같은 값 범위는 여기서 검사하지 않고, 호출하는 쪽에서 화이트리스트로 다시 거른다.

const API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MAX_TOKENS_LIMIT = 4096; // 호스팅 API 상한

export class LlmError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.retryable = retryable;
  }
}

// 모델은 수시로 단종된다(410). 쉼표로 여러 개를 주면 앞에서부터 쓰고, 단종·없음(404/410)이면 다음 모델로 넘어간다.
// 후보 확인: npm run check-models
// 실측(2026-11, 실제 장학금 데이터, 페르소나 '민수'):
//   nemotron-3.5-lightning: 설명 10~13초, 인용 모두 원문 일치, 애매하면 '확인 필요'로 보수적
//   glm-5.3-flash         : 설명 약 50초, 판단은 더 정교함 → 사용자가 기다리지 않는 수집 단계에 사용
// 요청 단계(재정렬·설명·질문·자연어 입력) — 브라우저 대기 시간이 중요
export const DEFAULT_MODELS = 'nvidia/nemotron-3.5-lightning-30b-a3b,z-ai/glm-5.3-flash';
// 수집 단계(조건 구조화, 배치) — 시간보다 정확도
export const DEFAULT_COLLECT_MODELS = 'z-ai/glm-5.3-flash,nvidia/nemotron-3.5-lightning-30b-a3b';

// 호스팅 API의 모델은 대부분 '추론(thinking)' 모델이라 그대로 쓰면 10~80초가 걸린다.
// 모델마다 추론을 끄는 방법이 달라서 실측(2026-11) 결과대로 요청 옵션을 붙인다.
//   nemotron-3.5-lightning: chat_template_kwargs.enable_thinking=false → 추론 0토큰, 0.5초
//   glm-5.3-flash         : reasoning_effort='low'                  → 추론 0토큰, 4초
//   deepseek-v4.1-flash   : chat_template_kwargs를 보내면 500 오류 → 옵션 없이 사용 (느림)
// 새 모델을 쓰려면 npm run check-models로 확인하고 여기에 추가한다.
export const MODEL_OPTIONS = {
  'nvidia/nemotron-3.5-lightning-30b-a3b': { chat_template_kwargs: { enable_thinking: false } },
  'z-ai/glm-5.3-flash': { reasoning_effort: 'low' },
  'mistralai/mistral-large-4-1t-a52b': { chat_template_kwargs: { enable_thinking: false } },
};

export function llmConfig(env = process.env) {
  const list = (v) => v.split(',').map((m) => m.trim()).filter(Boolean);
  const models = list(env.NVIDIA_MODEL || DEFAULT_MODELS);
  return {
    apiKey: env.NVIDIA_API_KEY || '',
    models,
    collectModels: list(env.NVIDIA_MODEL_COLLECT || DEFAULT_COLLECT_MODELS),
    model: models[0],
    temperature: env.NVIDIA_TEMPERATURE != null && env.NVIDIA_TEMPERATURE !== '' ? Number(env.NVIDIA_TEMPERATURE) : 0.1,
  };
}

const deadModels = new Set(); // 이 프로세스에서 404/410을 받은 모델

function pickModel(config) {
  const alive = config.models.filter((m) => !deadModels.has(m));
  if (alive.length === 0) throw new LlmError(`사용할 수 있는 모델이 없습니다 (단종 또는 없음: ${config.models.join(', ')}). NVIDIA_MODEL을 바꾸세요.`, { status: 500 });
  return alive[0];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────── JSON 추출·검사 ─────────────────────────

/** 모델 출력에서 JSON 객체를 꺼낸다 (<think> 블록, ```json 코드 블록, 앞뒤 설명문 제거) */
export function extractJson(text) {
  let t = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) t = fenced[1].trim();
  try { return JSON.parse(t); } catch { /* 아래에서 객체 부분만 찾기 */ }
  const start = t.indexOf('{');
  if (start === -1) throw new Error('JSON 객체를 찾지 못했습니다.');
  // 문자열 안의 괄호를 무시하면서 짝이 맞는 닫는 괄호를 찾는다
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < t.length; i += 1) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(t.slice(start, i + 1));
    }
  }
  throw new Error('JSON 객체가 닫히지 않았습니다.');
}

function typeOk(value, type) {
  switch (type) {
    case 'null': return value === null;
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'integer': return Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'array': return Array.isArray(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    default: return true;
  }
}

/** 간단한 JSON 스키마 검사 (type, required, properties, items). 오류 메시지 목록을 돌려준다. */
export function validate(value, schema, at = '$') {
  if (!schema) return [];
  const types = schema.type ? [].concat(schema.type) : null;
  if (types && !types.some((t) => typeOk(value, t))) return [`${at}: ${types.join('|')} 타입이어야 합니다.`];
  const errors = [];
  if (typeOk(value, 'object') && schema.properties) {
    for (const key of schema.required || []) if (!(key in value)) errors.push(`${at}.${key}: 필수 필드가 없습니다.`);
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (key in value) errors.push(...validate(value[key], sub, `${at}.${key}`));
    }
  }
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => errors.push(...validate(v, schema.items, `${at}[${i}]`)));
  return errors;
}

// ───────────────────────── 호출 ─────────────────────────

function systemWithSchema(system, schema) {
  return `${system}

출력 형식:
- 아래 JSON Schema를 따르는 JSON 객체 하나만 출력한다. 설명문, 코드 블록 표시(\`\`\`)를 붙이지 않는다.
- 모든 required 필드를 빠짐없이 넣는다. 값이 없으면 null 또는 빈 배열을 쓴다.
JSON Schema:
${JSON.stringify(schema)}`;
}

/**
 * JSON 응답을 요구하는 호출. 파싱·스키마 검사에 실패하면 한 번 더 요청한다.
 * @param {object} opts
 * @param {string} opts.system
 * @param {string} opts.user
 * @param {object} opts.schema
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.retries]  429/5xx/네트워크 오류 재시도 횟수
 */
export async function callLlmJson({
  system, user, schema, maxTokens = MAX_TOKENS_LIMIT, timeoutMs = 60000, retries = 2, config = llmConfig(),
}) {
  if (!config.apiKey) throw new LlmError('NVIDIA_API_KEY가 설정되지 않았습니다.', { status: 500 });
  const messages = [
    { role: 'system', content: systemWithSchema(system, schema) },
    { role: 'user', content: user },
  ];

  for (let fix = 0; fix < 2; fix += 1) {
    const { text, finish } = await requestWithRetry(config, messages, Math.min(maxTokens, MAX_TOKENS_LIMIT), timeoutMs, retries);
    let parsed; let problem;
    try {
      parsed = extractJson(text);
      const errors = validate(parsed, schema);
      if (errors.length) problem = errors.slice(0, 5).join('\n');
    } catch (err) {
      problem = finish === 'length' ? '출력이 길이 제한에서 잘렸습니다. 더 짧게 출력하세요.' : err.message;
    }
    if (!problem) return parsed;
    if (fix === 1) throw new LlmError(`모델 응답이 형식에 맞지 않습니다: ${problem}`, { status: 502 });
    messages.push({ role: 'assistant', content: text });
    messages.push({ role: 'user', content: `출력이 형식에 맞지 않습니다:\n${problem}\nJSON Schema에 맞는 JSON 객체 하나만 다시 출력하세요.` });
  }
  throw new LlmError('알 수 없는 오류', { status: 500 });
}

async function requestWithRetry(config, messages, maxTokens, timeoutMs, retries) {
  const gaveUp = new Set(); // 이번 요청에서 재시도를 다 써 버린 모델
  for (let attempt = 0; ; ) {
    const alive = config.models.filter((m) => !deadModels.has(m) && !gaveUp.has(m));
    const model = alive[0] || pickModel(config);
    try {
      return await requestOnce(config, model, messages, maxTokens, timeoutMs);
    } catch (err) {
      if (err instanceof LlmError && (err.status === 404 || err.status === 410)) {
        // 단종·없는 모델: 다음 후보로 바로 넘어간다 (재시도 횟수를 쓰지 않음)
        deadModels.add(model);
        console.warn(`[llm] ${model} 사용 불가 (${err.status}) → 다음 모델로 전환`);
        continue;
      }
      if (err instanceof LlmError && err.retryable && attempt >= retries && alive.length > 1) {
        // 시간 초과·서버 오류가 계속되면 이번 요청만 다음 후보 모델로 다시 시도한다
        gaveUp.add(model);
        console.warn(`[llm] ${model} 응답 실패 (${err.message}) → ${alive[1]}로 다시 시도`);
        attempt = 0;
        continue;
      }
      if (!(err instanceof LlmError) || !err.retryable || attempt >= retries) throw err;
      await sleep(Math.min(err.retryAfterMs ?? 1500 * 2 ** attempt, 20000));
      attempt += 1;
    }
  }
}

async function requestOnce(config, model, messages, maxTokens, timeoutMs) {
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: config.temperature,
        max_tokens: maxTokens,
        stream: false,
        ...(MODEL_OPTIONS[model] || {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new LlmError(`NVIDIA API 연결 실패: ${err.message}`, { retryable: true });
  }

  // 202: 결과 대기 중(NVCF). 폴링 방법이 문서화돼 있지 않아 재시도로 처리한다.
  if (res.status === 202) throw new LlmError('NVIDIA API 응답 대기 중 (202)', { status: 504, retryable: true });
  if (!res.ok) {
    let detail = '';
    try { const e = await res.json(); detail = e.detail || e.error?.message || e.title || ''; } catch { /* 본문 없음 */ }
    const retryable = res.status === 429 || res.status === 408 || res.status >= 500;
    const err = new LlmError(`NVIDIA API 오류 ${res.status}: ${detail}`, { status: res.status, retryable });
    const ra = Number(res.headers.get('retry-after'));
    if (Number.isFinite(ra) && ra > 0) err.retryAfterMs = ra * 1000;
    throw err;
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  const text = choice?.message?.content;
  if (!text) throw new LlmError('응답에 내용이 없습니다.', { status: 502, retryable: true });
  return { text, finish: choice.finish_reason };
}
