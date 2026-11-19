// 행정안전부 대한민국 공공서비스(혜택) 정보 API 수집 (D-1)
//
// ⚠️ 엔드포인트 주소, 응답 필드명, 지원조건 코드는 활용신청 후 공식 명세서로 반드시 확인한다 (PRD 6.1).
//    아래 값은 공개된 명세(api.odcloud.kr/api/gov24/v3) 기준이며, 바뀌었으면 FIELD / COND 상수만 고치면 된다.

import { cleanText, parsePeriod, categorize, emptyConditions } from './normalize.js';
import { regionsFromAgencyName } from '../../js/regions.js';

const BASE = 'https://api.odcloud.kr/api/gov24/v3';
const PER_PAGE = 500;

// 응답 필드명 (한글 키)
export const FIELD = {
  id: '서비스ID',
  name: '서비스명',
  purpose: '서비스목적요약',
  purposeDetail: '서비스목적',
  target: '지원대상',
  criteria: '선정기준',
  content: '지원내용',
  method: '신청방법',
  period: '신청기한',
  url: '상세조회URL',
  onlineUrl: '온라인신청사이트URL',
  agency: '소관기관명',
  agencyType: '소관기관유형',
  field: '서비스분야',
  userType: '사용자구분',
};

// supportConditions 코드. 값이 'Y'인 항목이 '지원 대상이 될 수 있는' 사람이다.
// 실제 데이터(2026-11, 10,942건) 확인 결과: 누구나 대상인 서비스는 해당 그룹 코드가 전부 Y이거나 '해당사항 없음'이 Y다.
// 일부만 Y이면 그 사람들만 대상이다 (예: JA0313만 Y → 농업인 전용).
export const COND = {
  ageFrom: 'JA0110',
  ageTo: 'JA0111',
  income: { JA0201: 50, JA0202: 75, JA0203: 100, JA0204: 200, JA0205: null }, // 기준중위소득 구간 상한(%)
};

// 개인 특성 (JA03xx). JA0322 = 해당사항 없음(특별한 특성이 없는 일반인)
export const PERSON_GROUPS = {
  JA0301: '예비부부·난임', JA0302: '임산부', JA0303: '출산·입양',
  JA0313: '농업인', JA0314: '어업인', JA0315: '축산업인', JA0316: '임업인',
  JA0317: '초등학생', JA0318: '중학생', JA0319: '고등학생', JA0320: '대학생·대학원생',
  JA0322: '해당사항 없음', JA0326: '근로자·직장인', JA0327: '구직자·실업자',
  JA0328: '장애인', JA0329: '국가보훈대상자', JA0330: '질병·질환자',
};
// 가구 특성 (JA04xx). JA0410 = 해당사항 없음
export const HOUSEHOLD_GROUPS = {
  JA0401: '다문화가족', JA0402: '북한이탈주민', JA0403: '한부모·조손가정', JA0404: '1인 가구',
  JA0410: '해당사항 없음', JA0411: '다자녀가구', JA0412: '무주택세대', JA0413: '신규전입', JA0414: '확대가족',
};
// 대학생·청년이 대상이 될 수 없는 특성만 있으면 수집 단계에서 제외한다
const NOT_FOR_YOUTH = new Set(['JA0313', 'JA0314', 'JA0315', 'JA0316', 'JA0317', 'JA0318', 'JA0319']);
// 화면의 '가구·상황' 선택지와 바로 대응되는 코드
const HOUSEHOLD_OPTION_OF = { JA0404: '1인 가구', JA0412: '무주택', JA0327: '구직 중' };

const YOUTH_MIN = 19;
const YOUTH_MAX = 34;

async function fetchPage(endpoint, page, serviceKey) {
  const url = new URL(`${BASE}/${endpoint}`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('perPage', String(PER_PAGE));
  url.searchParams.set('returnType', 'JSON');
  url.searchParams.set('serviceKey', serviceKey);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === 2) throw new Error(`${endpoint} ${page}페이지 요청 실패: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return null;
}

/** 한 엔드포인트의 전체 페이지를 받는다 */
export async function fetchAll(endpoint, serviceKey, { maxPages = Infinity, log = console.log } = {}) {
  const first = await fetchPage(endpoint, 1, serviceKey);
  const total = first.totalCount ?? first.matchCount ?? first.data?.length ?? 0;
  const pages = Math.min(Math.ceil(total / PER_PAGE) || 1, maxPages);
  const rows = [...(first.data || [])];
  for (let p = 2; p <= pages; p += 1) {
    const r = await fetchPage(endpoint, p, serviceKey);
    rows.push(...(r.data || []));
  }
  log(`  ${endpoint}: ${rows.length}/${total}건`);
  return rows;
}

const isY = (v) => v === 'Y' || v === 'y' || v === true;

/**
 * 그룹 코드 중 Y인 것. 누구나 대상(전부 Y, '해당사항 없음' Y, 전부 비어 있음)이면 null.
 * @returns {string[] | null}
 */
export function restrictedCodes(cond, groups, noneCode) {
  if (!cond) return null;
  const codes = Object.keys(groups);
  const yes = codes.filter((k) => isY(cond[k]));
  if (yes.length === 0 || yes.length === codes.length || yes.includes(noneCode)) return null;
  return yes;
}

/** 지원조건 코드 → 공통 스키마 conditions (코드로 확실히 알 수 있는 부분만) */
export function conditionsFromCodes(cond) {
  const c = emptyConditions();
  if (!cond) return c;
  const from = Number(cond[COND.ageFrom]);
  const to = Number(cond[COND.ageTo]);
  if (Number.isFinite(from) && from > 0) c.min_age = from;
  if (Number.isFinite(to) && to > 0 && to < 150) c.max_age = to;

  // 소득 구간 코드가 일부만 Y이면 그중 가장 높은 상한을 조건으로 본다. 전부 Y거나 전부 비면 소득 무관.
  const incomeCodes = Object.keys(COND.income);
  const yes = incomeCodes.filter((k) => isY(cond[k]));
  if (yes.length > 0 && yes.length < incomeCodes.length) {
    const caps = yes.map((k) => COND.income[k]);
    if (!caps.includes(null)) c.income.max_median_pct = Math.max(...caps);
  }

  // 개인·가구 특성: 일부 그룹만 대상일 때만 조건으로 기록한다
  const person = restrictedCodes(cond, PERSON_GROUPS, 'JA0322');
  const house = restrictedCodes(cond, HOUSEHOLD_GROUPS, 'JA0410');
  if (person) {
    if (person.length === 1 && person[0] === 'JA0320') c.student_status = ['재학', '휴학']; // 대학생 전용
    else if (person.length === 1 && person[0] === 'JA0327') c.household.push('구직 중'); // 구직자 전용
    else c.target_groups = person.map((k) => PERSON_GROUPS[k]); // 여러 그룹 중 하나 (예: 대학생 또는 구직자)
  }
  if (house) {
    // 가구 특성은 '이 중 하나에 해당'하는 의미라, 하나뿐일 때만 필수 조건으로 본다
    if (house.length === 1 && HOUSEHOLD_OPTION_OF[house[0]]) c.household.push(HOUSEHOLD_OPTION_OF[house[0]]);
    else c.household_groups = house.map((k) => HOUSEHOLD_GROUPS[k]);
  }
  return c;
}

/** 청년(19~34세)과 관련이 있는 서비스인지. 연령 정보가 없으면 남긴다. */
export function isYouthRelevant(row, cond) {
  if (row[FIELD.userType] && !/개인/.test(row[FIELD.userType])) return false; // 법인·소상공인 전용 제외
  const person = restrictedCodes(cond, PERSON_GROUPS, 'JA0322');
  if (person && person.every((k) => NOT_FOR_YOUTH.has(k))) return false; // 농어업인·초중고생 전용
  const { min_age: min, max_age: max } = conditionsFromCodes(cond);
  if (min != null && min > YOUTH_MAX) return false;
  if (max != null && max < YOUTH_MIN) return false;
  return true;
}

/**
 * 소관기관이 지방자치단체·교육청·지방 출자출연기관이면 그 지역 주민 대상으로 본다.
 * 실제 소관기관유형 값: 중앙행정기관, 공공기관, 시군구, 광역시도, 교육청, 지방출자_출연기관, 지방공기업
 */
export function regionFromAgency(row) {
  const type = row[FIELD.agencyType] || '';
  if (type && !/시군구|광역시도|교육청|지방|지자체|자치/.test(type)) return null;
  const regions = regionsFromAgencyName(row[FIELD.agency]);
  return regions.length ? regions : null;
}

/**
 * 목록·상세·지원조건 행을 합쳐 공통 스키마로 변환
 * @param {object} listRow  serviceList 행
 * @param {object} [detail] serviceDetail 행
 * @param {object} [cond]   supportConditions 행
 */
export function toBenefit(listRow, detail = {}, cond = null, collectedAt) {
  const get = (k) => cleanText(detail[k] ?? listRow[k] ?? '');
  const periodText = get(FIELD.period);
  const period = parsePeriod(periodText);
  const conditions = conditionsFromCodes(cond);
  const regions = regionFromAgency({ ...listRow, ...detail });
  if (regions) conditions.regions = regions;

  const name = get(FIELD.name);
  const content = get(FIELD.content);
  const url = get(FIELD.url) || get(FIELD.onlineUrl);
  return {
    id: `gov24-${listRow[FIELD.id]}`,
    source: 'gov24',
    category: categorize({ field: get(FIELD.field), name, text: `${get(FIELD.purpose)} ${content}` }),
    name,
    agency: get(FIELD.agency),
    summary: get(FIELD.purpose) || get(FIELD.purposeDetail),
    amount: content,
    target_text: get(FIELD.target),
    criteria_text: get(FIELD.criteria),
    conditions,
    apply_start: period.apply_start,
    apply_end: period.apply_end,
    always_open: period.always_open,
    apply_period_text: periodText,
    apply_method: get(FIELD.method),
    url: /^https?:\/\//.test(url) ? url : '',
    collected_at: collectedAt,
  };
}
