// 한국장학재단 파일데이터 2종 정규화 (D-2)
//  1) 학자금 지원정보(대학생)            https://www.data.go.kr/data/15028252/fileData.do
//  2) 소득연계형 국가장학금 및 학자금대출 정보  https://www.data.go.kr/data/15159544/fileData.do
//
// 파일마다 열 이름이 버전에 따라 조금씩 달라서, 별칭 목록(ALIASES)으로 찾는다.
// 내려받은 파일의 실제 헤더를 보고 별칭을 추가하면 된다.

import { cleanText, parseDate, parsePeriod, emptyConditions, hash } from './normalize.js';
import { findRegions } from '../../js/regions.js';


const ALIASES = {
  name: ['상품명', '장학금명', '장학명', '사업명', '지원유형', '유형', '구분'],
  agency: ['운영기관명', '기관명', '운영기관'],
  amount: ['지원내역 상세내용', '지원금액 상세내용', '지원금액', '지원한도', '대출한도', '금액'],
  start: ['모집시작일', '신청시작일', '접수시작일'],
  end: ['모집종료일', '신청종료일', '접수종료일'],
  url: ['홈페이지 주소', '홈페이지주소', '홈페이지', 'URL'],
  target: ['운영기관구분', '상품구분', '학자금유형구분', '대학구분', '학년구분', '학과구분'],
  region: ['지역거주여부 상세내용', '지역거주여부'],
  gpa: ['성적기준 상세내용', '성적기준'],
  income: ['소득기준 상세내용', '소득기준'],
  method: ['선발방법 상세내용', '신청방법'],
};

function pick(row, keys) {
  for (const k of keys) if (row[k] != null && String(row[k]).trim() !== '') return cleanText(row[k]);
  return '';
}

const isNone = (s) => !s || /^(해당\s*없음|없음|-|무관|제한\s*없음)$/.test(s.trim());

/** '직전학기 평점 3.0 이상' → 3.0 (4.5 만점 표기만 인정, 100점 만점이면 null) */
export function parseMinGpa(text) {
  if (!text || /100\s*점/.test(text)) return null;
  // 첫 번째 'N.NN 이상'을 쓴다. '(4.3만점은 2.6이상)' 같은 보조 표기는 무시한다.
  // 앞에 숫자가 붙은 경우('80.0이상')는 평점이 아니므로 제외한다. '4.00/4.50 이상', 'B학점(3.0) 이상'도 처리.
  const m = text.match(/(?<![\d.])([0-4]\.\d{1,2})\s*(?:점)?\s*(\/\s*4\.\d{1,2})?\s*\)?\s*이상/);
  if (!m) return null;
  const v = Number(m[1]);
  if (v <= 0) return null;
  return m[2] && /4\.3/.test(m[2]) ? Math.round((v * 4.5 / 4.3) * 100) / 100 : v;
}

/** '기준 중위소득 100% 이하' → 100 */
export function parseMaxMedianPct(text) {
  const m = String(text || '').match(/중위\s*소득\s*(\d{2,3})\s*%\s*(?:이하|이내)/);
  return m ? Number(m[1]) : null;
}

/** '학자금 지원구간 8구간 이하' → 8 */
export function parseMaxBand(text) {
  if (!text) return null;
  const m = text.match(/(?:학자금\s*지원\s*)?(\d{1,2})\s*구간\s*(?:이하|이내|까지)/);
  if (!m) return null;
  const v = Number(m[1]);
  return v >= 0 && v <= 10 ? v : null;
}

/** 한국장학재단 학자금 지원정보(대학생) 행 → 공통 스키마 */
export function scholarshipToBenefit(row, collectedAt) {
  const name = pick(row, ALIASES.name);
  const agency = pick(row, ALIASES.agency);
  const startRaw = pick(row, ALIASES.start);
  const endRaw = pick(row, ALIASES.end);
  const amountKey = ALIASES.amount.find((k) => row[k]);

  // '…상세내용' 열을 모두 선정 기준 원문으로 묶는다 (지원 금액 열은 제외)
  const criteria = Object.entries(row)
    .filter(([k, v]) => /상세내용/.test(k) && k !== amountKey && !isNone(cleanText(v)))
    .map(([k, v]) => `[${k.replace(/\s*상세내용/, '')}] ${cleanText(v)}`)
    .join('\n');
  const target = ALIASES.target
    .filter((k) => row[k] && !isNone(row[k]))
    .map((k) => `[${k}] ${cleanText(row[k])}`)
    .join('\n');

  const c = emptyConditions();
  const regionText = pick(row, ALIASES.region);
  // 거주 요건이 있을 때만 지역을 찾는다. '관내' 같은 표현은 운영기관명(예: 인제군장학회)으로 지역을 정한다.
  if (!isNone(regionText)) c.regions = findRegions(regionText, agency);
  c.min_gpa = parseMinGpa(pick(row, ALIASES.gpa));
  const incomeText = pick(row, ALIASES.income);
  if (!isNone(incomeText)) {
    c.income.text = incomeText.slice(0, 300);
    c.income.max_band = parseMaxBand(incomeText);
    c.income.max_median_pct = parseMaxMedianPct(incomeText);
  }

  const url = pick(row, ALIASES.url);
  return {
    id: `kosaf-${hash(`${agency}|${name}|${startRaw}`)}`,
    source: 'kosaf_scholarship',
    category: '교육·장학금',
    name: name || '(이름 없음)',
    agency,
    summary: [pick(row, ['상품구분']), pick(row, ['학자금유형구분'])].filter(Boolean).join(' · '),
    amount: amountKey ? cleanText(row[amountKey]) : '',
    target_text: target,
    criteria_text: criteria,
    conditions: c,
    apply_start: parseDate(startRaw),
    apply_end: parseDate(endRaw),
    always_open: false,
    apply_period_text: [startRaw, endRaw].filter(Boolean).join(' ~ '),
    apply_method: pick(row, ALIASES.method),
    url: /^https?:\/\//.test(url) ? url : (url ? `https://${url.replace(/^\/+/, '')}` : ''),
    collected_at: collectedAt,
  };
}

// 국가장학금·학자금대출 파일 열 (2026-08 배포본 기준)
// 기준연도 | 기준학기 | 구분 | 상품명 및 장학유형 | 지원대상 | 연령기준 | 성적기준 | 소득기준 |
// 장학금 지원금액(연간기준) | 대출금리 | 상환방법 | 신용요건 | 대출금액 | 대출기간 | 신청기간 | 대출실행기간 | 홈페이지
const NATIONAL_CRITERIA = ['연령기준', '성적기준', '소득기준', '신용요건', '대출금리', '상환방법', '대출기간', '대출실행기간'];

/** 국가장학금·학자금대출 정보 행 → 공통 스키마 */
export function nationalToBenefit(row, collectedAt) {
  const name = pick(row, ['상품명 및 장학유형', ...ALIASES.name]);
  const kind = pick(row, ['구분']);
  const year = pick(row, ['기준연도']);
  const term = pick(row, ['기준학기']);
  const scholarshipAmount = pick(row, ['장학금 지원금액(연간기준)']);
  const loanAmount = pick(row, ['대출금액']);
  const periodText = pick(row, ['신청기간', ...ALIASES.start]);
  const period = parsePeriod(periodText);
  const criteria = NATIONAL_CRITERIA
    .filter((k) => row[k] && !isNone(cleanText(row[k])) && !/^해당\s*사항\s*없음$/.test(cleanText(row[k])))
    .map((k) => `[${k}] ${cleanText(row[k])}`)
    .join('\n');

  // 소득·연령 조건은 학부/대학원, 등록금/생활비마다 달라 코드로 단정하지 않는다 → LLM 구조화와 '확인 필요'에 맡김
  const c = emptyConditions();
  const incomeText = pick(row, ['소득기준']);
  if (!isNone(incomeText)) c.income.text = incomeText.slice(0, 300);

  const url = pick(row, ['홈페이지', ...ALIASES.url]);
  return {
    id: `kosafn-${hash(`${year}|${term}|${kind}|${name}`)}`,
    source: 'kosaf_national',
    category: '교육·장학금',
    name: name || '(이름 없음)',
    agency: '한국장학재단',
    summary: [kind, year && term ? `${year}년 ${term}학기` : year].filter(Boolean).join(' · '),
    amount: !isNone(scholarshipAmount) && !/해당\s*사항\s*없음/.test(scholarshipAmount) ? scholarshipAmount : loanAmount,
    target_text: pick(row, ['지원대상']),
    criteria_text: criteria,
    conditions: c,
    apply_start: period.apply_start,
    apply_end: period.apply_end,
    always_open: period.always_open,
    apply_period_text: periodText,
    apply_method: '',
    url: /^https?:\/\//.test(url) ? url : '',
    collected_at: collectedAt,
  };
}
