// 시·도 목록과 이름 정규화. 브라우저와 Node(수집 스크립트, 프록시)에서 함께 쓴다.

export const SIDO = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
];

// 긴 이름 → 짧은 이름. 긴 것부터 검사해야 '경상북도'가 '경상'에 먼저 걸리지 않는다.
const SIDO_ALIASES = [
  ['서울특별시', '서울'], ['부산광역시', '부산'], ['대구광역시', '대구'],
  ['인천광역시', '인천'], ['광주광역시', '광주'], ['대전광역시', '대전'],
  ['울산광역시', '울산'], ['세종특별자치시', '세종'], ['경기도', '경기'],
  ['강원특별자치도', '강원'], ['강원도', '강원'], ['충청북도', '충북'],
  ['충청남도', '충남'], ['전북특별자치도', '전북'], ['전라북도', '전북'],
  ['전라남도', '전남'], ['경상북도', '경북'], ['경상남도', '경남'],
  ['제주특별자치도', '제주'], ['제주도', '제주'],
];

// '수원시', '가평군', '강남구'처럼 시·군·구로 끝나는 첫 단어만 시·군·구로 인정한다.
// ('경기도교육청'의 '교육청' 같은 기관명 꼬리를 걸러 내기 위함)
function pickSigungu(rest) {
  const first = rest.trim().split(' ')[0] || '';
  return /^[가-힣]{1,6}[시군구]$/.test(first) ? first : '';
}

/** '경기도 수원시' → { sido: '경기', sigungu: '수원시' }. 시·도를 못 찾으면 null. */
export function parseRegion(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.trim().replace(/\s+/g, ' ');
  for (const [long, short] of SIDO_ALIASES) {
    if (t.startsWith(long)) return { sido: short, sigungu: pickSigungu(t.slice(long.length)) };
  }
  for (const short of SIDO) {
    if (t === short || t.startsWith(short + ' ')) {
      return { sido: short, sigungu: pickSigungu(t.slice(short.length)) };
    }
  }
  return null;
}

/** 문장 안에 나오는 시·도를 모두 찾는다. 예) '서울 또는 경기도 거주자' → ['서울', '경기'] */
export function findSidos(text) {
  if (!text) return [];
  const found = new Set();
  // 통합 광역단체 (예: '전남광주통합특별시') → 구성 시·도 모두
  for (const m of text.matchAll(/([가-힣]{2})([가-힣]{2})통합특별(?:시|자치도)/g)) {
    for (const part of [m[1], m[2]]) if (SIDO.includes(part)) found.add(part);
  }
  for (const [long, short] of SIDO_ALIASES) if (text.includes(long)) found.add(short);
  for (const short of SIDO) {
    // '경기'가 '경기도'의 일부로 이미 잡혔거나, '전남대' 같은 단어 일부인 경우를 줄이기 위해 뒤 글자를 본다
    const re = new RegExp(`${short}(?=$|[\\s,·/()도시]|지역|거주)`);
    if (re.test(text)) found.add(short);
  }
  return SIDO.filter((s) => found.has(s));
}

// 시·도별 시·군·구 (2026년 기준. 행정구역이 바뀌면 여기만 고친다)
// 인천은 2026-07 개편(제물포구·영종구·검단구)과 이전 이름(중구·동구)을 함께 둔다.
export const SIGUNGU = {
  서울: '종로구 중구 용산구 성동구 광진구 동대문구 중랑구 성북구 강북구 도봉구 노원구 은평구 서대문구 마포구 양천구 강서구 구로구 금천구 영등포구 동작구 관악구 서초구 강남구 송파구 강동구',
  부산: '중구 서구 동구 영도구 부산진구 동래구 남구 북구 해운대구 사하구 금정구 강서구 연제구 수영구 사상구 기장군',
  대구: '중구 동구 서구 남구 북구 수성구 달서구 달성군 군위군',
  인천: '제물포구 영종구 검단구 중구 동구 미추홀구 연수구 남동구 부평구 계양구 서구 강화군 옹진군',
  광주: '동구 서구 남구 북구 광산구',
  대전: '동구 중구 서구 유성구 대덕구',
  울산: '중구 남구 동구 북구 울주군',
  세종: '',
  경기: '수원시 성남시 의정부시 안양시 부천시 광명시 평택시 동두천시 안산시 고양시 과천시 구리시 남양주시 오산시 시흥시 군포시 의왕시 하남시 용인시 파주시 이천시 안성시 김포시 화성시 광주시 양주시 포천시 여주시 연천군 가평군 양평군',
  강원: '춘천시 원주시 강릉시 동해시 태백시 속초시 삼척시 홍천군 횡성군 영월군 평창군 정선군 철원군 화천군 양구군 인제군 고성군 양양군',
  충북: '청주시 충주시 제천시 보은군 옥천군 영동군 증평군 진천군 괴산군 음성군 단양군',
  충남: '천안시 공주시 보령시 아산시 서산시 논산시 계룡시 당진시 금산군 부여군 서천군 청양군 홍성군 예산군 태안군',
  전북: '전주시 군산시 익산시 정읍시 남원시 김제시 완주군 진안군 무주군 장수군 임실군 순창군 고창군 부안군',
  전남: '목포시 여수시 순천시 나주시 광양시 담양군 곡성군 구례군 고흥군 보성군 화순군 장흥군 강진군 해남군 영암군 무안군 함평군 영광군 장성군 완도군 진도군 신안군',
  경북: '포항시 경주시 김천시 안동시 구미시 영주시 영천시 상주시 문경시 경산시 의성군 청송군 영양군 영덕군 청도군 고령군 성주군 칠곡군 예천군 봉화군 울진군 울릉군',
  경남: '창원시 진주시 통영시 사천시 김해시 밀양시 거제시 양산시 의령군 함안군 창녕군 고성군 남해군 하동군 산청군 함양군 거창군 합천군',
  제주: '제주시 서귀포시',
};
for (const k of Object.keys(SIGUNGU)) SIGUNGU[k] = SIGUNGU[k] ? SIGUNGU[k].split(' ') : [];

// 시·군·구 이름 → 그 이름을 가진 시·도 목록. '중구'처럼 여러 곳에 있는 이름은 시·도 단서가 있을 때만 쓴다.
const SIGUN_INDEX = new Map();
for (const [sido, list] of Object.entries(SIGUNGU)) {
  for (const name of list) SIGUN_INDEX.set(name, [...(SIGUN_INDEX.get(name) || []), sido]);
}

// '횡성' 같은 접미사 없는 이름. 기관명 앞부분 비교용 ('횡성인재육성장학회' → 횡성군)
// 시·도 이름과 같은 '광주'(경기 광주시)·'제주'·'고성'(강원·경남)처럼 헷갈리는 이름은 뺀다.
const BARE_INDEX = new Map();
for (const [name, sidos] of SIGUN_INDEX) {
  const bare = name.slice(0, -1);
  if (bare.length >= 2 && sidos.length === 1 && !SIDO.includes(bare)) BARE_INDEX.set(bare, `${sidos[0]} ${name}`);
}

// 이름 앞이 한글이면 다른 단어의 일부로 본다 ('남양주시'의 '양주시'). 단 '경기도수원시'처럼 도·시 뒤는 허용.
const reCache = new Map();
function hasName(text, name) {
  if (!reCache.has(name)) reCache.set(name, new RegExp(`(?:(?<![가-힣])|(?<=[도시]))${name}`));
  return reCache.get(name).test(text);
}

const stripAgency = (s) => String(s || '').replace(/\(재\)|\(사\)|재단법인|사단법인|\s/g, '');

/**
 * 거주 요건 문장(과 운영기관명)에서 지역을 찾는다. 시·군·구까지 알면 '강원 횡성군', 시·도만 알면 '경기'.
 * 예) '3년 이상 계속해서 횡성군에 주소' → ['강원 횡성군']
 *     agency='인제군장학회', text='관내에 주소를 두고' → ['강원 인제군']
 * @param {string} text   거주 요건 원문
 * @param {string} [agency] 운영기관명 (시·군 출자출연기관이면 지역 단서가 됨)
 */
export function findRegions(text, agency = '') {
  const t = String(text || '');
  const found = new Set();
  const sidos = findSidos(t);
  const agencySidos = findSidos(agency);

  // 1) 시·도가 나온 경우: 그 시·도의 시·군·구 이름(구 포함)을 찾는다
  for (const sido of sidos) {
    for (const name of SIGUNGU[sido]) if (hasName(t, name)) found.add(`${sido} ${name}`);
  }
  // 2) 시·도 없이 시·군 이름만 나온 경우: 이름이 하나의 시·도에만 있으면 확정, 여러 곳이면 기관명으로 구분
  for (const [name, owners] of SIGUN_INDEX) {
    if (!hasName(t, name) || owners.some((s) => found.has(`${s} ${name}`))) continue;
    const owner = owners.length === 1 ? owners[0] : owners.find((s) => agencySidos.includes(s) || sidos.includes(s));
    if (owner) found.add(`${owner} ${name}`);
  }
  // 3) 문장에 없으면 기관명에서: 시·군 전체 이름 → 앞부분 맨 이름 순
  if (found.size === 0 && agency) {
    const a = stripAgency(agency);
    for (const [name, owners] of SIGUN_INDEX) {
      if (!hasName(a, name)) continue;
      const owner = owners.length === 1 ? owners[0] : owners.find((s) => agencySidos.includes(s));
      if (owner) found.add(`${owner} ${name}`);
    }
    if (found.size === 0) {
      for (const [bare, region] of BARE_INDEX) if (a.startsWith(bare)) found.add(region);
    }
  }
  // 시·군·구를 찾지 못한 시·도는 시·도 단위로 남긴다.
  // 통합특별시(예: 전남광주)는 구성 시·도 중 한 곳에서라도 시·군·구를 찾았으면 나머지를 넣지 않는다.
  const groups = [...t.matchAll(/([가-힣]{2})([가-힣]{2})통합특별(?:시|자치도)/g)].map((m) => [m[1], m[2]]);
  const hasDetail = (sido) => [...found].some((r) => r.startsWith(`${sido} `));
  for (const sido of sidos) {
    const group = groups.find((g) => g.includes(sido)) || [sido];
    if (!group.some(hasDetail)) found.add(sido);
  }
  return [...found];
}

/**
 * 기관명만으로 지역을 찾는다 (지자체 출자·출연기관 등).
 * 예) '화성시인재육성재단' → ['경기 화성시'], '(재)인천인재평생교육진흥원' → ['인천'],
 *     '전남광주통합특별시 함평군' → ['전남 함평군'], '재단법인은평구민장학재단' → ['서울 은평구']
 */
export function regionsFromAgencyName(agency) {
  const name = String(agency || '').trim();
  if (!name) return [];
  const p = parseRegion(name);
  if (p) return [p.sigungu ? `${p.sido} ${p.sigungu}` : p.sido];
  const found = findRegions(name, name);
  if (found.length) return found;
  const a = stripAgency(name);
  for (const [long, short] of SIDO_ALIASES) if (a.startsWith(long)) return [short];
  for (const short of SIDO) if (a.startsWith(short)) return [short];
  return [];
}

/** 지역 문자열을 '경기' 또는 '경기 수원시' 형태로 정규화. 인식 불가면 null. */
export function normalizeRegion(text) {
  const r = parseRegion(text);
  if (!r) return null;
  return r.sigungu ? `${r.sido} ${r.sigungu}` : r.sido;
}
