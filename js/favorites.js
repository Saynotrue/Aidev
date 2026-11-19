// 즐겨찾기(★): 지원금 id 목록을 브라우저 쿠키에 저장한다. 서버로 보내는 개인정보는 없다.
// 쿠키 한 개는 약 4KB까지이므로 최대 개수를 제한한다 (id ≈ 25자 기준 150개 ≈ 3.9KB).

export const COOKIE_NAME = 'hr_favorites';
export const MAX_FAVORITES = 150;
const MAX_AGE = 60 * 60 * 24 * 365; // 1년
const SEP = '|';

/** 쿠키 문자열(document.cookie)에서 즐겨찾기 id 배열을 꺼낸다. */
export function parseFavorites(cookieString = '') {
  const pair = cookieString.split(/;\s*/).find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!pair) return [];
  const raw = pair.slice(COOKIE_NAME.length + 1);
  const ids = [];
  for (const part of raw.split(SEP)) {
    try {
      const id = decodeURIComponent(part).trim();
      if (id && !ids.includes(id)) ids.push(id);
    } catch { /* 깨진 값은 무시 */ }
  }
  return ids.slice(0, MAX_FAVORITES);
}

/** id 배열을 Set-Cookie 문자열로 만든다. 빈 배열이면 쿠키를 지운다. */
export function serializeFavorites(ids, { secure = false } = {}) {
  const value = ids.slice(0, MAX_FAVORITES).map(encodeURIComponent).join(SEP);
  const attrs = [`path=/`, `max-age=${ids.length ? MAX_AGE : 0}`, 'SameSite=Lax'];
  if (secure) attrs.push('Secure');
  return `${COOKIE_NAME}=${value}; ${attrs.join('; ')}`;
}

// ── 브라우저용 ──

const listeners = new Set();
let cache = null;

function load() {
  if (cache == null) cache = typeof document === 'undefined' ? [] : parseFavorites(document.cookie);
  return cache;
}

function save(ids) {
  cache = ids;
  if (typeof document !== 'undefined') {
    document.cookie = serializeFavorites(ids, { secure: location.protocol === 'https:' });
  }
  for (const fn of listeners) fn(ids);
}

export const favorites = {
  list: () => [...load()],
  has: (id) => load().includes(id),
  count: () => load().length,
  /** 추가/해제 후 새 상태(true=즐겨찾기됨)를 돌려준다. 한도 초과면 에러. */
  toggle(id) {
    const ids = load();
    if (ids.includes(id)) {
      save(ids.filter((x) => x !== id));
      return false;
    }
    if (ids.length >= MAX_FAVORITES) throw new Error(`즐겨찾기는 최대 ${MAX_FAVORITES}개까지 저장할 수 있어요.`);
    save([id, ...ids]); // 최근에 추가한 것이 앞으로
    return true;
  },
  onChange(fn) { listeners.add(fn); },
};
