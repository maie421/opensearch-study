# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요
`ll_product.market_name` 기준 **상품 유사도 검색**을 OpenSearch로 구현하는 학습 프로젝트. pnpm 모노레포(backend=NestJS, frontend=Next.js). 운영 레포 `llink-api`의 `apps/api/src/modules/search-indexer`가 동일 도메인의 실제 구현이며 설계 참고 대상이다.

## 주요 명령

**인프라 (OpenSearch)**
- 띄우기: `docker compose up -d --build` — OpenSearch(9200, nori 포함 커스텀 이미지) + Dashboards(5601)
- 내리기: `docker compose down` (데이터 유지) / `down -v` (데이터 삭제)

**개발 서버**
- 전체: `pnpm dev` (backend:3001 + frontend:3000 병렬) — 단, pnpm 래퍼가 detach될 수 있어 개별 실행이 더 안정적
- 개별: `pnpm dev:backend` / `pnpm dev:frontend`
- 빌드: `pnpm build` (`pnpm -r build`)
- 프론트 린트: `pnpm --filter frontend lint` (백엔드엔 테스트/린트 설정 없음)

**색인 (packages/backend 에서 실행)**
- DB 점검: `node scripts/inspect-db.mjs` — ll_product 스키마/건수/샘플
- 전량 재색인(blue-green): `node scripts/reindex-full.mjs [건수|all]` (기본 5000)
- 증분 색인(워터마크): `node scripts/reindex-incremental.mjs`

**동의어 (packages/backend 에서 실행)**
- 사전 생성: `node scripts/sheets-to-synonyms.mjs` — Google Sheet → `docker/opensearch/synonyms.txt` (덮어쓰기)
- 사전 검증: `node scripts/check-synonyms.mjs [--limit N]` — 동의어 도달성 점검(`_analyze`)
- 검색 품질 회귀: `node scripts/search-smoke.mjs` — `golden-queries.json` 골든셋 검증(하드 실패 시 exit 1)

## 아키텍처 — 검색 파이프라인

```
[MySQL ll_product]  ──reindex 스크립트──▶  [OpenSearch 별칭 'products']  ◀──search──  [NestJS API]  ◀──  [Next.js]
   (사내망/VPN 필요)    (.mjs, mysql2)         (실제: products_v<ts>)        ProductsService          카드 그리드
```

**핵심 설계 결정 (반드시 숙지):**

1. **검색은 별칭 `products`를 본다.** 실제 인덱스는 `products_v<timestamp>`이고 `products`는 그 별칭이다. `ProductsService`는 별칭명(`PRODUCTS_INDEX`)으로 쿼리하므로 blue-green 교체가 백엔드 코드에 투명하다. **버전 인덱스명을 코드에 하드코딩하지 말 것.**

2. **blue-green 전량 재색인** (`scripts/reindex-full.mjs`): 새 `products_v<ts>` 인덱스를 만들어(적재 중 `refresh_interval: -1`) 채운 뒤 → refresh → **alias atomic swap** → 옛 인덱스 정리(2세대 보존). 재색인 중에도 옛 인덱스가 검색을 처리해 무중단. **매핑/분석기/동의어 구조를 바꾸면 증분으론 반영 안 되고 반드시 이 전량 재색인이 필요하다.**

3. **워터마크 증분** (`scripts/reindex-incremental.mjs`): `scripts/.watermark.json`의 시각 이후 `updated_at`인 상품만 `_id`(=`seq`)로 upsert, `deleted_at` 채워진 건 delete. 워터마크는 DB `NOW()` 기준으로 갱신. 평소엔 증분, 가끔 전량(blue-green)으로 정합 보정하는 조합이 의도된 운영 방식.

4. **품절은 컬럼이 아니라 파생값.** `ll_product`에 `is_sold_out` 컬럼은 없다. `product_status === 40`(SOLD_OUT)을 색인 시 `is_sold_out`(boolean)으로 계산한다(`scripts/lib/index-config.mjs`의 `buildDoc`). 검색 기본은 품절 숨김(`filter is_sold_out:false`), `includeSoldOut=true`면 뒤로 정렬(`sort [is_sold_out asc, _score desc]`).

5. **동의어는 "색인 시점에" 적용.** 색인용 분석기 `korean_index`에 `synonym` 필터(`syn_index`)를 넣어 미리 펼쳐 저장하고, 검색용 `korean_search`는 동의어 없이 단순 매칭한다(쿼리 빠름 + synonym_graph clause 폭발 없음). 운영(llink-api)도 같은 이유로 색인 시점 방식(`name_search` 통합텍스트). **트레이드오프: 동의어 사전(`docker/opensearch/synonyms.txt`)을 바꾸면 전량 재색인(blue-green)이 필요**하다(검색 시점 방식이 아니므로 reload만으론 안 됨). 또 색인 시점 동의어는 synonym 토큰이 문서빈도를 늘려 `_score`(IDF)가 달라지는 부작용이 있다. 회사 부서가 동의어를 Google Sheet(4탭: 남성/여성/키즈/라이프, lvl2~lvl6 카테고리별 동의어)로 제공 → 변환·검증 파이프라인 구현 완료(아래 **동의어 사전 파이프라인** 섹션 참고).

## 동의어 사전 파이프라인 (생성 · 검증 · llink-api 적용 권고)

회사 부서가 동의어를 **Google Sheet**로 제공한다(공유 링크 "보기 가능", 4탭: 남성/여성/키즈/라이프, 세로축=lvl2~lvl6 카테고리 경로, 가로축=레벨별 동의어 셀). 이를 받아 검증까지 하는 파이프라인:

```
[Google Sheet]  ──sheets-to-synonyms.mjs──▶  [synonyms.txt]  ──reindex-full──▶  [products 인덱스]
  (CSV export,        (콤마셀=동의어그룹,         (bind 마운트,         (색인 시점 펼침)
   무인증 fetch)        정규화 후 dedup)         이미지 재빌드 불필요)
                                                      │
                          check-synonyms.mjs ◀────────┤  (_analyze 도달성 점검)
                          search-smoke.mjs   ◀────────┘  (골든셋 회귀)
```

**스크립트:**
- `scripts/sheets-to-synonyms.mjs` — 시트 ID/gid는 상수. 레이아웃이 탭마다 다르므로(키즈 +1컬럼, 라이프 헤더없음) **"한 셀을 콤마로 쪼개 2개 이상이면 동의어 그룹"** 휴리스틱 사용(카테고리 셀은 슬래시라 안전). 같은 그룹이 행마다 반복돼 정규화 후 dedup. Solr 양방향 포맷 한 줄=한 그룹. **외부 의존성 0**(Node 내장 fetch + 자체 CSV 파서).
- `scripts/check-synonyms.mjs` — 각 그룹의 **hub**(가장 많이 펼쳐지는 멤버)를 기준으로, `analyze(멤버, korean_search) ⊆ analyze(hub, korean_index)`이면 "도달 가능". 단일어/다중어 유실을 분리 집계. 대표어(첫 항목)는 nori에 분해돼 안 터지는 경우가 많아 hub 기준이 정확하다.
- `scripts/search-smoke.mjs` + `golden-queries.json` — 골든셋으로 실제 API 검색. `expect`(소프트 경고)/`forbid`(하드 실패, exit 1).

**오픈 전 권장 루프:** 사전 수정 → `sheets-to-synonyms.mjs` → `reindex-full.mjs 100`(소량) → `check-synonyms.mjs`(과소확장 점검) + `search-smoke.mjs`(과다확장 점검) → 통과 시 `reindex-full.mjs all`.

**검증으로 드러난 두 가지 구조적 문제 (색인 시점 동의어 + nori 조합 고유, llink-api도 동일하게 점검 필요):**
1. **과소 확장(사전에 적었는데 안 먹힘)** — 단일어 다수가 색인 토큰으로 라운드트립 실패. 원인: nori 형태소 분해(`아우터→터`, `가벼운→가볍`), 굴절형(`긴`이 `롱`과 안 묶임), 오타 변형(`자캣`, `처카`). 전체 사전 기준 단일어 유실 ~846개.
2. **과다 확장(엉뚱한 게 잡힘)** — 거대 조합어 그룹들이 `자켓/패딩/다운` 같은 공통 토큰을 공유해 서로 연결 → `재킷` 검색에 `부츠`가 섞이는 식. 또 다중어 조합어(`롱 다운재킷`)는 토큰 분해돼 라운드트립도 안 됨(유실 ~868개).

**llink-api 전환 설계서 (facet → category):** `docs/llink-api-category-synonym-migration.md` — 운영 레포의 현재 구조(검증된 파일·함수 위치) + 전환 작업 항목 + path→categoryCode 매칭 + 롤아웃 순서. llink-api 담당자 전달용.

**llink-api 적용 시 권고:**
- 운영도 색인 시점 통합텍스트(`name_search`) 방식이라 **위 두 문제가 그대로 재현**된다. 동의어 반영은 reload가 아니라 **전량 재색인 필요**.
- 적용 전후로 `check-synonyms.mjs`/`search-smoke.mjs`에 해당하는 **회귀 도구를 운영 분석기로 돌려** 단일어 유실·과다확장을 수치로 확인할 것.
- 과소확장 완화: nori에 안 잡히는 굴절형/오타는 양방향 대신 **`A => 표준형` 일방향 치환**으로 빼거나, 해당 항목만 검색 시점 동의어 병행 검토.
- 과다확장 완화: 거대 조합어 그룹은 사전 생성 단계에서 **분리/제외 규칙** 추가(공통 토큰 공유로 인한 전이 매칭 차단).

## 색인 스크립트 규칙 (.mjs)

- `scripts/*.mjs`는 NestJS 밖에서 `node`로 직접 실행하는 standalone 스크립트. 공통 로직(분석기 설정/매핑/`buildDoc`/접속 헬퍼)은 `scripts/lib/index-config.mjs`에 모은다.
- **`.env`를 직접 파싱한다.** pnpm 격리 구조라 `dotenv`가 스크립트에서 resolve 안 되므로 `loadEnv()`가 `packages/backend/.env`를 손수 읽는다. import 추가하지 말 것.
- DB 연결은 `dateStrings: true`로 DATETIME을 문자열로 받아 워터마크 비교를 단순화한다.
- 구버전 `create-index.mjs` + `index-products.mjs`는 구체 인덱스(별칭 아님) 방식으로, `reindex-full.mjs`로 대체됨(참고용).

## 환경/제약

- **DB 접속엔 사내망/VPN 필요** — `ll_product`는 내부 EKS NLB 호스트(`*.elb.ap-northeast-2.amazonaws.com:3306`)에 있다. 접속정보는 `packages/backend/.env`(gitignore됨), 예시는 `.env.example`.
- **OpenSearch는 로컬 학습용으로 보안 플러그인 비활성화** (`DISABLE_SECURITY_PLUGIN=true`) — http + 무인증으로 9200 접속. 운영 설정과 다름.
- **nori(한글 형태소)는 플러그인**이라 기본 이미지에 없다 → `docker/opensearch/Dockerfile`이 `analysis-nori`를 설치한 커스텀 이미지를 빌드한다.
- backend는 CORS를 `http://localhost:3000`(frontend)만 허용. API prefix는 `/api`.
