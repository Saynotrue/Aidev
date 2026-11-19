// 받을지도 아이콘 세트 (직접 그린 SVG, 이모지 대신 사용).
// - UI 아이콘(i-*): 24×24 선 아이콘. 색·굵기·채움은 CSS(.icon)가 정한다 (currentColor).
// - 분야 일러스트(ill-*): 64×64, 첫 화면 지도 그림과 같은 '검은 외곽선 + 파스텔' 스타일.
// 스프라이트를 문서에 한 번 넣고 <svg><use href="#i-..."/></svg>로 참조한다.

const UI = {
  'arrow-right': '<path d="M5 12h13"/><path d="M12.5 6.5 18 12l-5.5 5.5"/>',
  'chevron-left': '<path d="M14.5 6 8.5 12l6 6"/>',
  'chevron-right': '<path d="M9.5 6l6 6-6 6"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  star: '<path d="M12 3.3l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.7l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z"/>',
  warning: '<path d="M10.3 4.4 2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.2"/><path d="M12 17h.01"/>',
  'status-ok': '<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.7 2.7L16.2 9.5"/>',
  'status-check': '<circle cx="12" cy="12" r="9"/><path d="M12 7.6v5.2"/><path d="M12 16.3h.01"/>',
  'status-fail': '<circle cx="12" cy="12" r="9"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17.2h.01M12 17.2h.01"/>',
  download: '<path d="M12 4v10.5"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 16.5v1.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-1.5"/>',
  scale: '<path d="M12 4v15.5M7.5 19.5h9M5 7.5h14"/><circle cx="12" cy="4.6" r="1.1"/><path d="M5 7.5 2.4 13a2.8 2.8 0 0 0 5.2 0z"/><path d="M19 7.5 16.4 13a2.8 2.8 0 0 0 5.2 0z"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-8.5 8.5"/><path d="M18 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M19.5 14.6A8 8 0 1 1 9.4 4.5a6.4 6.4 0 0 0 10.1 10.1z"/>',
  chat: '<path d="M5.5 4.5h13a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H11l-5 4v-4h-.5a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2z"/><path d="M8.5 10.8h.01M12 10.8h.01M15.5 10.8h.01"/>',
  filter: '<path d="M4 5h16l-6.2 7.6v5.6L10.2 20v-7.4z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="M15.5 15.5 20.5 20.5"/>',
  ask: '<path d="M12 3.5a8.5 8.5 0 1 1-4.3 15.8L3.5 20.5l1.2-4.1A8.5 8.5 0 0 1 12 3.5z"/><path d="M9.7 9.6a2.4 2.4 0 1 1 3.4 2.2c-.7.3-1.1.9-1.1 1.6v.2"/><path d="M12 16.4h.01"/>',
  flag: '<path d="M5.5 21V4"/><path d="M5.5 4.5h11.5l-2.3 4 2.3 4H5.5"/>',
  map: '<path d="M9 4.5 3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
  hand: '<path d="M9.5 11.5V5a1.6 1.6 0 0 1 3.2 0v5.5"/><path d="M12.7 10V9a1.6 1.6 0 0 1 3.2 0v1.5"/><path d="M15.9 10.5a1.6 1.6 0 0 1 3.2 0V15a6 6 0 0 1-6 6h-1.3a5.2 5.2 0 0 1-4.2-2.1l-3.2-4.3a1.6 1.6 0 0 1 2.5-2l2.8 2.9V11.5"/>',
  sparkle: '<path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z"/>',
};

// 분야 일러스트: 생활, 주거, 취업, 금융, 교육·장학금
const O = 'stroke="#1B1B1F" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"';
const ILL = {
  life: `<g ${O}>
    <path d="M9 25h24l-2.2 28H11.2z" fill="#FF8FB1"/>
    <path d="M15.5 25v-4.5a5.5 5.5 0 0 1 11 0V25" fill="none"/>
    <path d="M16 36h10" fill="none"/>
    <path d="M36 32h18l-2 22H38z" fill="#FFFBF2"/>
    <path d="M37.1 40.5h15.8l-.7 7.5H37.8z" fill="#FFC94A"/>
    <path d="M34 27.5h22v4.5H34z" fill="#5ED3C3"/>
    <path d="M41 22c-1.8-2.4 1.8-3.6 0-6.5M48 22c-1.8-2.4 1.8-3.6 0-6.5" fill="none"/>
  </g>`,
  home: `<g ${O}>
    <path d="M11 30v23h30V30" fill="#FFFBF2"/>
    <path d="M5 32 26 12l21 20-4 3.5L26 19.5 9 35.5z" fill="#FF6F91"/>
    <path d="M21 41h10v12H21z" fill="#FFC94A"/>
    <path d="M33 31h6v6h-6z" fill="#BDEFE6"/>
    <circle cx="51" cy="42" r="6.5" fill="#FFC94A"/>
    <circle cx="51" cy="42" r="2" fill="#FFFBF2"/>
    <path d="M46.5 46.5 39 54m2.8-2.8 2.6 2.6M44.5 48.5l2 2" fill="none"/>
  </g>`,
  job: `<g ${O}>
    <path d="M19 22v-3.5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3V22" fill="none"/>
    <rect x="7" y="22" width="38" height="28" rx="5" fill="#8EC5FF"/>
    <path d="M7 33.5h38" fill="none"/>
    <rect x="22.5" y="30" width="7" height="7" rx="1.5" fill="#FFC94A"/>
    <path d="M47 56 57.5 33.5l5 2.3L52 58.3l-5.6 2.4z" fill="#FFC94A"/>
    <path d="M57.5 33.5l1.4-3a2.7 2.7 0 0 1 5 2.3l-1.4 3z" fill="#FF8FB1"/>
    <path d="M47 56l-.6 4.7 4.2-2.1" fill="#1B1B1F"/>
  </g>`,
  money: `<g ${O}>
    <path d="M6 44v6c0 2.8 6 5 13.5 5S33 52.8 33 50v-6" fill="#FFC94A"/>
    <ellipse cx="19.5" cy="44" rx="13.5" ry="5" fill="#FFD877"/>
    <path d="M6 37v6c0 2.8 6 5 13.5 5S33 45.8 33 43v-6" fill="#FFC94A"/>
    <ellipse cx="19.5" cy="37" rx="13.5" ry="5" fill="#FFD877"/>
    <ellipse cx="44" cy="37" rx="15" ry="11.5" fill="#FF8FB1"/>
    <path d="M36 27.5l-1.5-6 6 3.5" fill="#FF8FB1"/>
    <ellipse cx="58" cy="37" rx="3" ry="4" fill="#FFC2D3"/>
    <path d="M38 47.5v5h4v-4M48 48.5v4h4v-5.5" fill="#FF8FB1"/>
    <path d="M40 28.5h8" fill="none"/>
    <circle cx="51" cy="33" r="1.2" fill="#1B1B1F"/>
    <circle cx="44" cy="14" r="6" fill="#FFC94A"/>
    <path d="M41.2 12.4l1.3 4 1.5-3.2 1.5 3.2 1.3-4" fill="none" stroke-width="1.6"/>
  </g>`,
  study: `<g ${O}>
    <rect x="12" y="44" width="34" height="8" rx="2" fill="#5ED3C3"/>
    <rect x="16" y="52" width="34" height="8" rx="2" fill="#FF8FB1"/>
    <path d="M40 46.5v3.5M44 54.5v3.5" fill="none"/>
    <path d="M17 24v9c7 5.5 19 5.5 26 0v-9" fill="#B9A6FF"/>
    <path d="M4 20 30 9.5 56 20 30 30.5z" fill="#B9A6FF"/>
    <path d="M52 21.5v11" fill="none"/>
    <circle cx="52" cy="35" r="2.6" fill="#FFC94A"/>
  </g>`,
};

const sym = (id, view, body) => `<symbol id="${id}" viewBox="${view}">${body}</symbol>`;

/** 스프라이트를 문서에 한 번 넣는다 (모듈을 불러오면 바로 실행). */
function mountSprite() {
  if (typeof document === 'undefined' || document.getElementById('icon-sprite')) return;
  const html = `<svg id="icon-sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">${
    Object.entries(UI).map(([k, v]) => sym(`i-${k}`, '0 0 24 24', v)).join('')
  }${Object.entries(ILL).map(([k, v]) => sym(`ill-${k}`, '0 0 64 64', v)).join('')}</svg>`;
  document.body.insertAdjacentHTML('afterbegin', html);
}
mountSprite();

const NS = 'http://www.w3.org/2000/svg';

/** UI 아이콘 요소. icon('star', 'is-filled') */
export function icon(name, extraClass = '') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', `icon icon-${name} ${extraClass}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

const CATEGORY_ILL = { 생활: 'life', 주거: 'home', 취업: 'job', 금융: 'money', '교육·장학금': 'study' };

/** 분야 일러스트 요소 */
export function categoryArt(category, extraClass = '') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', `ill ${extraClass}`.trim());
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#ill-${CATEGORY_ILL[category] || 'life'}`);
  svg.append(use);
  return svg;
}

export const ICON_NAMES = Object.keys(UI);
