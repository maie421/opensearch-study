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

5. **동의어는 "색인 시점에" 적용.** 색인용 분석기 `korean_index`에 `synonym` 필터(`syn_index`)를 넣어 미리 펼쳐 저장하고, 검색용 `korean_search`는 동의어 없이 단순 매칭한다(쿼리 빠름 + synonym_graph clause 폭발 없음). 운영(llink-api)도 같은 이유로 색인 시점 방식(`name_search` 통합텍스트). **트레이드오프: 동의어 사전(`docker/opensearch/synonyms.txt`)을 바꾸면 전량 재색인(blue-green)이 필요**하다(검색 시점 방식이 아니므로 reload만으론 안 됨). 또 색인 시점 동의어는 synonym 토큰이 문서빈도를 늘려 `_score`(IDF)가 달라지는 부작용이 있다. 회사 부서가 동의어를 엑셀로 제공 → 변환 스크립트(`scripts/excel-to-synonyms.ts`)는 향후 작성 예정.

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
