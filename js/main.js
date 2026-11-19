// 화면 이벤트와 렌더링. 외부 데이터는 모두 textContent로 넣는다 (innerHTML 사용 안 함).

import {
  CATEGORIES, HOUSEHOLD_OPTIONS, INCOME_BANDS, STATUS_LABEL,
  recommend, topCandidates, sortItems, todayString, evaluate, deadlineInfo,
} from './filter.js';
import { SIDO, SIGUNGU } from './regions.js';
import { ai, aiAvailable } from './ai.js';
import { favorites } from './favorites.js';
import { icon, categoryArt } from './icons.js';
import { monthGrid, scheduleEvents, nextDeadline, shiftMonth, buildIcs } from './schedule.js';

const RERANK_N = 20; // LLM에 보낼 후보 수 (R-2)
const LOW_SCORE = 30; // AI 적합도가 이보다 낮으면 추천 목록에서 '그 외'로 내린다

const $ = (sel) => document.querySelector(sel);

// 조건 판단 상태 아이콘 (충족·확인 필요·미충족)
const statusIcon = (status) => h('span', { class: `st st-${status}` }, icon(`status-${status}`));

/** 간단한 DOM 생성 도우미. 문자열 자식은 텍스트 노드로 들어간다. */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const state = {
  benefits: [],
  profile: null,
  items: [],
  candidateIds: new Set(),
  tab: '전체',
  sort: 'deadline',
  showAll: false,
  runId: 0,
  explainCache: new Map(),
  view: 'search',
  favSort: 'deadline',
  cal: { year: 0, month: 0, source: null },
  compare: [], // 비교 중인 지원금 id (최대 MAX_COMPARE)
};

// ───────────────────────── 초기화 ─────────────────────────

async function loadData() {
  const banner = $('#data-banner');
  for (const [file, isSample] of [['data/benefits.json', false], ['data/benefits.sample.json', true]]) {
    try {
      const res = await fetch(file, { cache: 'no-cache' });
      if (!res.ok) continue;
      const raw = await res.json();
      state.benefits = Array.isArray(raw) ? raw : raw.benefits;
      $('#stat-total').textContent = state.benefits.length.toLocaleString('ko-KR');
      $('#data-date').textContent = raw.generated_at ? `수집일 ${raw.generated_at}` : '';
      if (isSample) {
        banner.textContent = '지금은 화면 확인용 샘플 데이터를 보여 주고 있습니다. 실제 지원금 정보가 아닙니다. (npm run collect로 data/benefits.json을 만드세요)';
        banner.hidden = false;
      }
      return;
    } catch { /* 다음 파일 */ }
  }
  banner.textContent = '지원금 데이터를 불러오지 못했습니다.';
  banner.hidden = false;
}

function fillSigungu(sido, selected = '') {
  const select = $('#sigungu');
  const list = SIGUNGU[sido] || [];
  select.replaceChildren(
    h('option', { value: '' }, !sido ? '시·도를 먼저 고르세요' : list.length ? '선택 안 함' : '해당 없음'),
    ...list.map((name) => h('option', { value: name }, name)),
  );
  select.disabled = list.length === 0;
  select.value = list.includes(selected) ? selected : '';
}

function buildForm() {
  const sido = $('#sido');
  for (const s of SIDO) sido.append(h('option', { value: s }, s));
  sido.addEventListener('change', () => fillSigungu(sido.value));
  const income = $('#income_band');
  for (const b of INCOME_BANDS) income.append(h('option', { value: String(b.band) }, b.label));
  const chip = (name, value) => h('label', { class: 'chip' }, h('input', { type: 'checkbox', name, value }), h('span', {}, value));
  $('#household').append(...HOUSEHOLD_OPTIONS.map((v) => chip('household', v)));
  $('#interests').append(...CATEGORIES.map((v) => chip('interests', v)));
}

function readProfile() {
  const f = $('#profile-form');
  const num = (v) => (v === '' || v == null ? null : Number(v));
  const checked = (name) => [...f.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
  const age = num(f.age.value);
  const gpa = num(f.gpa.value);
  return {
    age: Number.isFinite(age) && age >= 0 && age <= 120 ? Math.floor(age) : null,
    sido: f.sido.value,
    sigungu: f.sigungu.value,
    student_status: f.student_status.value,
    grade: num(f.grade.value),
    gpa: Number.isFinite(gpa) && gpa >= 0 && gpa <= 4.5 ? gpa : null,
    income_band: num(f.income_band.value),
    household: checked('household'),
    interests: checked('interests'),
  };
}

function fillForm(p) {
  const f = $('#profile-form');
  if (p.age != null) f.age.value = p.age;
  if (p.sido) {
    f.sido.value = p.sido;
    fillSigungu(p.sido, p.sigungu);
  }
  if (p.student_status && p.student_status !== '모름') f.student_status.value = p.student_status;
  if (p.grade != null) f.grade.value = String(p.grade);
  if (p.gpa != null) f.gpa.value = p.gpa;
  if (p.income_band != null) f.income_band.value = String(p.income_band);
  for (const input of f.querySelectorAll('input[name="household"]')) {
    if ((p.household || []).includes(input.value)) input.checked = true;
  }
}

// ───────────────────────── 추천 ─────────────────────────

async function runRecommend(e) {
  e.preventDefault();
  const runId = ++state.runId;
  state.profile = readProfile();
  state.explainCache.clear();
  state.tab = '전체';
  state.showAll = false;

  const { items, excluded } = recommend(state.profile, state.benefits, todayString());
  state.items = items;
  state.candidateIds = new Set(topCandidates(items, RERANK_N).map((it) => it.benefit.id));

  $('#form-dialog').close();
  $('#results').hidden = false;
  const summary = $('#results-summary');
  summary.classList.remove('is-error');
  summary.textContent = `조건에 맞는 지원금 ${items.length}건 (명백히 해당하지 않는 ${excluded}건 제외)`;
  render();
  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (state.candidateIds.size === 0 || !aiAvailable()) return;
  summary.textContent += ' · AI가 추천 순위를 정리하고 있어요…';
  try {
    const results = await ai.rerank(state.profile, [...state.candidateIds]);
    if (runId !== state.runId) return; // 그새 다시 검색함
    const byId = new Map(results.map((r) => [r.id, r]));
    for (const it of state.items) {
      const r = byId.get(it.benefit.id);
      if (r) it.ai = { score: r.score, reason: r.reason };
    }
    summary.textContent = `조건에 맞는 지원금 ${items.length}건 (명백히 해당하지 않는 ${excluded}건 제외) · AI 추천 순위 반영됨`;
  } catch (err) {
    if (runId !== state.runId) return;
    summary.textContent = `조건에 맞는 지원금 ${items.length}건 (명백히 해당하지 않는 ${excluded}건 제외) · ${err.message}`;
  }
  render();
}

function isRecommended(it) {
  return state.candidateIds.has(it.benefit.id) && !(it.ai && it.ai.score < LOW_SCORE);
}

// ───────────────────────── 결과 렌더링 ─────────────────────────

function render() {
  const inTab = (it) => state.tab === '전체' || it.benefit.category === state.tab;

  // 분야 탭 (R-3)
  const tabs = $('#tabs');
  tabs.replaceChildren(...['전체', ...CATEGORIES].map((cat) => {
    const count = state.items.filter((it) => cat === '전체' || it.benefit.category === cat).length;
    return h('button', {
      type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(state.tab === cat),
      onclick: () => { state.tab = cat; state.showAll = false; render(); },
    }, cat, h('span', { class: 'count' }, String(count)));
  }));

  for (const btn of document.querySelectorAll('[data-sort]')) {
    btn.classList.toggle('is-active', btn.dataset.sort === state.sort);
  }

  const visible = state.items.filter(inTab);
  const recommended = sortItems(visible.filter(isRecommended), state.sort);
  const others = sortItems(visible.filter((it) => !isRecommended(it)), state.sort);

  const list = $('#result-list');
  list.replaceChildren();
  if (visible.length === 0) {
    list.append(h('li', { class: 'empty' }, '이 분야에서 조건에 맞는 지원금을 찾지 못했어요.'));
  } else {
    if (recommended.length) {
      list.append(h('li', { class: 'section-label' }, `추천 ${recommended.length}건`));
      list.append(...recommended.map(card));
    }
    if (state.showAll && others.length) {
      list.append(h('li', { class: 'section-label' }, `그 외 조건에 맞는 지원금 ${others.length}건`));
      list.append(...others.map(card));
    }
  }

  const more = $('#show-more');
  more.hidden = state.showAll || others.length === 0;
  more.textContent = `조건에 맞는 다른 지원금 ${others.length}건 더 보기`;
}

function ddayBadge(deadline) {
  const cls = deadline.kind === 'always' ? 'is-always' : (deadline.days != null && deadline.days <= 7 ? 'is-urgent' : '');
  return h('span', { class: `dday ${cls}` }, deadline.label);
}

// ───────────────────────── 즐겨찾기 (별) ─────────────────────────

function starButton(id, { withLabel = false } = {}) {
  const btn = h('button', { type: 'button', class: 'star', 'data-fav-id': id });
  const paint = () => {
    const on = favorites.has(id);
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? '즐겨찾기 해제' : '즐겨찾기에 추가');
    btn.title = on ? '즐겨찾기 해제' : '즐겨찾기에 추가';
    btn.replaceChildren(icon('star', on ? 'is-filled' : ''));
    if (withLabel) btn.append(on ? ' 즐겨찾기됨' : ' 즐겨찾기');
  };
  btn.paint = paint;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    try {
      favorites.toggle(id);
      btn.classList.remove('pop');
      void btn.offsetWidth; // 애니메이션 다시 시작
      btn.classList.add('pop');
    } catch (err) {
      alert(err.message);
    }
  });
  paint();
  return btn;
}

/** 즐겨찾기 화면용 항목. 검색 결과에 있으면 AI 점수까지 재사용하고, 없으면 현재 조건으로 새로 평가한다. */
function favoriteItem(benefit, today) {
  const found = state.items.find((it) => it.benefit.id === benefit.id);
  if (found) return found;
  return {
    benefit,
    checks: state.profile ? evaluate(state.profile, benefit, today) : [],
    score: 0,
    deadline: deadlineInfo(benefit, today),
  };
}

function renderFavorites() {
  const ids = favorites.list();
  const byId = new Map(state.benefits.map((b) => [b.id, b]));
  const today = todayString();
  const items = ids.filter((id) => byId.has(id)).map((id) => favoriteItem(byId.get(id), today));
  const missing = ids.length - items.length;

  for (const btn of document.querySelectorAll('[data-fav-sort]')) {
    btn.classList.toggle('is-active', btn.dataset.favSort === state.favSort);
  }

  const summary = $('#fav-summary');
  summary.textContent = ids.length === 0 ? '' : [
    `즐겨찾기한 지원금 ${items.length}건`,
    missing ? `현재 데이터에서 찾을 수 없는 ${missing}건(종료·삭제된 공고)` : null,
    state.profile ? null : '조건을 입력하고 검색하면 내 조건과 비교해 볼 수 있어요',
  ].filter(Boolean).join(' · ');

  const list = $('#fav-list');
  const sorted = state.favSort === 'added' ? items : sortItems(items, 'deadline');
  list.replaceChildren(...(sorted.length
    ? sorted.map(card)
    : [h('li', { class: 'empty' }, ids.length ? '즐겨찾기한 지원금을 현재 데이터에서 찾지 못했어요.' : '아직 즐겨찾기한 지원금이 없어요. 카드의 별 버튼을 눌러 추가해 보세요.')]));
}

function setView(view) {
  state.view = view;
  for (const tab of document.querySelectorAll('[data-view]')) {
    const on = tab.dataset.view === view;
    tab.setAttribute('aria-selected', String(on));
    const panel = $(`#${tab.getAttribute('aria-controls')}`);
    const wasHidden = panel.hidden;
    panel.hidden = !on;
    if (on && wasHidden) { // 화면 전환 애니메이션
      panel.classList.remove('view-in');
      void panel.offsetWidth;
      panel.classList.add('view-in');
    }
  }
  renderView();
}

function renderView() {
  if (state.view === 'favorites') renderFavorites();
  else if (state.view === 'calendar') renderCalendar();
  else if (state.view === 'compare') renderCompare();
}

function onFavoritesChange() {
  $('#fav-count').textContent = String(favorites.count());
  for (const btn of document.querySelectorAll('.star[data-fav-id]')) btn.paint?.();
  renderView();
}

const benefitById = (id) => state.benefits.find((b) => b.id === id);
const catClass = (b) => `cat-${Math.max(0, CATEGORIES.indexOf(b.category))}`;

// ───────────────────────── 마감 캘린더 ─────────────────────────

/**
 * 캘린더에 올릴 지원금: 즐겨찾기 + "내 조건으로 찾은" 결과. 즐겨찾기가 항상 앞에 온다.
 * source = 'mine'(즐겨찾기 + 내 조건) | 'favorites'(즐겨찾기만)
 */
function calendarBenefits(source) {
  const favIds = favorites.list();
  const favs = favIds.map(benefitById).filter(Boolean);
  if (source === 'favorites') return favs;
  const fav = new Set(favIds);
  return [...favs, ...state.items.map((it) => it.benefit).filter((b) => !fav.has(b.id))];
}

function renderCalendar() {
  const today = todayString();
  const cal = state.cal;
  if (!cal.year) [cal.year, cal.month] = today.split('-').map(Number);
  if (!cal.source) cal.source = 'mine';
  const searched = state.profile != null;

  for (const btn of document.querySelectorAll('[data-cal-source]')) {
    btn.classList.toggle('is-active', btn.dataset.calSource === cal.source);
  }

  const favSet = new Set(favorites.list());
  const isFav = (e) => favSet.has(e.benefit.id);
  const aiScore = new Map(state.items.filter((it) => it.ai).map((it) => [it.benefit.id, it.ai.score]));
  const benefits = calendarBenefits(cal.source);
  // 같은 날이면 즐겨찾기 → AI 적합도 높은 순 → 마감 → 접수 시작
  const events = scheduleEvents(benefits).sort((a, b) => a.ymd.localeCompare(b.ymd)
    || isFav(b) - isFav(a)
    || (aiScore.get(b.benefit.id) ?? -1) - (aiScore.get(a.benefit.id) ?? -1)
    || (a.type === 'end' ? -1 : 1) - (b.type === 'end' ? -1 : 1));
  const monthKey = `${cal.year}-${String(cal.month).padStart(2, '0')}`;
  const inMonth = events.filter((e) => e.ymd.startsWith(monthKey));
  const byDay = new Map();
  for (const e of inMonth) byDay.set(e.ymd, [...(byDay.get(e.ymd) || []), e]);
  const upcoming = nextDeadline(events.filter(isFav), today) || nextDeadline(events, today);

  // 안내 문구
  const favCount = benefits.filter((b) => favSet.has(b.id)).length;
  const datedCount = new Set(events.map((e) => e.benefit.id)).size;
  const summary = $('#cal-summary');
  summary.replaceChildren(
    cal.source === 'favorites'
      ? `즐겨찾기 ${favCount}건 중 신청 기간이 정해진 ${datedCount}건을 표시해요.`
      : searched
        ? `내 조건에 맞는 지원금과 즐겨찾기 중 신청 기간이 정해진 ${datedCount}건을 표시해요. 즐겨찾기가 먼저 보여요.`
        : `지금은 즐겨찾기 일정만 보여요.`,
    upcoming ? ` 가장 가까운 마감: ${upcoming.ymd.slice(5).replace('-', '/')} ${upcoming.benefit.name}` : '');
  $('#cal-search-hint').hidden = searched || cal.source === 'favorites';

  $('#cal-title').textContent = `${cal.year}년 ${cal.month}월`;
  const jump = $('#cal-jump');
  jump.hidden = !upcoming || upcoming.ymd.startsWith(monthKey);
  jump.onclick = () => { [cal.year, cal.month] = upcoming.ymd.split('-').map(Number); renderCalendar(); };
  const ics = $('#cal-ics');
  ics.disabled = !events.some((e) => e.type === 'end');
  ics.onclick = () => downloadIcs(benefits, cal.source === 'favorites' ? '즐겨찾기' : '내조건');

  // 달력 칸
  const open = (b) => openDetail(favoriteItem(b, today));
  const evButton = (e) => h('button', {
    type: 'button', class: `ev ev-${e.type} ${catClass(e.benefit)} ${isFav(e) ? 'is-fav' : ''}`,
    title: `${isFav(e) ? '즐겨찾기 · ' : ''}${e.type === 'end' ? '마감' : '접수 시작'}: ${e.benefit.name}`,
    onclick: () => open(e.benefit),
  }, isFav(e) ? h('span', { class: 'ev-star', 'aria-label': '즐겨찾기' }, icon('star', 'is-filled')) : null, e.benefit.name);
  $('#cal-grid').replaceChildren(
    ...['일', '월', '화', '수', '목', '금', '토'].map((d) => h('div', { class: 'cal-dow' }, d)),
    ...monthGrid(cal.year, cal.month).map((c, i) => {
      const list = byDay.get(c.ymd) || [];
      return h('div', {
        class: ['cal-cell', !c.inMonth && 'is-out', c.ymd === today && 'is-today', i % 7 === 0 && 'is-sun',
          list.length && 'has-ev', list.some(isFav) && 'has-fav'].filter(Boolean).join(' '),
      },
      h('span', { class: 'cal-day' }, String(c.day)),
      list.slice(0, 3).map(evButton),
      list.length > 3 ? h('span', { class: 'ev-more' }, `+${list.length - 3}`) : null,
      list.length ? h('span', { class: 'ev-dots', 'aria-hidden': 'true' },
        list.slice(0, 4).map((e) => h('i', { class: `ev-dot ev-${e.type} ${isFav(e) ? 'is-fav' : ''}` }))) : null);
    }));

  // 이번 달 일정 목록: 즐겨찾기 묶음을 먼저
  const agendaItem = (e) => {
    const [, m, d] = e.ymd.split('-');
    return h('li', {},
      h('button', { type: 'button', class: `agenda-item ${isFav(e) ? 'is-fav' : ''}`, onclick: () => open(e.benefit) },
        h('span', { class: `agenda-date ${e.ymd === today ? 'is-today' : ''}` }, h('b', {}, String(Number(d))), `${Number(m)}월`),
        h('span', { class: `ev ev-${e.type}` }, e.type === 'end' ? '마감' : '접수 시작'),
        h('span', { class: 'agenda-name' }, isFav(e) ? h('span', { class: 'ev-star', 'aria-label': '즐겨찾기' }, icon('star', 'is-filled')) : null, e.benefit.name,
          h('small', {}, e.benefit.agency || '')),
        e.type === 'end' ? ddayBadge(deadlineInfo(e.benefit, today)) : null));
  };
  const favEvents = inMonth.filter(isFav);
  const otherEvents = inMonth.filter((e) => !isFav(e));
  $('#cal-agenda-title').textContent = `${cal.month}월 일정 ${inMonth.length}건`;
  $('#cal-agenda').replaceChildren(...(inMonth.length ? [
    favEvents.length ? h('li', { class: 'section-label' }, icon('star', 'is-filled'), ` 즐겨찾기 ${favEvents.length}건`) : null,
    ...favEvents.map(agendaItem),
    otherEvents.length ? h('li', { class: 'section-label' }, `내 조건에 맞는 지원금 ${otherEvents.length}건`) : null,
    ...otherEvents.map(agendaItem),
  ].filter(Boolean) : [h('li', { class: 'empty' }, '이 달에는 표시할 일정이 없어요.')]));

  // 날짜 없이 신청하는 즐겨찾기 (상시·기간 미상)
  const undated = benefits.filter((b) => favSet.has(b.id) && !events.some((e) => e.benefit === b));
  $('#cal-undated').replaceChildren(...(undated.length ? [
    h('h3', { class: 'cal-agenda-title' }, `날짜 없이 신청하는 즐겨찾기 ${undated.length}건`),
    h('div', { class: 'chips' }, undated.map((b) => h('button', { type: 'button', class: `undated-chip ${catClass(b)}`, onclick: () => open(b) },
      b.always_open ? '상시 · ' : '기간 확인 · ', b.name))),
  ] : []));
}

function downloadIcs(benefits, sourceName) {
  const blob = new Blob([buildIcs(benefits)], { type: 'text/calendar;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `받을지도-${sourceName}-마감일정.ics` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ───────────────────────── 비교하기 ─────────────────────────

const MAX_COMPARE = 3;

function toggleCompare(id) {
  const i = state.compare.indexOf(id);
  if (i >= 0) state.compare.splice(i, 1);
  else if (state.compare.length >= MAX_COMPARE) { alert(`비교는 최대 ${MAX_COMPARE}개까지 할 수 있어요. 하나를 빼고 다시 담아 주세요.`); return; }
  else state.compare.push(id);
  onCompareChange();
}

function onCompareChange() {
  const badge = $('#compare-count');
  badge.textContent = String(state.compare.length);
  badge.hidden = state.compare.length === 0;
  for (const btn of document.querySelectorAll('.compare-btn')) btn.paint?.();
  if (state.view === 'compare') renderCompare();
}

function compareButton(id) {
  const btn = h('button', { type: 'button', class: 'btn btn-secondary btn-pill btn-sm compare-btn' });
  btn.paint = () => {
    const on = state.compare.includes(id);
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.replaceChildren(icon(on ? 'check' : 'scale'), on ? ' 비교 중' : ' 비교에 담기');
  };
  btn.addEventListener('click', () => toggleCompare(id));
  btn.paint();
  return btn;
}

function renderCompare() {
  const today = todayString();
  // 고를 수 있는 목록: 즐겨찾기 + (즐겨찾기가 아니어도) 이미 비교에 담은 것
  // (순서를 고정해야 칩을 누를 때 자리가 바뀌지 않는다)
  const favIds = favorites.list();
  const pickIds = [...favIds, ...state.compare.filter((id) => !favIds.includes(id))].filter(benefitById);
  $('#compare-clear').hidden = state.compare.length === 0;
  $('#compare-picker').replaceChildren(...(pickIds.length ? pickIds.map((id) => {
    const b = benefitById(id);
    const on = state.compare.includes(id);
    return h('button', { type: 'button', class: `pick-chip ${on ? 'is-on' : ''}`, 'aria-pressed': String(on), onclick: () => toggleCompare(id) },
      h('span', { class: `pick-dot ${catClass(b)}`, 'aria-hidden': 'true' }), b.name, on ? icon('check') : null);
  }) : [h('p', { class: 'empty' }, '즐겨찾기한 지원금이 없어요. 카드의 별 버튼을 눌러 담은 뒤 여기서 골라 보세요.')]));

  const wrap = $('#compare-table');
  const items = state.compare.map(benefitById).filter(Boolean).map((b) => favoriteItem(b, today));
  if (items.length < 2) {
    wrap.replaceChildren(h('div', { class: 'compare-empty' },
      h('span', { class: 'compare-empty-icon', 'aria-hidden': 'true' }, icon('scale')),
      h('p', {}, items.length === 0 ? '위에서 비교할 지원금을 2개 이상 골라 주세요.' : '하나만 더 고르면 나란히 비교할 수 있어요.')));
    return;
  }

  // 돋보이는 항목 표시: 가장 먼저 마감, AI 적합도 최고, 조건 충족 최다
  const withDays = items.filter((it) => it.deadline.days != null && it.deadline.days >= 0);
  const soonest = withDays.length ? withDays.reduce((a, b) => (b.deadline.days < a.deadline.days ? b : a)) : null;
  const scored = items.filter((it) => it.ai);
  const best = scored.length ? scored.reduce((a, b) => (b.ai.score > a.ai.score ? b : a)) : null;
  const okCount = (it) => it.checks.filter((c) => c.key !== 'deadline' && c.status === 'ok').length;
  const failCount = (it) => it.checks.filter((c) => c.key !== 'deadline' && c.status === 'fail').length;

  const text = (v, cls = '') => (v ? h('p', { class: `cmp-text ${cls}` }, v) : h('span', { class: 'cmp-none' }, '정보 없음'));
  const rows = [
    ['분야', (it) => h('span', { class: `cat ${catClass(it.benefit)}` }, it.benefit.category)],
    ['기관', (it) => text(it.benefit.agency)],
    ['마감', (it) => h('div', {}, ddayBadge(it.deadline), it === soonest ? h('span', { class: 'cmp-flag' }, '가장 먼저 마감') : null)],
    ['신청 기간', (it) => text(it.benefit.apply_period_text || (it.benefit.always_open ? '상시' : ''))],
    ['지원 금액', (it) => text(it.benefit.amount, 'clamp')],
    ['지원 내용', (it) => text(it.benefit.summary, 'clamp')],
    ['지원 대상', (it) => text(it.benefit.target_text, 'clamp')],
    ['신청 방법', (it) => text(it.benefit.apply_method, 'clamp')],
    ['내 조건', (it) => (it.checks.length
      ? h('div', { class: 'cmp-checks' }, statusIcon('ok'), String(okCount(it)), statusIcon('check'), String(it.checks.filter((c) => c.key !== 'deadline' && c.status === 'check').length), statusIcon('fail'), String(failCount(it)))
      : h('span', { class: 'cmp-none' }, '조건 입력 후 표시'))],
    ...(scored.length ? [['AI 적합도', (it) => (it.ai
      ? h('div', {}, h('b', { class: 'cmp-score' }, String(it.ai.score)), it === best ? h('span', { class: 'cmp-flag' }, '가장 잘 맞아요') : null)
      : h('span', { class: 'cmp-none' }, '-'))]] : []),
    ['', (it) => {
      const url = safeUrl(it.benefit.url);
      return h('div', { class: 'cmp-links' },
        h('button', { type: 'button', class: 'btn btn-secondary btn-pill btn-sm', onclick: () => openDetail(it) }, '자세히'),
        url ? h('a', { class: 'btn btn-dark btn-pill btn-sm', href: url, target: '_blank', rel: 'noopener noreferrer' }, '신청 ', icon('external')) : null);
    }],
  ];

  wrap.replaceChildren(h('table', { class: 'compare-table', style: `--cols: ${items.length}` },
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col', class: 'cmp-label' }, h('span', { class: 'sr-only' }, '항목')),
      items.map((it) => h('th', { scope: 'col' },
        h('div', { class: `cmp-thumb ${catClass(it.benefit)}`, 'aria-hidden': 'true' }, categoryArt(it.benefit.category)),
        h('div', { class: 'cmp-head' },
          h('span', { class: 'cmp-name' }, it.benefit.name),
          h('button', { type: 'button', class: 'cmp-remove', 'aria-label': `${it.benefit.name} 비교에서 빼기`, onclick: () => toggleCompare(it.benefit.id) }, icon('close'))))))),
    h('tbody', {}, rows.map(([label, cell]) => h('tr', {},
      h('th', { scope: 'row', class: 'cmp-label' }, label),
      items.map((it) => h('td', {}, cell(it))))))));
}

// ───────────────────────── 카드 ─────────────────────────

function card(it, i = 0) {
  const b = it.benefit;
  const counts = { ok: 0, check: 0, fail: 0 };
  for (const c of it.checks) if (c.key !== 'deadline') counts[c.status] += 1;
  const catIndex = Math.max(0, CATEGORIES.indexOf(b.category));
  return h('li', { class: 'card-item', style: `--i: ${Math.min(i, 12)}` },
    starButton(b.id),
    h('button', { type: 'button', class: 'card-button', onclick: () => openDetail(it) },
      h('div', { class: `card-thumb cat-${catIndex}`, 'aria-hidden': 'true' },
        categoryArt(b.category, 'thumb-art')),
      h('div', { class: 'card-body' },
      h('div', { class: 'card-top' },
        h('div', {},
          h('span', { class: `cat cat-${catIndex}` }, b.category),
          it.ai ? h('span', { class: 'ai-score' }, `AI 적합도 ${it.ai.score}`) : null,
          h('p', { class: 'card-title' }, b.name),
          h('p', { class: 'card-meta' }, b.agency || '')),
        ddayBadge(it.deadline)),
      b.amount ? h('p', { class: 'card-amount' }, b.amount) : null,
      it.ai?.reason ? h('p', { class: 'card-reason' }, it.ai.reason) : null,
      h('div', { class: 'card-checks' },
        it.checks.length ? [h('span', {}, statusIcon('ok'), String(counts.ok)), h('span', {}, statusIcon('check'), String(counts.check)), h('span', {}, statusIcon('fail'), String(counts.fail))] : null,
        h('span', { class: 'card-more' }, '자세히 보기', icon('arrow-right'))))));
}

// ───────────────────────── 상세 보기 (E-1 ~ E-4) ─────────────────────────

const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

function condList(checks) {
  return h('ul', { class: 'conds' }, checks.map((c) => h('li', { class: `cond ${c.status}` },
    h('div', { class: 'cond-head' }, statusIcon(c.status), `${STATUS_LABEL[c.status]} · ${c.label}`),
    h('p', {}, c.reason),
    (c.evidence || []).map((q) => h('p', { class: 'evidence' }, q)))));
}

function openDetail(it) {
  const b = it.benefit;
  const dialog = $('#detail');
  const body = $('#detail-body');
  const url = safeUrl(b.url);

  const explainBox = h('div', { class: 'detail-section' },
    h('h3', {}, '내 조건과 비교'),
    it.checks.length
      ? [h('p', { class: 'hint' }, '아래는 입력한 조건으로 자동 판단한 결과입니다.'), condList(it.checks)]
      : h('p', { class: 'hint' }, '"지원금 찾기" 화면에서 조건을 입력하고 검색하면 내 조건과 비교해 드려요.'));

  const askInput = h('input', { type: 'text', maxlength: '300', placeholder: '예: 휴학생도 받을 수 있어?', 'aria-label': '질문' });
  const askAnswer = h('div', { class: 'answer', role: 'status' });
  const askBtn = h('button', { type: 'button', class: 'btn btn-secondary' }, '질문하기');
  const doAsk = async () => {
    const q = askInput.value.trim();
    if (!q) return;
    askBtn.disabled = true;
    askAnswer.replaceChildren('답변을 찾는 중…');
    try {
      const r = await ai.ask(b.id, q);
      askAnswer.replaceChildren(
        h('p', {}, r.answer),
        (r.evidence || []).map((e) => h('p', { class: 'evidence' }, e)));
    } catch (err) {
      askAnswer.replaceChildren(h('p', { class: 'status is-error' }, err.message));
    } finally {
      askBtn.disabled = false;
    }
  };
  askBtn.addEventListener('click', doAsk);
  askInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAsk(); });

  body.replaceChildren(...[
    h('span', { class: `cat cat-${Math.max(0, CATEGORIES.indexOf(b.category))}` }, b.category),
    h('h2', { id: 'detail-title', class: 'detail-title' }, b.name),
    h('p', { class: 'card-meta' }, `${b.agency || ''} · 수집일 ${b.collected_at || '-'}`),
    h('div', { class: 'detail-section detail-actions' }, ddayBadge(it.deadline), starButton(b.id, { withLabel: true }), compareButton(b.id)),

    it.ai?.reason ? h('p', { class: 'card-reason' }, `AI 추천 이유: ${it.ai.reason}`) : null,
    explainBox,

    h('div', { class: 'detail-section' },
      h('h3', {}, '지원 정보'),
      h('dl', { class: 'kv' },
        b.summary ? [h('dt', {}, '지원 내용'), h('dd', {}, b.summary)] : null,
        b.amount ? [h('dt', {}, '지원 금액'), h('dd', {}, b.amount)] : null,
        [h('dt', {}, '신청 기간'), h('dd', {}, b.apply_period_text || (b.always_open ? '상시' : '공식 페이지에서 확인'))],
        b.apply_method ? [h('dt', {}, '신청 방법'), h('dd', {}, b.apply_method)] : null),
      url ? h('a', { class: 'official-link', href: url, target: '_blank', rel: 'noopener noreferrer' }, '공식 페이지에서 신청하기 ', icon('external')) : h('p', { class: 'hint' }, '공식 링크 정보가 없습니다. 담당 기관에 문의하세요.')),

    b.target_text ? h('div', { class: 'detail-section' }, h('h3', {}, '지원 대상 (원문)'), h('p', { class: 'detail-text' }, b.target_text)) : null,
    b.criteria_text ? h('div', { class: 'detail-section' }, h('h3', {}, '선정 기준 (원문)'), h('p', { class: 'detail-text' }, b.criteria_text)) : null,

    aiAvailable() ? h('div', { class: 'detail-section' },
      h('h3', {}, '이 지원금에 대해 질문하기 ', h('span', { class: 'badge-ai' }, 'AI')),
      h('div', { class: 'ask-row' }, askInput, askBtn),
      h('p', { class: 'hint' }, '답변은 이 지원금의 공고 원문만 근거로 합니다.'),
      askAnswer) : null,

    h('p', { class: 'disclaimer' }, icon('warning'), ' 최종 자격은 공식 페이지에서 확인하세요.'),
  ].filter(Boolean));

  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  loadExplanation(it, explainBox);
}

async function loadExplanation(it, box) {
  if (!aiAvailable() || !state.profile) return;
  const id = it.benefit.id;
  const status = h('p', { class: 'status', role: 'status' }, 'AI가 원문 조건과 비교하고 있어요…');
  box.append(status);
  try {
    if (!state.explainCache.has(id)) state.explainCache.set(id, ai.explain(state.profile, id));
    const r = await state.explainCache.get(id);
    if (!box.isConnected) return;
    box.replaceChildren(...[
      h('h3', {}, '내 조건과 비교 ', h('span', { class: 'badge-ai' }, 'AI')),
      r.summary ? h('p', { class: 'card-reason' }, r.summary) : null,
      condList(r.checks),
      h('p', { class: 'hint' }, '"원문"은 공고문에서 그대로 가져온 문장입니다. 원문 근거를 찾지 못한 판단은 "확인 필요"로 표시합니다.'),
    ].filter(Boolean));
  } catch (err) {
    state.explainCache.delete(id);
    status.textContent = `${err.message} (위 자동 판단 결과를 참고하세요)`;
    status.classList.add('is-error');
  }
}

// ───────────────────────── 자연어 입력 (U-5) ─────────────────────────

async function fillFromText() {
  const text = $('#nl-text').value.trim();
  const status = $('#nl-status');
  const btn = $('#nl-fill');
  status.classList.remove('is-error');
  if (!text) { status.textContent = '상황을 한 문장으로 적어 주세요.'; return; }
  btn.disabled = true;
  status.textContent = 'AI가 조건을 읽고 있어요…';
  try {
    const { profile } = await ai.parse(text);
    fillForm(profile);
    status.textContent = '조건을 채웠어요. 확인한 뒤 "지원금 찾기"를 누르세요.';
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('is-error');
  } finally {
    btn.disabled = false;
  }
}

// ───────────────────────── 시작 ─────────────────────────

buildForm();
$('#profile-form').addEventListener('submit', runRecommend);
$('#nl-fill').addEventListener('click', fillFromText);
$('#nl-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fillFromText(); } });
$('#show-more').addEventListener('click', () => { state.showAll = true; render(); });
for (const btn of document.querySelectorAll('[data-sort]')) {
  btn.addEventListener('click', () => { state.sort = btn.dataset.sort; render(); });
}
for (const btn of document.querySelectorAll('[data-cal-source]')) {
  btn.addEventListener('click', () => { state.cal.source = btn.dataset.calSource; renderCalendar(); });
}
const moveMonth = (delta) => { Object.assign(state.cal, shiftMonth(state.cal.year, state.cal.month, delta)); renderCalendar(); };
$('#cal-prev').addEventListener('click', () => moveMonth(-1));
$('#cal-next').addEventListener('click', () => moveMonth(1));
$('#cal-today').addEventListener('click', () => { state.cal.year = 0; renderCalendar(); });
$('#compare-clear').addEventListener('click', () => { state.compare = []; onCompareChange(); });
for (const btn of document.querySelectorAll('[data-fav-sort]')) {
  btn.addEventListener('click', () => { state.favSort = btn.dataset.favSort; renderFavorites(); });
}
for (const tab of document.querySelectorAll('[data-view]')) {
  tab.addEventListener('click', () => setView(tab.dataset.view));
}
favorites.onChange(onFavoritesChange);
const formDialog = $('#form-dialog');
function openForm() {
  setView('search');
  if (!formDialog.open) formDialog.showModal();
  formDialog.scrollTop = 0;
  $('#nl-text').focus();
}
for (const btn of document.querySelectorAll('[data-goto-form]')) btn.addEventListener('click', openForm);
// 팝업 바깥(배경) 클릭 또는 × 버튼으로 닫기
for (const dlg of [$('#detail'), formDialog]) {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
  });
}
initMotion();
initTheme();
loadData().then(onFavoritesChange);

// ───────────────────────── 테마 전환 ─────────────────────────

function initTheme() {
  const root = document.documentElement;
  const btn = $('#theme-toggle');
  const systemDark = matchMedia('(prefers-color-scheme: dark)');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const current = () => root.dataset.theme || (systemDark.matches ? 'dark' : 'light');

  const paint = () => {
    const now = current();
    btn.dataset.themeNow = now;
    $('#theme-label').textContent = now === 'dark' ? '라이트 모드로' : '다크 모드로';
    btn.setAttribute('aria-label', now === 'dark' ? '라이트 모드로 바꾸기' : '다크 모드로 바꾸기');
  };

  const apply = (next) => {
    root.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* 저장 못 해도 이번 화면에는 적용 */ }
    paint();
  };

  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    if (reduceMotion.matches) { apply(next); return; }

    if (document.startViewTransition) {
      // 버튼 위치에서 원이 퍼지며 새 테마가 드러난다
      const r = btn.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      const vt = document.startViewTransition(() => apply(next));
      vt.ready.then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 650, easing: 'cubic-bezier(.4,0,.2,1)', pseudoElement: '::view-transition-new(root)' },
        );
      }).catch(() => {});
    } else {
      root.classList.add('theme-fading');
      apply(next);
      setTimeout(() => root.classList.remove('theme-fading'), 500);
    }
  });

  systemDark.addEventListener('change', paint); // 기기 설정이 바뀌면 버튼 문구도 맞춘다
  paint();
}

// ───────────────────────── 애니메이션 ─────────────────────────

/**
 * 세그먼트 토글(정렬·범위 버튼, 분야 탭): 선택 표시(thumb)가 다음 항목으로 미끄러져 간다.
 * 버튼이 다시 그려져도(replaceChildren) 같은 thumb 요소를 다시 붙여 이어서 움직인다.
 */
function initSegmented(container, isActive) {
  const thumb = h('span', { class: 'seg-thumb', 'aria-hidden': 'true' });
  container.classList.add('has-thumb');
  let placed = false;
  const update = () => {
    if (!thumb.isConnected) container.prepend(thumb);
    const active = [...container.children].find((el) => el !== thumb && isActive(el));
    if (!active || container.offsetWidth === 0) { thumb.style.opacity = '0'; placed = false; return; }
    if (!placed) thumb.style.transition = 'none'; // 처음 보일 때는 제자리에서 시작
    thumb.style.opacity = '1';
    thumb.style.width = `${active.offsetWidth}px`;
    thumb.style.height = `${active.offsetHeight}px`;
    thumb.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
    if (!placed) { void thumb.offsetWidth; thumb.style.transition = ''; placed = true; }
  };
  let queued = false;
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; update(); }); } };
  new MutationObserver(schedule).observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-selected'] });
  new ResizeObserver(schedule).observe(container);
  schedule();
}

function initMotion() {
  for (const group of document.querySelectorAll('.sort')) initSegmented(group, (el) => el.classList.contains('is-active'));
  initSegmented($('#tabs'), (el) => el.getAttribute('aria-selected') === 'true');

  // nav 탭 호버: 뒤에서 미끄러지는 배경 알약
  const nav = $('.view-tabs');
  const glow = $('.tab-glow');
  const moveGlow = (tab) => {
    glow.style.width = `${tab.offsetWidth}px`;
    glow.style.transform = `translateX(${tab.offsetLeft}px)`;
  };
  for (const tab of nav.querySelectorAll('.view-tab')) {
    tab.addEventListener('mouseenter', () => { moveGlow(tab); nav.classList.add('is-hovering'); });
    tab.addEventListener('focus', () => { moveGlow(tab); nav.classList.add('is-hovering'); });
    tab.addEventListener('blur', () => nav.classList.remove('is-hovering'));
  }
  nav.addEventListener('mouseleave', () => nav.classList.remove('is-hovering'));

  // 스크롤하면 나타나기
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); }
      }
    }, { threshold: 0.2, rootMargin: '0px 0px -40px 0px' });
    for (const el of reveals) io.observe(el);
  } else {
    for (const el of reveals) el.classList.add('is-visible');
  }

  // 로드맵 길이 스크롤에 맞춰 채워지기
  const road = $('#road');
  const hero = $('.hero');
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  let ticking = false;
  const update = () => {
    ticking = false;
    // 첫 화면을 지나갈수록 히어로가 위로 살짝 빠지며 흐려진다
    if (!calm.matches && hero.offsetHeight) {
      const hp = Math.min(1, Math.max(0, scrollY / (hero.offsetHeight * 0.85)));
      hero.style.setProperty('--hero-p', hp.toFixed(3));
    }
    const r = road.getBoundingClientRect();
    if (r.height === 0) return;
    const p = Math.min(1, Math.max(0, (innerHeight * 0.65 - r.top) / r.height));
    road.style.setProperty('--p', p.toFixed(3));
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  addEventListener('resize', update);
  update();

  // 스크롤 안내 버튼: 결과가 있으면 결과로, 없으면 기능 소개로
  $('#scroll-cue').addEventListener('click', () => {
    const target = $('#results').hidden ? $('.roadmap') : $('#results');
    target.scrollIntoView({ behavior: calm.matches ? 'auto' : 'smooth', block: 'start' });
  });
}
