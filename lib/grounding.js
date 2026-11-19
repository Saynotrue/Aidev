// G3/E-3: LLM이 제시한 '원문 근거'가 실제 원문에 있는지 검사한다.
// 원문에 없는 인용은 지우고, 그 근거로 내린 판단은 '확인 필요'로 낮춘다.

const norm = (s) => String(s || '')
  .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  .replace(/[·ㆍ∙•]/g, '·')
  .replace(/\s+/g, '')
  .trim();

/** 지원금 원문 필드를 하나의 근거 문자열로 합친다. */
export function sourceText(benefit) {
  return [
    benefit.name, benefit.summary, benefit.amount, benefit.target_text,
    benefit.criteria_text, benefit.apply_method, benefit.apply_period_text,
  ].filter(Boolean).join('\n');
}

/** quote가 source 안에 (공백 무시) 그대로 있는지 */
export function isGrounded(quote, source) {
  const q = norm(quote);
  if (q.length < 2) return false;
  return norm(source).includes(q);
}

/**
 * explain 결과의 각 판단을 원문과 대조한다.
 * - 근거 인용이 원문에 없으면 인용을 지우고 status를 'check'로 바꾼다.
 * - 근거 없이 '충족'·'미충족'을 단정한 경우도 'check'로 바꾼다.
 */
export function enforceGrounding(checks, benefit) {
  const src = sourceText(benefit);
  return checks.map((c) => {
    const quotes = (c.evidence || []).filter((q) => isGrounded(q, src));
    const dropped = (c.evidence || []).length - quotes.length;
    let { status, reason } = c;
    if (quotes.length === 0 && status !== 'check') {
      status = 'check';
      reason = `${reason} (원문 근거를 찾지 못해 '확인 필요'로 표시합니다.)`;
    }
    return { ...c, status, reason, evidence: quotes, dropped_evidence: dropped };
  });
}
