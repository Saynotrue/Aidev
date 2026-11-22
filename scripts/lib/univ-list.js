// 대학 목록 → data/universities.json (화면의 '재학 중인 대학교' 자동완성과 소재지 자동 입력용)
//
// 원본: 공공데이터포털 '전국대학및전문대학정보표준데이터' (한국대학교육협의회)
//   https://www.data.go.kr/data/15107736/standard.do  → CSV로 내려받아 csv/ 폴더에 둔다.
//   열: 학교명, 학교 영문명, 본분교구분명, 대학구분명, 학교구분명, 설립형태구분명, 시도코드, 시도명,
//       소재지도로명주소, 소재지지번주소, …, 기준연도

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { decodeBuffer, parseCsv } from './csv.js';
import { parseRegion } from '../../js/regions.js';

const pick = (row, keys) => {
  for (const k of keys) if (row[k] && String(row[k]).trim()) return String(row[k]).trim();
  return '';
};

/** csv/ 또는 data/raw/에서 대학 목록 CSV를 찾는다 (헤더에 학교명과 주소 열이 있는 파일) */
export async function findUniversityCsv(root) {
  for (const dir of ['csv', 'data/raw']) {
    const abs = path.join(root, dir);
    if (!existsSync(abs)) continue;
    const files = (await readdir(abs)).filter((f) => f.toLowerCase().endsWith('.csv')).sort().reverse();
    for (const f of files) {
      const name = f.normalize('NFC');
      if (/학자금|국가장학금/.test(name)) continue;
      const head = decodeBuffer(await readFile(path.join(abs, f))).slice(0, 500);
      if (/학교명/.test(head) && /(소재지도로명주소|소재지지번주소|시도명)/.test(head)) return path.join(dir, f);
    }
  }
  return null;
}

/** CSV 행 → { name, label, type, sido, sigungu }. 분교·캠퍼스는 소재지로 구분한다. */
export function toUniversities(rows) {
  // '한양대학교 공학대학원'처럼 본교에 딸린 대학원은 뺀다 (대학원생도 학교 이름으로 고르면 된다).
  // '칼빈신학대학원'처럼 대학원만 있는 학교는 남긴다.
  const isGrad = (r) => pick(r, ['대학구분명']) === '대학원';
  const strip = (n) => n.replace(/\([^)]*\)/g, '').trim(); // '가야대학교(김해)' → '가야대학교'
  const bases = new Set(rows.filter((r) => !isGrad(r)).map((r) => strip(pick(r, ['학교명', '대학명']))));
  const list = [];
  for (const r of rows) {
    const name = pick(r, ['학교명', '대학명']);
    if (!name) continue;
    if (isGrad(r) && name.includes(' ') && bases.has(strip(name.split(' ')[0]))) continue;
    const addr = pick(r, ['소재지도로명주소', '소재지지번주소', '주소']);
    const region = parseRegion(addr) || parseRegion(pick(r, ['시도명']));
    if (!region) continue;
    const status = pick(r, ['학교상태명', '학교상태']);
    if (/폐교|폐지/.test(status)) continue;
    list.push({
      name,
      campus: pick(r, ['본분교구분명', '본분교구분']),
      type: pick(r, ['학교구분명', '대학구분명']),
      sido: region.sido,
      sigungu: region.sigungu,
    });
  }
  // 같은 이름이 여러 곳에 있으면(분교·캠퍼스) '이름 (시·도 시·군·구)'로 구분한다
  const count = new Map();
  for (const u of list) count.set(u.name, (count.get(u.name) || 0) + 1);
  const seen = new Set();
  const out = [];
  for (const u of list) {
    const label = count.get(u.name) > 1 ? `${u.name} (${u.sido} ${u.sigungu}`.trim() + ')' : u.name;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ label, name: u.name, type: u.type, sido: u.sido, sigungu: u.sigungu });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, 'ko'));
}

/** 대학 목록 CSV가 있으면 data/universities.json을 만든다. 없으면 건너뛴다. */
export async function buildUniversityList(root, { log = console.log } = {}) {
  const file = await findUniversityCsv(root);
  if (!file) {
    log('대학 목록: CSV 없음 → 건너뜀 (data.go.kr "전국대학및전문대학정보표준데이터"를 csv/에 두면 대학 이름 자동완성이 켜집니다)');
    return null;
  }
  const rows = parseCsv(decodeBuffer(await readFile(path.join(root, file))));
  const list = toUniversities(rows);
  const out = path.join(root, 'data', 'universities.json');
  await writeFile(out, JSON.stringify({ source: path.basename(file), count: list.length, universities: list }));
  log(`대학 목록: ${file} ${rows.length}행 → data/universities.json ${list.length}곳`);
  return list;
}
