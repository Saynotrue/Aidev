// 규칙 필터(R-1), 조건별 충족 판단(E-2의 규칙 기반 버전), 후보 점수(R-2 1단계), D-day(R-4).
// DOM을 쓰지 않는 순수 함수만 둔다. 브라우저·Node(테스트, LLM 프록시)에서 함께 import한다.

import { matchRegionList } from './regions.js';

export const CATEGORIES = ['생활', '주거', '취업', '금융', '교육·장학금'];
export const STUDENT_STATUSES = ['재학', '휴학', '졸업', '해당 없음'];
export const HOUSEHOLD_OPTIONS = ['1인 가구', '월세 거주', '무주택', '구직 중', '다자녀'];
// 전공 계열. 이공계 = 자연과학·공학 (농림·수산 등 자연계 포함)
export const MAJOR_FIELDS = ['인문·사회', '이공계', '예체능', '의약·보건'];

export const STATUS = { OK: 'ok', CHECK: 'check', FAIL: 'fail' };
export const STATUS_LABEL = { ok: '충족', check: '확인 필요', fail: '미충족' }; // 아이콘은 화면(main.js)에서 붙인다

// R-1: 이 조건이 '미충족'이면 결과에서 제외한다. 나머지 조건은 표시만 한다.
export const HARD_FILTER_KEYS = ['deadline', 'age', 'region', 'university', 'student_status', 'major'];

// 학자금 지원구간 표시용 (0 = 기초·차상위). 값은 한국장학재단 공지 기준으로 확인할 것.
export const INCOME_BANDS = [
  { band: 0, label: '기초·차상위' },
  ...Array.from({ length: 10 }, (_, i) => ({ band: i + 1, label: `${i + 1}구간` })),
];

// ───────────────────────── 날짜 ─────────────────────────

/** 로컬 시간 기준 오늘 날짜 'YYYY-MM-DD' */
export function todayString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysBetween(fromYmd, toYmd) {
  const a = Date.UTC(...fromYmd.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))));
  const b = Date.UTC(...toYmd.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))));
  return Math.round((b - a) / 86400000);
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 마감 여부. 마감일을 모르면 false(제외하지 않음). */
export function isClosed(benefit, today) {
  if (benefit.always_open) return false;
  return YMD.test(benefit.apply_end || '') && benefit.apply_end < today;
}

/**
 * D-day 정보. sortKey가 작을수록 마감 임박.
 * 상시 모집은 마감일 있는 항목 뒤, 기간 미상은 맨 뒤.
 */
export function deadlineInfo(benefit, today) {
  if (benefit.always_open) return { label: '상시', days: null, sortKey: 100000, kind: 'always' };
  if (!YMD.test(benefit.apply_end || '')) return { label: '기간 확인', days: null, sortKey: 200000, kind: 'unknown' };
  const days = daysBetween(today, benefit.apply_end);
  if (days < 0) return { label: '마감', days, sortKey: 300000, kind: 'closed' };
  const upcoming = YMD.test(benefit.apply_start || '') && benefit.apply_start > today;
  const label = days === 0 ? 'D-DAY' : `D-${days}`;
  return { label: upcoming ? `${label} (접수 전)` : label, days, sortKey: days, kind: upcoming ? 'upcoming' : 'open' };
}

// ───────────────────────── 조건 판단 ─────────────────────────

const check = (key, label, status, reason) => ({ key, label, status, reason });

function checkDeadline(b, today) {
  if (b.always_open) return check('deadline', '신청 기간', STATUS.OK, '상시 모집입니다.');
  if (!YMD.test(b.apply_end || '')) return check('deadline', '신청 기간', STATUS.CHECK, '신청 기간 정보가 없어 공식 페이지에서 확인해야 합니다.');
  if (b.apply_end < today) return check('deadline', '신청 기간', STATUS.FAIL, `신청이 ${b.apply_end}에 마감되었습니다.`);
  if (YMD.test(b.apply_start || '') && b.apply_start > today) {
    return check('deadline', '신청 기간', STATUS.CHECK, `${b.apply_start}부터 신청할 수 있습니다.`);
  }
  return check('deadline', '신청 기간', STATUS.OK, `${b.apply_end}까지 신청할 수 있습니다.`);
}

function checkAge(p, c) {
  const { min_age: min, max_age: max } = c;
  if (min == null && max == null) return null;
  const range = `만 ${min ?? ''}~${max ?? ''}세`;
  if (p.age == null) return check('age', '나이', STATUS.CHECK, `나이 조건(${range})이 있지만 나이를 입력하지 않았습니다.`);
  if ((min != null && p.age < min) || (max != null && p.age > max)) {
    return check('age', '나이', STATUS.FAIL, `나이 조건(${range})에 해당하지 않습니다.`);
  }
  return check('age', '나이', STATUS.OK, `나이 조건(${range})에 해당합니다.`);
}

// ───── 지역 요건: 거주지 · 보호자 주소/출신 지역 · 재학 대학 소재지 ─────
// 지역 장학금은 '본인 또는 보호자 주소', '관내 대학 재학', '관내 고교 출신' 등을 조합한다.
//   c.regions          거주(주민등록) 지역 조건
//   c.region_guardian  true면 보호자 주소지·출신 지역(p.home_*)으로도 인정
//   c.univ_regions     재학 대학 소재지 조건 (예: ['경기 시흥시'])
//   c.univ_names       특정 대학 재학생만 (예: ['안산대학교', '신안산대학교'])
//   c.region_logic     'all' = 거주 조건과 대학 조건을 모두 충족 / 'any' = 둘 중 하나만 충족해도 됨

const RANK = { ok: 2, check: 1, fail: 0 };
const best = (...ss) => ss.filter(Boolean).sort((a, b) => RANK[b] - RANK[a])[0] || STATUS.CHECK;

/** 대학 이름 비교용: '서울대학교', '서울대', '고려대학교 세종캠퍼스' → '서울대', '고려대' */
export function normalizeUnivName(s) {
  return String(s || '')
    .replace(/\(.*?\)/g, '')
    .replace(/[가-힣]*캠퍼스/g, '')
    .replace(/\s|본교|분교/g, '')
    .replace(/대학교$/, '대')
    .replace(/대학$/, '대');
}

function residenceStatus(p, c) {
  const own = matchRegionList(c.regions, p.sido, p.sigungu);
  if (!c.region_guardian || !p.home_sido) return { status: own, via: '거주지' };
  const home = matchRegionList(c.regions, p.home_sido, p.home_sigungu);
  return RANK[home] > RANK[own] ? { status: home, via: '보호자 주소지·출신 지역' } : { status: own, via: '거주지' };
}

function univStatus(p, c) {
  const parts = [];
  if ((c.univ_names || []).length) {
    if (!p.univ_name) parts.push(STATUS.CHECK);
    else {
      const mine = normalizeUnivName(p.univ_name);
      parts.push(c.univ_names.some((n) => normalizeUnivName(n) === mine) ? STATUS.OK : STATUS.FAIL);
    }
  }
  if ((c.univ_regions || []).length) parts.push(matchRegionList(c.univ_regions, p.univ_sido, p.univ_sigungu));
  // 대학 이름 목록과 소재지 조건이 함께 있으면 보통 '관내 대학 = 이 학교들'이라 하나만 맞으면 된다
  return best(...parts);
}

function describeUniv(c) {
  const bits = [];
  if ((c.univ_regions || []).length) bits.push(`${c.univ_regions.join(', ')} 소재 대학`);
  if ((c.univ_names || []).length) bits.push(c.univ_names.join(', '));
  return bits.join(' 또는 ');
}

function checkRegion(p, c) {
  const hasRes = (c.regions || []).length > 0;
  const hasUni = (c.univ_regions || []).length > 0 || (c.univ_names || []).length > 0;
  if (!hasRes && !hasUni) return null; // 전국

  const resNames = (c.regions || []).join(', ');
  const who = c.region_guardian ? '본인 또는 보호자가' : '';
  const uniNames = describeUniv(c);
  const res = hasRes ? residenceStatus(p, c) : null;
  const uni = hasUni ? univStatus(p, c) : null;

  const resCheck = () => {
    const base = `${resNames}에 ${who ? `${who} ` : ''}거주하는 사람 대상입니다.`;
    const reason = {
      ok: `${base} 입력한 ${res.via}로 해당합니다.`,
      fail: c.region_guardian ? `${base} 거주지와 출신 지역 모두 해당하지 않습니다.` : base,
      check: !p.sido ? `${base} 거주 지역을 입력하지 않았습니다.` : `${base} 시·군·구를 확인하세요.`,
    }[res.status];
    return check('region', '거주 지역', res.status, reason);
  };
  const uniCheck = () => {
    const base = `${uniNames} 재학생 대상입니다.`;
    const reason = {
      ok: `${base} 입력한 대학이 해당합니다.`,
      fail: `${base} 입력한 대학(${p.univ_name || `${p.univ_sido} ${p.univ_sigungu}`.trim()})은 해당하지 않습니다.`,
      check: `${base} 재학 중인 대학을 입력하지 않았거나 소재지를 확인해야 합니다.`,
    }[uni];
    return check('university', '재학 대학', uni, reason);
  };

  if (hasRes && hasUni && c.region_logic === 'any') {
    const status = best(res.status, uni);
    const reason = `${resNames} 거주 또는 ${uniNames} 재학 중 하나에 해당하면 됩니다. `
      + (status === STATUS.OK ? (res.status === STATUS.OK ? `입력한 ${res.via}로 해당합니다.` : '재학 대학으로 해당합니다.')
        : status === STATUS.FAIL ? '거주지와 재학 대학 모두 해당하지 않습니다.' : '거주지나 재학 대학을 확인하세요.');
    return check('region', '지역 요건', status, reason);
  }
  return [hasRes ? resCheck() : null, hasUni ? uniCheck() : null];
}

function checkStudent(p, c) {
  const req = c.student_status || [];
  if (req.length === 0) return null;
  const names = req.join('/');
  if (!p.student_status || p.student_status === '모름') {
    return check('student_status', '학적 상태', STATUS.CHECK, `${names} 대상입니다. 학적 상태를 확인하세요.`);
  }
  return req.includes(p.student_status)
    ? check('student_status', '학적 상태', STATUS.OK, `${names} 대상이며 조건에 해당합니다.`)
    : check('student_status', '학적 상태', STATUS.FAIL, `${names} 대상입니다.`);
}

function checkGrade(p, c) {
  const req = c.grades || [];
  if (req.length === 0) return null;
  const names = req.map((g) => `${g}학년`).join(', ');
  if (p.grade == null) return check('grade', '학년', STATUS.CHECK, `${names} 대상입니다. 학년을 입력하지 않았습니다.`);
  return req.includes(p.grade)
    ? check('grade', '학년', STATUS.OK, `${names} 대상이며 조건에 해당합니다.`)
    : check('grade', '학년', STATUS.FAIL, `${names} 대상입니다.`);
}

function checkMajor(p, c) {
  const req = c.majors || [];
  if (req.length === 0) return null; // 전공 무관
  const names = req.join('·');
  if (!MAJOR_FIELDS.includes(p.major)) return check('major', '전공 계열', STATUS.CHECK, `${names} 계열 학생 대상입니다. 전공 계열을 입력하지 않았습니다.`);
  return req.includes(p.major)
    ? check('major', '전공 계열', STATUS.OK, `${names} 계열 학생 대상이며 조건에 해당합니다.`)
    : check('major', '전공 계열', STATUS.FAIL, `${names} 계열 학생 대상입니다.`);
}

function checkGpa(p, c) {
  if (c.min_gpa == null) return null;
  if (p.gpa == null) return check('gpa', '성적', STATUS.CHECK, `직전 학기 학점 ${c.min_gpa} 이상(4.5 만점 환산) 조건이 있습니다.`);
  return p.gpa >= c.min_gpa
    ? check('gpa', '성적', STATUS.OK, `학점 ${c.min_gpa} 이상 조건을 충족합니다.`)
    : check('gpa', '성적', STATUS.FAIL, `학점 ${c.min_gpa} 이상이 필요합니다.`);
}

function checkIncome(p, c) {
  const inc = c.income || {};
  const { max_band: maxBand, max_median_pct: maxPct, text } = inc;
  if (maxBand == null && maxPct == null) {
    return text ? check('income', '소득', STATUS.CHECK, `소득 조건이 있습니다: ${text}`) : null;
  }
  if (p.income_band == null) return check('income', '소득', STATUS.CHECK, '소득 조건이 있지만 소득구간을 \'모름\'으로 선택했습니다.');
  if (maxBand != null) {
    return p.income_band <= maxBand
      ? check('income', '소득', STATUS.OK, `학자금 지원구간 ${maxBand}구간 이하 조건을 충족합니다.`)
      : check('income', '소득', STATUS.FAIL, `학자금 지원구간 ${maxBand}구간 이하 대상입니다.`);
  }
  // 학자금 지원구간과 기준중위소득 %는 산정 방식이 달라 단정하지 않는다.
  return check('income', '소득', STATUS.CHECK, `기준중위소득 ${maxPct}% 이하 대상입니다. 학자금 지원구간과 산정 방식이 달라 확인이 필요합니다.`);
}

function checkHousehold(p, c) {
  const req = c.household || [];
  if (req.length === 0) return null;
  const mine = new Set(p.household || []);
  const missing = req.filter((h) => !mine.has(h));
  return missing.length === 0
    ? check('household', '가구·상황', STATUS.OK, `${req.join(', ')} 조건에 해당합니다.`)
    : check('household', '가구·상황', STATUS.CHECK, `${missing.join(', ')} 조건이 있습니다. 해당하는지 확인하세요.`);
}

// 개인 특성 그룹 중 하나에 해당해야 하는 경우 (정부24 지원조건 코드)
function checkTargets(p, c) {
  const groups = c.target_groups || [];
  if (groups.length === 0) return null;
  const names = groups.join(', ');
  const hh = new Set(p.household || []);
  const student = p.student_status === '재학' || p.student_status === '휴학';
  if ((groups.includes('대학생·대학원생') && student) || (groups.includes('구직자·실업자') && hh.has('구직 중'))) {
    return check('target', '지원 대상', STATUS.OK, `${names} 중 하나에 해당하면 됩니다. 입력한 조건으로 해당합니다.`);
  }
  return check('target', '지원 대상', STATUS.CHECK, `${names} 대상입니다. 해당하는지 확인하세요.`);
}

function checkHouseholdGroups(p, c) {
  const groups = c.household_groups || [];
  if (groups.length === 0) return null;
  const hh = new Set(p.household || []);
  const hit = (groups.includes('1인 가구') && hh.has('1인 가구')) || (groups.includes('무주택세대') && hh.has('무주택'))
    || (groups.includes('다자녀가구') && hh.has('다자녀'));
  return hit
    ? check('household_groups', '가구 특성', STATUS.OK, `${groups.join(', ')} 중 하나에 해당합니다.`)
    : check('household_groups', '가구 특성', STATUS.CHECK, `${groups.join(', ')} 중 하나에 해당해야 합니다.`);
}

/** 지원금 하나에 대한 조건별 판단 목록 */
export function evaluate(profile, benefit, today) {
  const c = benefit.conditions || {};
  return [
    checkDeadline(benefit, today),
    checkAge(profile, c),
    checkRegion(profile, c),
    checkStudent(profile, c),
    checkGrade(profile, c),
    checkMajor(profile, c),
    checkGpa(profile, c),
    checkIncome(profile, c),
    checkHousehold(profile, c),
    checkTargets(profile, c),
    checkHouseholdGroups(profile, c),
  ].flat().filter(Boolean);
}

// ───────────────────────── 점수 ─────────────────────────

function profileKeywords(p) {
  const kw = ['청년'];
  if (p.student_status === '재학' || p.student_status === '휴학') kw.push('대학', '장학', '학자금');
  if (p.student_status === '졸업') kw.push('취업', '구직');
  const hh = new Set(p.household || []);
  if (hh.has('월세 거주')) kw.push('월세', '주거');
  if (hh.has('1인 가구')) kw.push('1인');
  if (hh.has('무주택')) kw.push('무주택', '전세');
  if (hh.has('구직 중')) kw.push('구직', '취업', '일자리');
  const MAJOR_KW = { '인문·사회': ['인문', '사회과학'], 이공계: ['이공', '공학', '자연과학'], 예체능: ['예체능', '예술', '체육'], '의약·보건': ['의약', '간호', '보건'] };
  if (MAJOR_KW[p.major]) kw.push(...MAJOR_KW[p.major]);
  if (p.sido) kw.push(p.sido);
  if (p.sigungu) kw.push(p.sigungu);
  if (p.home_sigungu) kw.push(p.home_sigungu);
  if (p.univ_sigungu) kw.push(p.univ_sigungu);
  if (p.univ_name) kw.push(normalizeUnivName(p.univ_name));
  return [...new Set(kw)];
}

/** R-2 1단계: LLM에 보낼 후보를 고르기 위한 로컬 점수 */
export function localScore(profile, benefit, checks) {
  let score = 0;
  for (const c of checks) {
    if (c.key === 'deadline') continue;
    if (c.status === STATUS.OK) score += 3;
    // 장애인·다자녀 등 특정 대상 전용, 선택하지 않은 가구·상황 조건은 뒤로 (선택하지 않음 = 해당 없음)
    else if (c.status === STATUS.CHECK) score -= ['target', 'household_groups', 'household'].includes(c.key) ? 4 : 0.5;
    else score -= 4;
  }
  const text = [benefit.name, benefit.summary, benefit.target_text, benefit.criteria_text].join(' ');
  let hits = 0;
  for (const k of profileKeywords(profile)) if (text.includes(k)) hits += 1;
  score += Math.min(hits, 6);
  if ((profile.interests || []).includes(benefit.category)) score += 2;
  return score;
}

// 특정 대상 전용 조건 (장애인·다자녀 등). 사용자가 고르지 않았으면 해당하지 않는 것으로 본다.
const SPECIFIC_KEYS = ['target', 'household_groups', 'household'];
export const FIT_CAP_FAIL = 20; // 미충족 조건이 있을 때 적합도 상한
export const FIT_CAP_SPECIFIC = 35; // 해당하지 않는 특정 대상 전용 조건이 있을 때 상한

/**
 * AI 적합도의 상한: AI 점수가 화면의 ✅/⚠️/❌ 판정과 어긋나지 않도록 코드로 강제한다.
 * - 미충족(❌)이 하나라도 있으면 20
 * - 특정 대상 전용 조건(장애인·다자녀 등)에 해당한다고 고르지 않았으면 35
 */
export function fitCap(checks) {
  if (checks.some((c) => c.status === STATUS.FAIL)) return FIT_CAP_FAIL;
  if (checks.some((c) => SPECIFIC_KEYS.includes(c.key) && c.status === STATUS.CHECK)) return FIT_CAP_SPECIFIC;
  return 100;
}

// ───────────────────────── 추천 파이프라인 (브라우저 단계) ─────────────────────────

/**
 * 1단계 규칙 필터 + 점수 계산.
 * @returns {{ items: Array<{benefit, checks, score, deadline}>, excluded: number }}
 */
export function recommend(profile, benefits, today = todayString()) {
  const interests = profile.interests || [];
  const items = [];
  let excluded = 0;
  for (const benefit of benefits) {
    if (interests.length > 0 && !interests.includes(benefit.category)) continue;
    const checks = evaluate(profile, benefit, today);
    const hardFail = checks.some((c) => HARD_FILTER_KEYS.includes(c.key) && c.status === STATUS.FAIL);
    if (hardFail) { excluded += 1; continue; }
    items.push({ benefit, checks, score: localScore(profile, benefit, checks), deadline: deadlineInfo(benefit, today) });
  }
  return { items, excluded };
}

/** 점수 상위 n개 (LLM 재정렬 후보) */
export function topCandidates(items, n = 20) {
  return [...items].sort((a, b) => b.score - a.score).slice(0, n);
}

/**
 * 정렬. mode = 'deadline' | 'relevance'.
 * relevance는 AI 점수(0~100)가 있으면 그것을, 없으면 로컬 점수를 쓴다.
 */
export function sortItems(items, mode = 'deadline') {
  const arr = [...items];
  if (mode === 'relevance') {
    const key = (it) => (it.ai ? 1000 + it.ai.score : it.score);
    return arr.sort((a, b) => key(b) - key(a) || a.deadline.sortKey - b.deadline.sortKey);
  }
  return arr.sort((a, b) => a.deadline.sortKey - b.deadline.sortKey || b.score - a.score);
}
