// 정규화 공통 함수: 신청 기간 파싱, 분야 분류, 텍스트 정리.

import { createHash } from 'node:crypto';

export const hash = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 16);

/** HTML 태그 제거, 공백 정리 (줄바꿈은 유지) */
export function cleanText(s) {
  if (s == null) return '';
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function ymd(y, m, d) {
  const yy = Number(y); const mm = Number(m); const dd = Number(d);
  if (yy < 2000 || yy > 2100 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const date = new Date(Date.UTC(yy, mm - 1, dd));
  if (date.getUTCMonth() !== mm - 1) return null; // 2월 30일 같은 값 거름
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** 단일 날짜 문자열 → 'YYYY-MM-DD' (인식 불가면 null) */
export function parseDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  let m = t.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
  if (m) return ymd(m[1], m[2], m[3]);
  m = t.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
  if (m) return ymd(m[1], m[2], m[3]);
  return null;
}

const DATE_RE = /(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?|\b(20\d{2})(\d{2})(\d{2})\b/g;

/**
 * 신청기한 원문 → { apply_start, apply_end, always_open }
 * 예) '상시신청' / '2026.11.01 ~ 2026.11.30' / '2026년 12월 5일까지' / '예산 소진 시까지'
 */
export function parsePeriod(text) {
  const t = String(text || '');
  const found = [];
  for (const m of t.matchAll(DATE_RE)) {
    const d = m[1] ? ymd(m[1], m[2], m[3]) : ymd(m[4], m[5], m[6]);
    if (d) found.push({ d, index: m.index, end: m.index + m[0].length });
  }
  if (found.length >= 2) {
    return { apply_start: found[0].d, apply_end: found[found.length - 1].d, always_open: false };
  }
  if (found.length === 1) {
    const { d, index, end } = found[0];
    const before = t.slice(0, index);
    const after = t.slice(end, end + 8);
    if (/까지|마감/.test(after) || /[~∼-]\s*$/.test(before)) return { apply_start: null, apply_end: d, always_open: false };
    if (/^\s*[~∼-]/.test(after) || /부터/.test(after)) return { apply_start: d, apply_end: null, always_open: /상시/.test(t) };
    return { apply_start: null, apply_end: null, always_open: false };
  }
  return { apply_start: null, apply_end: null, always_open: /상시/.test(t) };
}

// 분야 분류. 정부24 '서비스분야' 값을 먼저 보고, 키워드로 보정한다.
// 실제 분야 값 목록은 수집 결과를 보고 다시 맞춘다 (PRD 5장 참고).
const FIELD_MAP = [
  [/주거/, '주거'],
  [/고용|창업|일자리/, '취업'],
  [/교육|보육/, '교육·장학금'],
  [/금융|자산/, '금융'],
  [/생활|안정|복지|보건|의료|문화|돌봄|보호/, '생활'],
];
const KEYWORD_MAP = [
  [/장학|학자금|등록금|학비/, '교육·장학금'],
  [/월세|전세|임대|주거|주택|기숙사/, '주거'],
  [/자산형성|저축|적금|통장|도약계좌|희망적금|금융|신용/, '금융'],
  [/취업|구직|일자리|인턴|창업|채용|직업훈련|내일배움/, '취업'],
];

export function categorize({ field = '', name = '', text = '' }) {
  // 이름의 키워드가 가장 강한 신호 (예: '청년 월세 지원'은 분야가 '생활안정'이어도 주거)
  for (const [re, cat] of KEYWORD_MAP) if (re.test(name)) return cat;
  for (const [re, cat] of FIELD_MAP) if (re.test(field)) return cat;
  for (const [re, cat] of KEYWORD_MAP) if (re.test(text)) return cat;
  return '생활';
}

/** 빈 conditions 객체 (공통 스키마 7.6) */
export function emptyConditions() {
  return {
    min_age: null,
    max_age: null,
    regions: [],
    student_status: [],
    grades: [],
    min_gpa: null,
    income: { max_median_pct: null, max_band: null, text: null },
    household: [],
    majors: [], // 이 전공 계열 학생만 (비어 있으면 전공 무관). scripts/lib/majors.js
    univ_regions: [], // 재학 대학이 이 지역에 있어야 함 (scripts/lib/univ-conditions.js)
    univ_names: [], // 이 대학 재학생만
    region_logic: 'all', // 'all' = 거주·대학 조건 모두, 'any' = 둘 중 하나
    region_guardian: false, // 보호자 주소지·출신 고교로도 지역 조건 인정
    target_groups: [], // 이 중 하나에 해당해야 함 (예: 대학생·대학원생, 구직자·실업자)
    household_groups: [], // 이 중 하나에 해당하는 가구 (예: 1인 가구, 무주택세대)
  };
}

/** 같은 지원금이 여러 파일에 있으면(예: 학자금대출) 원문이 더 자세한 것 하나만 남긴다 */
export function dedupe(list) {
  const norm = (s) => String(s || '').replace(/\(재\)|재단법인|\s|·/g, '');
  const best = new Map();
  for (const b of list) {
    const key = `${norm(b.agency)}|${norm(b.name)}`;
    const size = (x) => (x.target_text + x.criteria_text).length;
    const prev = best.get(key);
    if (!prev || size(b) > size(prev)) best.set(key, b);
  }
  return [...best.values()];
}
