import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePeriod, parseDate, categorize, cleanText } from '../scripts/lib/normalize.js';
import { parseCsv, decodeBuffer } from '../scripts/lib/csv.js';
import { parseMinGpa, parseMaxBand, parseMaxMedianPct, scholarshipToBenefit, nationalToBenefit } from '../scripts/lib/kosaf.js';
import { conditionsFromCodes, isYouthRelevant, toBenefit } from '../scripts/lib/gov24.js';
import { parseRegion, normalizeRegion, findSidos } from '../js/regions.js';

test('신청 기간 파싱', () => {
  assert.deepEqual(parsePeriod('상시신청'), { apply_start: null, apply_end: null, always_open: true });
  assert.deepEqual(parsePeriod('2026.11.01 ~ 2026.11.30'), { apply_start: '2026-11-01', apply_end: '2026-11-30', always_open: false });
  assert.deepEqual(parsePeriod('2026년 12월 5일까지'), { apply_start: null, apply_end: '2026-12-05', always_open: false });
  assert.deepEqual(parsePeriod('~ 2026-12-05'), { apply_start: null, apply_end: '2026-12-05', always_open: false });
  assert.deepEqual(parsePeriod('예산 소진 시까지'), { apply_start: null, apply_end: null, always_open: false });
  assert.equal(parseDate('20261130'), '2026-11-30');
  assert.equal(parseDate('2026-02-30'), null);
});

test('분야 분류: 이름 키워드가 서비스분야보다 우선', () => {
  assert.equal(categorize({ field: '생활안정', name: '청년 월세 한시 특별지원' }), '주거');
  assert.equal(categorize({ field: '보육·교육', name: '대학생 학자금 대출 이자 지원' }), '교육·장학금');
  assert.equal(categorize({ field: '고용·창업', name: '청년 일경험 프로그램' }), '취업');
  assert.equal(categorize({ field: '생활안정', name: '청년내일저축계좌' }), '금융');
  assert.equal(categorize({ field: '생활안정', name: '청년 교통비 지원' }), '생활');
  assert.equal(categorize({ field: '', name: '청년도약계좌' }), '금융');
});

test('지역 정규화', () => {
  assert.deepEqual(parseRegion('경기도 수원시'), { sido: '경기', sigungu: '수원시' });
  assert.deepEqual(parseRegion('경기도교육청'), { sido: '경기', sigungu: '' });
  assert.equal(normalizeRegion('전북특별자치도 전주시 완산구'), '전북 전주시');
  assert.equal(normalizeRegion('해외'), null);
  assert.deepEqual(findSidos('서울특별시 또는 경기도 거주자'), ['서울', '경기']);
});

test('CSV 파서: 따옴표, 셀 안 줄바꿈, EUC-KR', () => {
  const rows = parseCsv('이름,설명\r\n"A, B","첫 줄\n둘째 ""줄"""\r\nC,D\r\n');
  assert.deepEqual(rows, [{ 이름: 'A, B', 설명: '첫 줄\n둘째 "줄"' }, { 이름: 'C', 설명: 'D' }]);
  const euckr = Buffer.from([0xc7, 0xd1, 0xb1, 0xdb]); // '한글' (EUC-KR)
  assert.equal(decodeBuffer(euckr), '한글');
  assert.equal(decodeBuffer(Buffer.from('﻿한글', 'utf8')), '한글');
});

test('장학금 조건 휴리스틱', () => {
  assert.equal(parseMinGpa('직전학기 평점 3.0 이상'), 3);
  assert.equal(parseMinGpa('백분위 80점 이상 (100점 만점)'), null);
  assert.equal(parseMinGpa('평균 2.75 이상인 자 (4.3만점은 2.6이상)'), 2.75);
  assert.equal(parseMinGpa('학점 4.0/4.3 이상'), 4.19);
  assert.equal(parseMinGpa('평점평균 B학점(3.0) 이상 이거나 백분율 환산점수가 80.0이상'), 3);
  assert.equal(parseMaxMedianPct('기준 중위소득 100% 이하인 가구'), 100);
  assert.deepEqual(findSidos('전남광주통합특별시 남구에 주소'), ['광주', '전남']);
  assert.equal(parseMaxBand('학자금 지원구간 8구간 이하'), 8);
  const b = scholarshipToBenefit({
    운영기관명: '샘플재단', 상품명: '샘플장학금', '성적기준 상세내용': '직전학기 3.2 이상',
    '지역거주여부 상세내용': '경기도 거주자', '소득기준 상세내용': '해당없음', 모집시작일: '2026-11-01', 모집종료일: '2026-11-30',
    '지원내역 상세내용': '200만원', '홈페이지 주소': 'www.example.org',
  }, '2026-11-12');
  assert.equal(b.conditions.min_gpa, 3.2);
  assert.deepEqual(b.conditions.regions, ['경기']);
  assert.equal(b.conditions.income.text, null);
  assert.equal(b.amount, '200만원');
  assert.equal(b.url, 'https://www.example.org');
  assert.equal(b.apply_end, '2026-11-30');
  assert.ok(b.criteria_text.includes('[성적기준] 직전학기 3.2 이상'));
  assert.ok(!b.criteria_text.includes('200만원'));
});

test('정부24 지원조건 코드 → conditions', () => {
  const c = conditionsFromCodes({ JA0110: '19', JA0111: '34', JA0201: 'Y', JA0202: 'Y', JA0203: null, JA0204: null, JA0205: null, JA0404: 'Y' });
  assert.equal(c.min_age, 19);
  assert.equal(c.max_age, 34);
  assert.equal(c.income.max_median_pct, 75);
  assert.deepEqual(c.household, ['1인 가구']);
  assert.equal(isYouthRelevant({ 사용자구분: '개인' }, { JA0110: '65' }), false);
  assert.equal(isYouthRelevant({ 사용자구분: '법인/시설/단체' }, {}), false);
  assert.equal(isYouthRelevant({ 사용자구분: '개인' }, null), true);
});

test('정부24 행 → 공통 스키마', () => {
  const b = toBenefit(
    { 서비스ID: '123', 서비스명: '청년 월세 지원', 소관기관명: '경기도 수원시', 소관기관유형: '지자체', 서비스분야: '주거·자립', 신청기한: '2026.11.01~2026.11.30', 상세조회URL: 'https://www.gov.kr/x' },
    { 지원대상: '<p>만 19~34세</p>', 선정기준: '중위소득 60% 이하', 지원내용: '월 20만원', 신청방법: '온라인' },
    { JA0110: '19', JA0111: '34' },
    '2026-11-12',
  );
  assert.equal(b.id, 'gov24-123');
  assert.equal(b.category, '주거');
  assert.deepEqual(b.conditions.regions, ['경기 수원시']);
  assert.equal(b.target_text, '만 19~34세');
  assert.equal(b.apply_end, '2026-11-30');
  assert.equal(cleanText('a&nbsp;<b>b</b>'), 'a b');
});

test('국가장학금·학자금대출 파일 행 → 공통 스키마', () => {
  const b = nationalToBenefit({
    기준연도: '2026', 기준학기: '2', 구분: '학자금대출', '상품명 및 장학유형': '취업 후 상환 학자금대출',
    지원대상: '학부생', 소득기준: '학자금 지원 8구간 이내', '장학금 지원금액(연간기준)': '해당사항 없음',
    대출금액: '연 400만원', 신청기간: '2026-07-01~2026-11-17', 홈페이지: 'https://www.kosaf.go.kr',
  }, '2026-11-12');
  assert.equal(b.name, '취업 후 상환 학자금대출');
  assert.equal(b.amount, '연 400만원');
  assert.equal(b.apply_start, '2026-07-01');
  assert.equal(b.apply_end, '2026-11-17');
  assert.equal(b.conditions.income.max_band, null); // 등록금/생활비마다 달라 단정하지 않음
  assert.ok(b.criteria_text.includes('[소득기준] 학자금 지원 8구간 이내'));
});

test('거주 요건 → 시·군·구 (시·도 없는 문장, 기관명 단서, 겹치는 이름)', async () => {
  const { findRegions } = await import('../js/regions.js');
  assert.deepEqual(findRegions('3년이상 계속해서 횡성군에 주소', '횡성인재육성장학회'), ['강원 횡성군']);
  assert.deepEqual(findRegions('관내에 주소를 두고 1년 이상 거주', '(재)인제군장학회'), ['강원 인제군']);
  assert.deepEqual(findRegions('6개월 이상 고성군 관내에 주민등록', '경상남도 고성군청'), ['경남 고성군']);
  assert.deepEqual(findRegions('남양주시 거주자'), ['경기 남양주시']);
  assert.deepEqual(findRegions('전남광주통합특별시 남구에 주소', '광주남구장학회'), ['광주 남구']);
  assert.deepEqual(findRegions('도내 대학 소속 학부생', '경상남도장학회'), []);
  assert.deepEqual(findRegions('경기도에 계속 거주', '경기도청'), ['경기']);
});

test('중복 제거: 같은 기관·이름이면 원문이 자세한 쪽', async () => {
  const { dedupe } = await import('../scripts/lib/normalize.js');
  const a = { id: 'a', agency: '(재)한국장학재단', name: '취업 후 상환 학자금대출', target_text: '', criteria_text: '짧음' };
  const b = { id: 'b', agency: '한국장학재단', name: '취업 후 상환 학자금대출', target_text: '학부생', criteria_text: '[소득기준] 자세한 원문' };
  assert.deepEqual(dedupe([a, b]).map((x) => x.id), ['b']);
});

test('정부24 대상 그룹 코드: 전부 Y는 제한 없음, 일부만 Y는 그 그룹 전용', async () => {
  const { conditionsFromCodes, isYouthRelevant, regionFromAgency, PERSON_GROUPS, HOUSEHOLD_GROUPS } = await import('../scripts/lib/gov24.js');
  const allY = Object.fromEntries([...Object.keys(PERSON_GROUPS), ...Object.keys(HOUSEHOLD_GROUPS)].map((k) => [k, 'Y']));
  const open = conditionsFromCodes(allY);
  assert.deepEqual(open.student_status, []); // 전부 Y인데 '대학생 전용'으로 읽으면 안 됨
  assert.deepEqual(open.household, []);
  assert.deepEqual(open.target_groups, []);
  assert.deepEqual(conditionsFromCodes({ JA0320: 'Y' }).student_status, ['재학', '휴학']);
  assert.deepEqual(conditionsFromCodes({ JA0320: 'Y', JA0327: 'Y' }).target_groups, ['대학생·대학원생', '구직자·실업자']);
  assert.deepEqual(conditionsFromCodes({ JA0404: 'Y' }).household, ['1인 가구']);
  assert.equal(isYouthRelevant({ 사용자구분: '개인' }, { JA0313: 'Y' }), false); // 농업인 전용
  assert.equal(isYouthRelevant({ 사용자구분: '개인' }, { JA0317: 'Y', JA0318: 'Y', JA0319: 'Y' }), false); // 초중고 전용
  assert.equal(isYouthRelevant({ 사용자구분: '개인' }, allY), true);
  assert.deepEqual(regionFromAgency({ 소관기관유형: '시군구', 소관기관명: '충청남도 예산군' }), ['충남 예산군']);
  assert.deepEqual(regionFromAgency({ 소관기관유형: '지방출자_출연기관', 소관기관명: '화성시인재육성재단' }), ['경기 화성시']);
  assert.deepEqual(regionFromAgency({ 소관기관유형: '지방출자_출연기관', 소관기관명: '(재)인천인재평생교육진흥원' }), ['인천']);
  assert.deepEqual(regionFromAgency({ 소관기관유형: '지방출자_출연기관', 소관기관명: '재단법인은평구민장학재단' }), ['서울 은평구']);
  assert.deepEqual(regionFromAgency({ 소관기관유형: '시군구', 소관기관명: '전남광주통합특별시 함평군' }), ['전남 함평군']);
  assert.deepEqual(regionFromAgency({ 소관기관유형: '광역시도', 소관기관명: '경기도' }), ['경기']);
  assert.deepEqual(regionFromAgency({ 소관기관유형: '교육청', 소관기관명: '서울특별시교육청' }), ['서울']);
  assert.equal(regionFromAgency({ 소관기관유형: '중앙행정기관', 소관기관명: '문화체육관광부' }), null);
});

test('대상 그룹 판단: 대학생 또는 구직자', async () => {
  const { evaluate } = await import('../js/filter.js');
  const b = { always_open: true, conditions: { target_groups: ['대학생·대학원생', '구직자·실업자'] } };
  assert.equal(evaluate({ student_status: '재학', household: [] }, b, '2026-11-13').find((c) => c.key === 'target').status, 'ok');
  assert.equal(evaluate({ student_status: '졸업', household: [] }, b, '2026-11-13').find((c) => c.key === 'target').status, 'check');
  const special = { always_open: true, conditions: { target_groups: ['장애인'] } };
  assert.equal(evaluate({ student_status: '재학', household: [] }, special, '2026-11-13').find((c) => c.key === 'target').status, 'check');
});
