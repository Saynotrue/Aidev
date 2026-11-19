// 마감 캘린더용 순수 함수 (DOM 없음 → node --test로 검증).

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`; // m은 1~12

/** 해당 월 달력 칸(일요일 시작, 6주 고정이 아닌 필요한 주 수만큼). */
export function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weeks = Math.ceil((first.getUTCDay() + lastDay) / 7);
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    cells.push({
      ymd: ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()),
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month - 1,
    });
  }
  return cells;
}

/** 지원금 목록 → 날짜별 일정 (접수 시작·마감). */
export function scheduleEvents(benefits) {
  const events = [];
  for (const b of benefits) {
    if (b.always_open) continue;
    if (YMD.test(b.apply_start || '') && b.apply_start !== b.apply_end) events.push({ ymd: b.apply_start, type: 'start', benefit: b });
    if (YMD.test(b.apply_end || '')) events.push({ ymd: b.apply_end, type: 'end', benefit: b });
  }
  return events.sort((a, b) => a.ymd.localeCompare(b.ymd) || (a.type === 'end' ? -1 : 1));
}

/** 오늘 이후 가장 가까운 마감 일정. */
export function nextDeadline(events, today) {
  return events.find((e) => e.type === 'end' && e.ymd >= today) || null;
}

export function shiftMonth(year, month, delta) {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

// ── iCalendar(.ics) 내보내기 ──

const icsText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** RFC 5545: 한 줄은 75바이트 이하, 넘으면 CRLF + 공백으로 접는다 (UTF-8 글자는 쪼개지 않음). */
function fold(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // 이어지는 줄은 앞 공백 1바이트
    if (bytes + n > limit) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const compact = (d) => d.replace(/-/g, '');
function nextDay(d) {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, day + 1));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** 마감일이 있는 지원금을 종일 일정으로 담은 .ics 문자열 (마감 3일 전 알림 포함). */
export function buildIcs(benefits, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//badeuljido//deadline calendar//KO', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:받을지도 마감 일정'];
  for (const b of benefits) {
    if (b.always_open || !YMD.test(b.apply_end || '')) continue;
    const desc = [b.agency, b.apply_period_text && `신청 기간: ${b.apply_period_text}`, b.url].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${icsText(b.id)}@badeuljido`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(b.apply_end)}`,
      `DTEND;VALUE=DATE:${compact(nextDay(b.apply_end))}`,
      `SUMMARY:${icsText(`[마감] ${b.name}`)}`,
      desc ? `DESCRIPTION:${icsText(desc)}` : null,
      /^https?:\/\//i.test(b.url || '') ? `URL:${b.url}` : null,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(`${b.name} 마감 3일 전`)}`, 'TRIGGER:-P3D', 'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.filter(Boolean).map(fold).join('\r\n') + '\r\n';
}
