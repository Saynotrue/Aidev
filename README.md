# 혜택레이더 (가칭)

AI 기반 청년·대학생 맞춤 정부지원금 추천 서비스 (장학금 포함). 요구사항은 [prd.md](prd.md)를 참고하세요.

**기술 제약 (PRD 8.1)**: HTML, CSS, Vanilla JavaScript만 사용합니다. 프레임워크, 외부 라이브러리, 빌드 도구, npm 의존성이 없습니다. LLM(NVIDIA API)도 SDK 없이 `fetch`로 호출합니다.

## 빠른 시작

Node.js 20.12 이상이 필요합니다.

```bash
# .env 에 NVIDIA_API_KEY, DATA_GO_KR_SERVICE_KEY 입력 (선택: 없으면 AI 없이 규칙 기반으로 동작)
npm run dev               # http://localhost:5173
```

`data/benefits.json`이 없으면 화면은 **샘플 데이터**(`data/benefits.sample.json`, 이름에 `[샘플]` 표시)로 동작합니다.

## 데이터 수집 (`data/benefits.json` 만들기)

1. 공공데이터포털에서 장학금 CSV 2종을 내려받아 `csv/` 폴더에 둡니다. 파일명으로 자동 탐색합니다.
   - 한국장학재단 학자금지원정보(대학생) → 파일명에 `학자금지원정보`
   - 한국장학재단 국가장학금 및 학자금대출 지원 정보 → 파일명에 `국가장학금`
2. `.env`에 `DATA_GO_KR_SERVICE_KEY`(공공서비스(혜택) API), `NVIDIA_API_KEY`를 넣습니다.
3. 실행합니다.

```bash
npm run collect                         # 전체: 정부24 API + CSV 2종 + LLM 조건 구조화
npm run collect -- --skip-gov24         # API 승인 전: CSV만
npm run collect -- --no-llm             # LLM 없이 (코드로 알 수 있는 조건만)
npm run collect -- --llm-limit 30       # LLM 호출 수 제한 (비용 확인용)
npm run collect -- --from-cache         # 공공데이터 API 대신 지난번 원본 캐시 사용 (일일 호출 수 절약)
npm run collect -- --max-pages 1        # 정부24 API 1페이지만 (테스트용)
```

- 마감된 항목은 저장 단계에서 빠지고, 브라우저에서도 한 번 더 거릅니다.
- LLM 구조화 결과는 `data/cache/structured.json`에 캐시되어, 원문이 바뀐 항목만 다시 호출합니다.
- 정부24 API의 **엔드포인트·필드명·지원조건 코드**는 공개 명세 기준으로 넣어 두었습니다. 활용신청 후 공식 명세서와 대조해 [scripts/lib/gov24.js](scripts/lib/gov24.js)의 `FIELD`, `COND` 상수를 확인하세요.

## 구조

```
index.html              조건 입력 + 결과 + 상세 보기(<dialog>) + AI 질문
css/style.css           반응형(360px~), 다크 모드
js/main.js              화면 이벤트, 렌더링 (innerHTML 미사용)
js/filter.js            규칙 필터(R-1), 조건별 ✅/⚠️/❌ 판단(E-2), 후보 점수(R-2), D-day(R-4)
js/regions.js           시·도 정규화
js/ai.js                LLM 프록시 호출 (API 키 없음)
api/ai.js               Vercel 서버리스 함수 (LLM 프록시)
lib/ai-handler.js       프록시 본체: rerank / explain / ask / parse
lib/llm.js              NVIDIA API 최소 클라이언트 (fetch, JSON 추출·검사, 재시도)
lib/grounding.js        AI가 제시한 '원문 근거'가 실제 원문에 있는지 검사 (G3)
scripts/collect.js      수집·정규화·구조화 → data/benefits.json
scripts/lib/            gov24.js, kosaf.js, csv.js, normalize.js, structure.js
scripts/dev-server.js   로컬 서버 (정적 파일 + /api/ai)
scripts/make-sample.js  샘플 데이터 생성 (npm run sample)
tests/                  node --test (npm test)
```

## 추천 흐름

1. **규칙 필터 (브라우저)**: 마감·나이·지역·학적이 명백히 맞지 않으면 제외. 정보가 없거나 "모름"이면 제외하지 않고 ⚠️ 확인 필요.
2. **후보 추림 (브라우저)**: 조건 충족 수 + 키워드 + 관심 분야 점수로 상위 20개.
3. **AI 재정렬 (프록시)**: 상위 20개 원문을 LLM에 넣어 적합도(0~100)와 한 줄 이유. 30점 미만은 "그 외"로 내림.
4. **AI 설명 (상세 보기 시)**: 조건별 ✅/⚠️/❌와 원문 인용. 인용이 원문에 없으면 서버가 지우고 ⚠️로 낮춤.

AI 프록시가 없거나 실패하면(예: GitHub Pages, 키 없음) 1~2단계 결과와 규칙 기반 판단만 보여 줍니다.

## 배포 (Vercel)

1. GitHub 저장소를 Vercel에 연결합니다 (빌드 명령 없음).
2. 프로젝트 환경 변수에 `NVIDIA_API_KEY`를 넣습니다. 필요하면 `ALLOWED_ORIGIN`에 배포 주소를 넣어 다른 사이트에서의 프록시 호출을 막습니다.
3. `data/benefits.json`을 커밋합니다. 프록시가 이 파일에서 원문을 읽습니다 (`vercel.json`의 `includeFiles`).

## AI 설정 (NVIDIA API)

[build.nvidia.com](https://build.nvidia.com/)의 호스팅 API(`https://integrate.api.nvidia.com/v1/chat/completions`, OpenAI 호환)를 씁니다.

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `NVIDIA_API_KEY` | (필수) | build.nvidia.com에서 발급 |
| `NVIDIA_MODEL` | `nvidia/nemotron-3.5-lightning-30b-a3b,z-ai/glm-5.3-flash` | 요청 단계(재정렬·설명·질문·자연어 입력). 쉼표로 예비 모델 지정 |
| `NVIDIA_MODEL_COLLECT` | `z-ai/glm-5.3-flash,nvidia/nemotron-3.5-lightning-30b-a3b` | 수집 단계(조건 구조화). 느려도 정확한 모델 |
| `NVIDIA_TEMPERATURE` | `0.1` | 0~1 |
| `ALLOWED_ORIGIN` | (없음) | 배포 주소에서 온 요청만 프록시가 받도록 제한 |

**모델 고르기**: `npm run check-models` (또는 `npm run check-models -- 모델A 모델B`)로 같은 한국어 과제를 시험해 사용 가능 여부, 응답 시간, 원문 인용 정확도를 비교합니다.

- **모델은 수시로 단종됩니다** (예: `meta/llama-3.3-70b-instruct`는 2026-08-26 단종, 410 오류). 쉼표로 여러 모델을 주면 단종(410)·권한 없음(404) 모델을 건너뛰고 다음 모델을 씁니다.
- **공개 모델 목록에 있어도 계정에 따라 404**일 수 있습니다 (`Function ... Not found for account`). check-models로 확인하세요.
- **호스팅 모델 대부분이 추론(thinking) 모델**이라 그대로 쓰면 10~80초가 걸립니다. 모델마다 추론을 끄는 옵션이 달라 [lib/llm.js](lib/llm.js)의 `MODEL_OPTIONS`에 실측값을 넣어 두었습니다. 새 모델을 쓰면 여기에 추가하세요.
- 실측(2026-11, 실제 장학금 데이터): nemotron-3.5-lightning은 설명 10~13초에 인용이 모두 원문과 일치했고, glm-5.3-flash는 판단이 더 정교하지만 설명 1건에 약 50초가 걸려 수집 단계에만 씁니다. 재정렬(후보 17~20개)은 약 16초로 PRD 목표(10초)보다 느립니다. 화면은 규칙 기반 결과를 먼저 보여 주고 AI 순위를 나중에 반영합니다.
- 호스팅 API 문서에 JSON 스키마 강제 옵션이 없어서, 프롬프트에 스키마를 넣고 응답에서 JSON을 꺼내 검사합니다. 형식이 틀리면 오류를 알려 주고 한 번 더 요청합니다.
- 응답 길이는 최대 4096 토큰입니다. 재정렬 이유는 40자 이내로 제한합니다.
- 조건 구조화는 항목당 1회 호출이고, 결과는 캐시됩니다 (모델을 바꾸면 자동 무효화). 처음엔 `--llm-limit 10`으로 확인하세요.

## 보안·개인정보

- API 키는 `.env`(로컬)와 Vercel 환경 변수에만 둡니다. 브라우저 코드에는 없습니다.
- 사용자 조건은 저장하지 않습니다. 프록시는 정해진 조건 필드만 남기고(`sanitizeProfile`) 나머지는 버린 뒤 LLM에 보냅니다.
- 개발 서버는 `index.html`, `css/`, `js/`, `data/benefits*.json`만 제공합니다 (`.env`, `scripts/`, `lib/`는 404).

## 남은 확인 사항

- 정부24 API 명세 대조 (`FIELD`, `COND`), 실제 `서비스분야` 값 보고 분야 분류 규칙 조정 ([scripts/lib/normalize.js](scripts/lib/normalize.js))
- 학자금 지원구간과 기준중위소득 % 비교 방식 (지금은 지원구간 조건만 단정, 중위소득 %는 ⚠️) — PRD 14 미정 사항
- 수집 스크립트(Node.js)와 서버리스 프록시를 "HTML/CSS/JS만 사용" 범위로 인정하는지 — PRD 14 미정 사항
