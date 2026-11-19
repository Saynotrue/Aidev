import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, recommend, deadlineInfo, sortItems, isClosed } from '../js/filter.js';
import { emptyConditions } from '../scripts/lib/normalize.js';

const TODAY = '2026-11-12';
const minsu = { // PRD 대표 페르소나
  age: 22, sido: '경기', sigungu: '수원시', student_status: '재학', grade: 3, gpa: 3.5,
  income_band: 4, household: ['1인 가구', '월세 거주'], interests: [],
};
const mk = (over = {}, cond = {}) => ({
  id: over.id || 'x', name: '테스트', category: '생활', always_open: false, apply_start: null, apply_end: '2026-12-01',
  ...over, conditions: { ...emptyConditions(), ...cond },
});
const statusOf = (checks, key) => checks.find((c) => c.key === key)?.status;

test('마감된 지원금은 제외한다 (G4)', () => {
  const { items, excluded } = recommend(minsu, [mk({ apply_end: '2026-11-11' }), mk({ id: 'y', apply_end: TODAY })], TODAY);
  assert.equal(excluded, 1);
  assert.deepEqual(items.map((i) => i.benefit.id), ['y']);
});

test('마감일을 모르면 제외하지 않고 확인 필요로 둔다', () => {
  const checks = evaluate(minsu, mk({ apply_end: null }), TODAY);
  assert.equal(statusOf(checks, 'deadline'), 'check');
  assert.equal(isClosed(mk({ apply_end: null }), TODAY), false);
});

test('나이·지역·학적 불일치는 규칙 필터에서 제외한다 (R-1)', () => {
  const list = [
    mk({ id: 'age' }, { min_age: 65 }),
    mk({ id: 'region' }, { regions: ['서울'] }),
    mk({ id: 'status' }, { student_status: ['졸업'] }),
    mk({ id: 'ok' }, { min_age: 19, max_age: 34, regions: ['경기'], student_status: ['재학'] }),
  ];
  const { items, excluded } = recommend(minsu, list, TODAY);
  assert.equal(excluded, 3);
  assert.deepEqual(items.map((i) => i.benefit.id), ['ok']);
});

test('시·군·구 조건: 같은 시·도의 다른 시는 제외, 시·군·구 모르면 확인 필요', () => {
  assert.equal(statusOf(evaluate(minsu, mk({}, { regions: ['경기 성남시'] }), TODAY), 'region'), 'fail');
  assert.equal(statusOf(evaluate(minsu, mk({}, { regions: ['경기 수원시'] }), TODAY), 'region'), 'ok');
  assert.equal(statusOf(evaluate({ ...minsu, sigungu: '' }, mk({}, { regions: ['경기 수원시'] }), TODAY), 'region'), 'check');
});

test('"모름" 입력은 확인 필요로 처리한다 (U-4)', () => {
  const unknown = { ...minsu, age: null, student_status: '모름', income_band: null, gpa: null };
  const checks = evaluate(unknown, mk({}, {
    min_age: 19, max_age: 34, student_status: ['재학'], min_gpa: 3.0, income: { max_band: 8, max_median_pct: null, text: null },
  }), TODAY);
  for (const key of ['age', 'student_status', 'gpa', 'income']) assert.equal(statusOf(checks, key), 'check', key);
  assert.equal(recommend(unknown, [mk({}, { min_age: 19 })], TODAY).items.length, 1);
});

test('소득: 학자금 지원구간은 단정, 기준중위소득 %는 확인 필요', () => {
  assert.equal(statusOf(evaluate(minsu, mk({}, { income: { max_band: 8 } }), TODAY), 'income'), 'ok');
  assert.equal(statusOf(evaluate(minsu, mk({}, { income: { max_band: 3 } }), TODAY), 'income'), 'fail');
  assert.equal(statusOf(evaluate(minsu, mk({}, { income: { max_median_pct: 60 } }), TODAY), 'income'), 'check');
});

test('D-day와 마감 임박 순 정렬 (R-4)', () => {
  assert.equal(deadlineInfo(mk({ apply_end: TODAY }), TODAY).label, 'D-DAY');
  assert.equal(deadlineInfo(mk({ apply_end: '2026-11-15' }), TODAY).label, 'D-3');
  assert.equal(deadlineInfo(mk({ always_open: true, apply_end: null }), TODAY).label, '상시');
  assert.equal(deadlineInfo(mk({ apply_end: null }), TODAY).label, '기간 확인');
  const { items } = recommend(minsu, [
    mk({ id: 'unknown', apply_end: null }), mk({ id: 'always', always_open: true, apply_end: null }),
    mk({ id: 'late', apply_end: '2026-12-31' }), mk({ id: 'soon', apply_end: '2026-11-13' }),
  ], TODAY);
  assert.deepEqual(sortItems(items, 'deadline').map((i) => i.benefit.id), ['soon', 'late', 'always', 'unknown']);
});

test('적합도 순은 AI 점수를 우선한다 (R-5)', () => {
  const { items } = recommend(minsu, [mk({ id: 'a' }), mk({ id: 'b' })], TODAY);
  items[1].ai = { score: 90, reason: '' };
  assert.equal(sortItems(items, 'relevance')[0].benefit.id, 'b');
});

test('관심 분야를 고르면 그 분야만 남긴다 (U-3)', () => {
  const { items } = recommend({ ...minsu, interests: ['주거'] }, [mk({ id: 'a', category: '주거' }), mk({ id: 'b' })], TODAY);
  assert.deepEqual(items.map((i) => i.benefit.id), ['a']);
});
