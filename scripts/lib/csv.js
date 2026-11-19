// 최소 CSV 파서 (RFC 4180: 따옴표, 따옴표 이스케이프, 셀 안 줄바꿈 지원)
// 공공데이터포털 파일은 EUC-KR(CP949)인 경우가 많아 인코딩을 자동 판별한다.

/** UTF-8로 읽어 보고 실패하면 EUC-KR로 디코딩 */
export function decodeBuffer(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('euc-kr').decode(buf);
  }
}

/** CSV 문자열 → 2차원 배열 */
export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** CSV 문자열 → 객체 배열 (첫 행을 헤더로 사용) */
export function parseCsv(text) {
  const [header, ...rows] = parseCsvRows(text);
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}
