// 화면 확인용 샘플 데이터(data/benefits.sample.json) 생성.
// ⚠️ 실제 지원금이 아니다. 이름에 [샘플]을 붙이고 공식 링크를 비워 둔다.
// 날짜는 실행일 기준 상대값으로 만들어, 언제 실행해도 D-day가 의미 있게 나온다.
import { writeFile } from 'node:fs/promises';
import { emptyConditions } from './lib/normalize.js';
import { todayString } from '../js/filter.js';

const today = todayString();
const shift = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return todayString(d); };
const cond = (over) => ({ ...emptyConditions(), ...over, income: { ...emptyConditions().income, ...(over.income || {}) } });

const base = { source: 'sample', agency: '샘플기관', url: '', collected_at: today, always_open: false, apply_start: null };
const items = [
  { id: 'sample-001', category: '주거', name: '[샘플] 청년 월세 지원', summary: '무주택 청년의 월세 부담을 덜어 줍니다.', amount: '월 최대 20만 원, 최대 12개월',
    target_text: '만 19세~34세, 부모와 따로 거주하는 무주택 청년', criteria_text: '청년 가구 기준중위소득 60% 이하', apply_method: '온라인 신청',
    conditions: cond({ min_age: 19, max_age: 34, household: ['무주택', '월세 거주'], income: { max_median_pct: 60, text: '청년 가구 기준중위소득 60% 이하' } }),
    apply_end: shift(18), apply_period_text: `${today} ~ ${shift(18)}` },
  { id: 'sample-002', category: '교육·장학금', name: '[샘플] 경기 지역 대학생 장학금', summary: '경기도 거주 대학생 학비 지원', amount: '1인당 200만 원',
    target_text: '경기도에 1년 이상 거주한 대학 재학생', criteria_text: '[성적기준] 직전 학기 평점 3.0 이상\n[소득기준] 학자금 지원구간 8구간 이하', apply_method: '재단 홈페이지 신청',
    conditions: cond({ regions: ['경기'], student_status: ['재학'], min_gpa: 3.0, income: { max_band: 8, text: '학자금 지원구간 8구간 이하' } }),
    apply_end: shift(5), apply_period_text: `${today} ~ ${shift(5)}` },
  { id: 'sample-003', category: '교육·장학금', name: '[샘플] 서울 지역 성적우수 장학금', summary: '서울 거주 대학생 대상', amount: '등록금 50%',
    target_text: '서울특별시 거주 대학 재학생', criteria_text: '[성적기준] 직전 학기 평점 3.8 이상', apply_method: '학교 추천',
    conditions: cond({ regions: ['서울'], student_status: ['재학'], min_gpa: 3.8 }), apply_end: shift(30), apply_period_text: `~ ${shift(30)}` },
  { id: 'sample-004', category: '취업', name: '[샘플] 청년 구직활동 지원금', summary: '미취업 청년의 구직활동 비용 지원', amount: '월 50만 원, 6개월',
    target_text: '만 18세~34세 미취업 청년', criteria_text: '졸업 또는 중퇴 후 2년 이내, 기준중위소득 120% 이하', apply_method: '온라인 신청',
    conditions: cond({ min_age: 18, max_age: 34, student_status: ['졸업'], household: ['구직 중'], income: { max_median_pct: 120, text: '기준중위소득 120% 이하' } }),
    always_open: true, apply_end: null, apply_period_text: '상시 신청' },
  { id: 'sample-005', category: '금융', name: '[샘플] 청년 자산형성 통장', summary: '저축액에 정부 기여금을 더해 줍니다.', amount: '월 10만 원 저축 시 매칭 지원',
    target_text: '만 19~34세 청년', criteria_text: '가구 기준중위소득 180% 이하', apply_method: '은행 앱 신청',
    conditions: cond({ min_age: 19, max_age: 34, income: { max_median_pct: 180, text: '가구 기준중위소득 180% 이하' } }),
    apply_start: shift(3), apply_end: shift(40), apply_period_text: `${shift(3)} ~ ${shift(40)}` },
  { id: 'sample-006', category: '생활', name: '[샘플] 청년 대중교통비 환급', summary: '대중교통 이용 요금 일부 환급', amount: '이용 금액의 20~30%',
    target_text: '만 19~34세 청년', criteria_text: '월 15회 이상 대중교통 이용', apply_method: '카드사 앱',
    conditions: cond({ min_age: 19, max_age: 34 }), always_open: true, apply_end: null, apply_period_text: '상시' },
  { id: 'sample-007', category: '교육·장학금', name: '[샘플] 이미 마감된 장학금', summary: '마감 항목이 숨겨지는지 확인하는 샘플', amount: '100만 원',
    target_text: '대학 재학생', criteria_text: '', apply_method: '',
    conditions: cond({ student_status: ['재학'] }), apply_end: shift(-3), apply_period_text: `~ ${shift(-3)}` },
  { id: 'sample-008', category: '생활', name: '[샘플] 노년층 대상 서비스', summary: '나이 조건으로 제외되는지 확인하는 샘플', amount: '-',
    target_text: '만 65세 이상', criteria_text: '', apply_method: '',
    conditions: cond({ min_age: 65 }), always_open: true, apply_end: null, apply_period_text: '상시' },
].map((it) => ({ ...base, ...it }));

const out = { generated_at: today, count: items.length, sources: { sample: items.length }, sample: true, benefits: items };
await writeFile(new URL('../data/benefits.sample.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(`data/benefits.sample.json (${items.length}건)`);
