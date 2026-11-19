// 화면 이벤트와 렌더링. 외부 데이터는 모두 textContent로 넣는다 (innerHTML 사용 안 함).

import {
  CATEGORIES, HOUSEHOLD_OPTIONS, INCOME_BANDS, STATUS_LABEL,
  recommend, topCandidates, sortItems, todayString, evaluate, deadlineInfo,
} from './filter.js';
import { SIDO, SIGUNGU } from './regions.js';
import { ai, aiAvailable } from './ai.js';
import { favorites } from './favorites.js';

const RERANK_N = 20; // LLM에 보낼 후보 수 (R-2)
const LOW_SCORE = 30; // AI 적합도가 이보다 낮으면 추천 목록에서 '그 외'로 내린다

const $ = (sel) => document.querySelector(sel);

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

// ───────────────────────── 즐겨찾기 (★) ─────────────────────────

function starButton(id, { withLabel = false } = {}) {
  const btn = h('button', { type: 'button', class: 'star', 'data-fav-id': id });
  const paint = () => {
    const on = favorites.has(id);
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? '즐겨찾기 해제' : '즐겨찾기에 추가');
    btn.title = on ? '즐겨찾기 해제' : '즐겨찾기에 추가';
    btn.replaceChildren(h('span', { 'aria-hidden': 'true' }, on ? '★' : '☆'));
    if (withLabel) btn.append(on ? ' 즐겨찾기됨' : ' 즐겨찾기');
  };
  btn.paint = paint;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    try {
      favorites.toggle(id);
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
    : [h('li', { class: 'empty' }, ids.length ? '즐겨찾기한 지원금을 현재 데이터에서 찾지 못했어요.' : '아직 즐겨찾기한 지원금이 없어요. 카드의 ☆를 눌러 추가해 보세요.')]));
}

function setView(view) {
  state.view = view;
  for (const tab of document.querySelectorAll('[data-view]')) {
    const on = tab.dataset.view === view;
    tab.setAttribute('aria-selected', String(on));
    $(`#${tab.getAttribute('aria-controls')}`).hidden = !on;
  }
  if (view === 'favorites') renderFavorites();
}

function onFavoritesChange() {
  $('#fav-count').textContent = String(favorites.count());
  for (const btn of document.querySelectorAll('.star[data-fav-id]')) btn.paint?.();
  if (state.view === 'favorites') renderFavorites();
}

// ───────────────────────── 카드 ─────────────────────────

function card(it) {
  const b = it.benefit;
  const counts = { ok: 0, check: 0, fail: 0 };
  for (const c of it.checks) if (c.key !== 'deadline') counts[c.status] += 1;
  return h('li', { class: 'card-item' },
    starButton(b.id),
    h('button', { type: 'button', class: 'card-button', onclick: () => openDetail(it) },
      h('div', { class: 'card-top' },
        h('div', {},
          h('span', { class: 'cat' }, b.category),
          it.ai ? h('span', { class: 'ai-score' }, `AI 적합도 ${it.ai.score}`) : null,
          h('p', { class: 'card-title' }, b.name),
          h('p', { class: 'card-meta' }, b.agency || '')),
        ddayBadge(it.deadline)),
      b.amount ? h('p', { class: 'card-amount' }, b.amount) : null,
      it.ai?.reason ? h('p', { class: 'card-reason' }, it.ai.reason) : null,
      h('div', { class: 'card-checks' },
        it.checks.length ? [h('span', {}, `✅ ${counts.ok}`), h('span', {}, `⚠️ ${counts.check}`), h('span', {}, `❌ ${counts.fail}`)] : null,
        h('span', {}, '자세히 보기 →'))));
}

// ───────────────────────── 상세 보기 (E-1 ~ E-4) ─────────────────────────

const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

function condList(checks) {
  return h('ul', { class: 'conds' }, checks.map((c) => h('li', { class: `cond ${c.status}` },
    h('div', { class: 'cond-head' }, `${STATUS_LABEL[c.status]} · ${c.label}`),
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
    h('span', { class: 'cat' }, b.category),
    h('h2', { id: 'detail-title', class: 'detail-title' }, b.name),
    h('p', { class: 'card-meta' }, `${b.agency || ''} · 수집일 ${b.collected_at || '-'}`),
    h('div', { class: 'detail-section detail-actions' }, ddayBadge(it.deadline), starButton(b.id, { withLabel: true })),

    it.ai?.reason ? h('p', { class: 'card-reason' }, `AI 추천 이유: ${it.ai.reason}`) : null,
    explainBox,

    h('div', { class: 'detail-section' },
      h('h3', {}, '지원 정보'),
      h('dl', { class: 'kv' },
        b.summary ? [h('dt', {}, '지원 내용'), h('dd', {}, b.summary)] : null,
        b.amount ? [h('dt', {}, '지원 금액'), h('dd', {}, b.amount)] : null,
        [h('dt', {}, '신청 기간'), h('dd', {}, b.apply_period_text || (b.always_open ? '상시' : '공식 페이지에서 확인'))],
        b.apply_method ? [h('dt', {}, '신청 방법'), h('dd', {}, b.apply_method)] : null),
      url ? h('a', { class: 'official-link', href: url, target: '_blank', rel: 'noopener noreferrer' }, '공식 페이지에서 신청하기 ↗') : h('p', { class: 'hint' }, '공식 링크 정보가 없습니다. 담당 기관에 문의하세요.')),

    b.target_text ? h('div', { class: 'detail-section' }, h('h3', {}, '지원 대상 (원문)'), h('p', { class: 'detail-text' }, b.target_text)) : null,
    b.criteria_text ? h('div', { class: 'detail-section' }, h('h3', {}, '선정 기준 (원문)'), h('p', { class: 'detail-text' }, b.criteria_text)) : null,

    aiAvailable() ? h('div', { class: 'detail-section' },
      h('h3', {}, '이 지원금에 대해 질문하기 ', h('span', { class: 'badge-ai' }, 'AI')),
      h('div', { class: 'ask-row' }, askInput, askBtn),
      h('p', { class: 'hint' }, '답변은 이 지원금의 공고 원문만 근거로 합니다.'),
      askAnswer) : null,

    h('p', { class: 'disclaimer' }, '⚠️ 최종 자격은 공식 페이지에서 확인하세요.'),
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
for (const btn of document.querySelectorAll('[data-fav-sort]')) {
  btn.addEventListener('click', () => { state.favSort = btn.dataset.favSort; renderFavorites(); });
}
for (const tab of document.querySelectorAll('[data-view]')) {
  tab.addEventListener('click', () => setView(tab.dataset.view));
}
favorites.onChange(onFavoritesChange);
const dialog = $('#detail');
dialog.addEventListener('click', (e) => {
  if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
});
loadData().then(onFavoritesChange);
