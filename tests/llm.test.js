import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, validate } from '../lib/llm.js';

test('extractJson: think 블록, 코드 블록, 앞뒤 설명문 처리', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('<think>고민 {x}</think>\n{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('결과:\n```json\n{"a":[1,2]}\n```\n끝'), { a: [1, 2] });
  assert.deepEqual(extractJson('답은 {"s":"괄호 } 포함"} 입니다'), { s: '괄호 } 포함' });
  assert.throws(() => extractJson('JSON 없음'));
});

test('validate: 타입, 필수 필드, nullable, 배열 항목', () => {
  const schema = {
    type: 'object', required: ['n', 'list'],
    properties: { n: { type: ['integer', 'null'] }, list: { type: 'array', items: { type: 'string' } } },
  };
  assert.deepEqual(validate({ n: null, list: ['a'] }, schema), []);
  assert.equal(validate({ n: 1.5, list: [] }, schema).length, 1);
  assert.equal(validate({ list: [1] }, schema).length, 2);
});

test('단종(410) 모델은 건너뛰고 다음 모델로 요청한다', async (t) => {
  const { callLlmJson } = await import('../lib/llm.js');
  const models = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const { model } = JSON.parse(init.body);
    models.push(model);
    if (model === 'old/model') return new Response(JSON.stringify({ detail: 'end of life' }), { status: 410 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }] }), { status: 200 });
  });
  t.mock.method(console, 'warn', () => {});
  const config = { apiKey: 'k', models: ['old/model', 'new/model'], model: 'old/model', temperature: 0 };
  const schema = { type: 'object', required: ['a'], properties: { a: { type: 'integer' } } };
  assert.deepEqual(await callLlmJson({ config, system: 's', user: 'u', schema }), { a: 1 });
  assert.deepEqual(models, ['old/model', 'new/model']);
});
