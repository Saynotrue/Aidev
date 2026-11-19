// 데이터 수집·정규화·조건 구조화 → data/benefits.json (D-1 ~ D-6)
//
// 사용법:
//   npm run collect                                  # 전체 수집 (API 키는 .env)
//   npm run collect -- --from-cache                  # 공공데이터 API 대신 지난번 원본 캐시 사용 (호출 수 절약)
//   npm run collect -- --no-llm                      # LLM 구조화 생략 (코드로 알 수 있는 조건만)
//   npm run collect -- --llm-limit 50                # LLM 호출 상한 (비용 확인용)
//   npm run collect -- --max-pages 1                 # 정부24 API 1페이지만 (테스트용)
//   npm run collect -- --skip-gov24 --kosaf data/raw/scholarship.csv --national data/raw/national.csv

import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.js';
import { decodeBuffer, parseCsv } from './lib/csv.js';
import { fetchAll, toBenefit, isYouthRelevant, FIELD } from './lib/gov24.js';
import { scholarshipToBenefit, nationalToBenefit } from './lib/kosaf.js';
import { dedupe } from './lib/normalize.js';
import { structureAll } from './lib/structure.js';
import { todayString, isClosed } from '../js/filter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(ROOT);

const { values: opt } = parseArgs({
  options: {
    'skip-gov24': { type: 'boolean', default: false },
    'from-cache': { type: 'boolean', default: false },
    'max-pages': { type: 'string' },
    kosaf: { type: 'string' },
    national: { type: 'string' },
    'no-llm': { type: 'boolean', default: false },
    'llm-limit': { type: 'string' },
    concurrency: { type: 'string', default: '2' },
    out: { type: 'string', default: 'data/benefits.json' },
  },
});

const today = todayString();
const log = (...a) => console.log(...a);

async function collectGov24() {
  const rawFile = path.join(ROOT, 'data', 'cache', 'gov24-raw.json');
  let raw;
  if (opt['from-cache']) {
    raw = JSON.parse(await readFile(rawFile, 'utf8'));
    log(`정부24: 캐시 사용 (${raw.fetched_at} 수집분)`);
  } else {
    const key = process.env.DATA_GO_KR_SERVICE_KEY;
    if (!key) throw new Error('.env에 DATA_GO_KR_SERVICE_KEY가 없습니다. (--skip-gov24로 건너뛸 수 있음)');
    const maxPages = opt['max-pages'] ? Number(opt['max-pages']) : Infinity;
    log('정부24 공공서비스(혜택) API 수집…');
    raw = {
      fetched_at: today,
      list: await fetchAll('serviceList', key, { maxPages, log }),
      detail: await fetchAll('serviceDetail', key, { maxPages, log }),
      conditions: await fetchAll('supportConditions', key, { maxPages, log }),
    };
    await mkdir(path.dirname(rawFile), { recursive: true });
    await writeFile(rawFile, JSON.stringify(raw));
  }

  const byId = (rows) => new Map(rows.map((r) => [r[FIELD.id], r]));
  const details = byId(raw.detail);
  const conds = byId(raw.conditions);
  let skipped = 0;
  const out = [];
  for (const row of raw.list) {
    const id = row[FIELD.id];
    const cond = conds.get(id);
    if (!isYouthRelevant({ ...row, ...details.get(id) }, cond)) { skipped += 1; continue; }
    out.push(toBenefit(row, details.get(id), cond, raw.fetched_at));
  }
  log(`  청년 관련 ${out.length}건 (연령·대상 불일치 ${skipped}건 제외)`);
  return out;
}

async function collectCsv(file, mapper, label) {
  const full = file ? path.resolve(ROOT, file) : null;
  if (!full || !existsSync(full)) {
    log(`${label}: 파일 없음 → 건너뜀 (data.go.kr에서 내려받아 csv/ 폴더에 두세요)`);
    return [];
  }
  const rows = parseCsv(decodeBuffer(await readFile(full)));
  log(`${label}: ${rows.length}행 읽음 (열: ${Object.keys(rows[0] || {}).slice(0, 8).join(', ')}…)`);
  return rows.map((r) => mapper(r, today)).filter((b) => b.name && b.name !== '(이름 없음)');
}

/** csv/ 또는 data/raw/에서 파일명이 맞는 CSV 중 가장 최신(이름순 마지막, 파일명 끝 날짜 기준)을 찾는다 */
function findCsv(pattern) {
  const hits = [];
  for (const dir of ['csv', 'data/raw']) {
    const abs = path.join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) {
      if (f.toLowerCase().endsWith('.csv') && pattern.test(f.normalize('NFC'))) hits.push(path.join(dir, f));
    }
  }
  return hits.sort().at(-1) || null;
}

async function main() {
  const t0 = Date.now();
  let benefits = [];
  if (!opt['skip-gov24']) benefits.push(...await collectGov24());
  benefits.push(...await collectCsv(opt.kosaf || findCsv(/학자금\s*지원\s*정보/), scholarshipToBenefit, '한국장학재단 학자금 지원정보'));
  benefits.push(...await collectCsv(opt.national || findCsv(/국가장학금/), nationalToBenefit, '국가장학금·학자금대출 정보'));

  // 중복 제거 + 마감 항목 제외 (PRD 6.2)
  benefits = dedupe(benefits);
  const before = benefits.length;
  benefits = benefits.filter((b) => !isClosed(b, today));
  log(`통합 ${before}건 중 마감 ${before - benefits.length}건 제외 → ${benefits.length}건`);

  if (opt['no-llm']) {
    log('LLM 구조화 생략 (--no-llm)');
  } else if (!process.env.NVIDIA_API_KEY) {
    log('NVIDIA_API_KEY 없음 → LLM 구조화 생략');
  } else {
    log('LLM 조건 구조화…');
    benefits = await structureAll(benefits, {
      root: ROOT,
      concurrency: Number(opt.concurrency) || 2,
      limit: opt['llm-limit'] ? Number(opt['llm-limit']) : Infinity,
      log,
    });
    // 구조화로 마감일이 새로 확인된 항목을 다시 거른다
    benefits = benefits.filter((b) => !isClosed(b, today));
  }

  const bySource = benefits.reduce((acc, b) => ({ ...acc, [b.source]: (acc[b.source] || 0) + 1 }), {});
  const output = { generated_at: today, count: benefits.length, sources: bySource, benefits };
  const outFile = path.resolve(ROOT, opt.out);
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(output));
  const kb = Math.round(JSON.stringify(output).length / 1024);
  log(`완료: ${opt.out} (${benefits.length}건, 약 ${kb}KB, ${((Date.now() - t0) / 1000).toFixed(1)}초)`);
  log(`  출처별: ${JSON.stringify(bySource)}`);
}

main().catch((err) => {
  console.error(`수집 실패: ${err.message}`);
  process.exit(1);
});
