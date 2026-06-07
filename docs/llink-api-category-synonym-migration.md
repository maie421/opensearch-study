# llink-api 동의어 전환 설계: facet → category

> 목적: llink-api `search-indexer`의 동의어 체계를 **속성 facet 기반(brand/color/material/gender/size)** 에서 **카테고리 노드 기반**으로 전환한다.
> 이 문서는 opensearch-study(학습 레포)에서 실제 코드·DB를 확인한 결과를 담은 **llink-api 담당자 전달용** 설계서다.
> 검증 대상 경로: `apps/api/src/modules/search-indexer/` (별도 표기 없으면 이 기준).

---

## 0. 결론 요약 (TL;DR)

- llink-api는 동의어를 **검색 시점 `synonym_graph`** 로 적용한다(색인 시점 아님). 색인 분석기 `kr_std`엔 동의어 없음.
- **시트의 카테고리 노드명이 실제 `ll_category`와 100% 일치**한다(다어절 조합 363/363 포함). 즉 `데님 자켓`·`숏 레깅스` 같은 **조합은 전부 이미 카테고리 노드**다.
- 따라서 동의어를 **"노드별 순수 동의어 그룹"** 으로 `ll_category.keyword` **한 컬럼**에 저장한다. 새 컬럼·`marketKeyword` 재활용·조합 생성 **불필요**.
- 과다 확장(`롱`→`재킷`류)은 (a) 검색 시점 synonym_graph + (b) **레벨별로 쪼갠 순수 그룹**(`롱`은 `긴/long`하고만 묶임, garment와 안 섞임) 으로 **이중 차단**된다.
- 속성 facet(brand/color/material/gender/size) 동의어는 **전부 폐지**(확정). size_norm 정규화 필드·보조 인덱스 거취는 별도 결정(9장).

---

## 1. 현재 구조 (검증된 사실)

### 1-1. 인덱스 / 동의어 주입
- 인덱스 6종: `goods`(메인) + 보조 5종 `goods_brand` / `goods_color` / `goods_gender` / `goods_material` / `goods_category`.
- 동의어·user_dict는 **`goods` 인덱스에만** 주입. (`services/opensearch-admin.service.ts` `createIndexes`, `if (kind === 'goods')`)
- alias atomic swap + 직전 1세대 보존 cleanup 으로 blue-green 무중단 재색인. (`swapAliases`, `cleanupOldIndexes`)

### 1-2. 동의어 적용 = 검색 시점 synonym_graph
`assets/mappings/goods.json`:
- `filter`: `syn_name`, `syn_brand`, `syn_color`, `syn_material`, `syn_gender`, `syn_size` — 전부 `type: synonym_graph`, 빈 배열(런타임 주입).
- 색인 분석기 `kr_std` = `nori_user_dict` + `nori_part_of_speech`, `nori_readingform`, `lowercase` (**동의어 없음**).
- 검색 분석기 `*_search_syn` 들만 `syn_*` 필터를 단다 (예: `name_search.search_analyzer = kr_std_search_syn`).
- 토크나이저 `nori_user_dict`는 `user_dictionary_rules`(런타임 주입)로 단일토큰을 atomic 유지(빨간→빨갛, 아우터→터 분해 방지).

### 1-3. 동의어 소스 머지 (txt + DB)
`services/full-reindex.service.ts` `buildSynonymsMap()`:
```
syn_name     = merge(txt[synonyms.txt, synonym_size.txt, synonym_fit.txt], DB findCategorySynonymLines)
syn_brand    = merge(synonym_brand.txt,     DB findBrandSynonymLines)
syn_color    = merge(synonym_ko_colors.txt, DB findColorSynonymLines)
syn_material = merge(synonym_material.txt,   DB findMaterialSynonymLines)
syn_gender   = merge(synonym_gender.txt+en,  DB findGenderSynonymLines)
syn_size     = synonym_size.txt (DB 없음)
```
- txt 로더: `services/synonym-loader.service.ts` (`CATEGORY_FILES`, `loadAll`, `buildUserDictRules`, `buildSizeNormMap`).
- **DB 카테고리 동의어:** `repositories/search-indexer.repository.ts` `findCategorySynonymLines()` → `ll_category.keyword`만 읽어 콤마구분 라인 반환.

### 1-4. 문서 빌드
`services/document-builder.service.ts`:
- **`name_search`** (`buildUnifiedSearchText`): 색인 시점에 상품명 변형 + 브랜드 변형 + **카테고리 각 level 이름(lv1~leaf, path)** + 색상/성별/소재 변형을 한 텍스트로 합침(주석: *"검색 단계 syn_name 의존도를 낮춰 maxClauseCount 폭발 방지"*). 검색 시 `syn_name` 추가 적용.
- **`category_keywords`** (`collectCategoryKeywords`): `categoryCode`를 4자리씩 잘라 ancestor 노드를 따라가며 각 `Category.keyword` + `Category.marketKeyword`를 콤마 분해 → multi-valued `keyword` 필드(정확매치).
- **`product_keywords`** (`collectProductKeywords`): 상품의 `search/marketSearch/manualSearch` 콤마 분해 → 정확매치 keyword.
- **`size_norm`** (`extractSizeNorms`+`buildSizeNormMap`): option_values를 canonical 사이즈로 정규화.

### 1-5. categoryCode 구조
- `Category` 엔티티(`shared/domain/product-meta/category/entities/category.entity.ts`, 테이블 `ll_category`): `categoryCode`, `name`, `nameEn`, `keyword`(주석 "키워드"), `marketKeyword`(주석 **"오픈마켓 키워드"**).
- **`categoryCode` = 4자리 계층 prefix** (`0001` > `00010002` > …). ancestor는 prefix slice로 도출.
- 색인 시 leaf + 모든 4자리 prefix ancestor를 `categoryByCode` 맵에 로드(`repository.findCategoriesForProducts`).

---

## 2. 핵심 발견 — 조합은 이미 카테고리 노드 (100% 검증)

opensearch-study에서 시트 4탭의 카테고리 노드명을 추출해 `ll_category.name`(DB 1,212행)과 대조한 결과:

```
시트 카테고리 노드명 704개 (다어절=조합 363 / 단어 341)
  전체 매칭   : 704/704 = 100.0%
  ★조합(다어절): 363/363 = 100.0%   ← 데님 자켓, 봄버 자켓, 숏 레깅스 …
```
→ **시트의 모든 조합이 실제 `ll_category` 노드.** 부서가 택소노미에서 시트를 뽑았기 때문. (매칭은 이름 정규화+공백무시 기준. 실제 적재는 동명이품 때문에 **전체 경로**로 노드 특정 필요 — 5장.)

### 그래서: "노드별 순수 동의어 그룹" 으로 해결 (새 컬럼 불필요)

각 카테고리 노드의 `keyword`에 **그 노드 레벨의 순수 동의어만** 넣는다. 조합은 택소노미 계층 + ancestor walk가 결합한다.

| 노드 | `ll_category.keyword` (순수 그룹) |
|---|---|
| `자켓` (lv5) | `자켓, 재킷, 점퍼, JACKET` |
| `데님 자켓` (lv6) | `데님, 청, 청데님, DENIM` (수식어 동의어만) |
| `롱 패딩` | `롱, 긴, LONG` |

- **`keyword` → `syn_name` + `category_keywords` 둘 다로 운반**(1-3, 1-4 기존 코드 그대로).
- `marketKeyword`(="오픈마켓 키워드")는 **건드리지 않는다.** 별도 용도이며 본 작업과 무관.

### 왜 과다 확장이 안 생기나 (학습 레포와 다른 점)
1. **검색 시점 synonym_graph** — 동의어가 문서가 아니라 쿼리에만 적용. 색인 측 토큰 폭발(`롱 부츠`→`재킷`) 원천 차단.
2. **레벨별 순수 그룹** — `롱`은 `{롱,긴,long}` 하고만 묶임. `재킷/자켓`과 절대 같은 그룹이 아님. 따라서 `롱` 쿼리는 "길이가 긴" 상품만 확장 매칭하고 자켓을 끌어오지 않음.

> 학습 레포 재현 사고: 시트의 거대 조합 그룹(`롱 다운 재킷, 롱다운자켓 …`)을 한 그룹+색인 시점으로 넣었더니 `"롱 부츠"` 색인 토큰이 74개로 폭발하며 `재킷`이 섞임. 본 설계는 (a)+(b)로 둘 다 회피.

---

## 3. 목표 구조 (After)

```
goods 인덱스
├─ name_search (text)         syn_name (검색시점 synonym_graph) 유지
│     소스: synonyms.txt 등 + ll_category.keyword(노드별 순수 그룹)   ← 시트가 채움
├─ category_keywords (keyword 정확매치)
│     소스: ll_category.keyword(+marketKeyword 기존) ancestor 전파       ← 시트가 채움
├─ product_keywords (keyword 정확매치)   기존 유지
├─ nori_user_dict.user_dictionary_rules   ← 시트 단일토큰으로 재소싱 (4-④)
└─ 제거: syn_brand / syn_color / syn_material / syn_gender / syn_size
         + 대응 search 분석기 (brand_*/color_kr/material_kr/gender/size _search_syn)
```

속성 facet 폐지 리스크 완화: 브랜드/색상/소재/성별 변형은 이미 `buildUnifiedSearchText`가 `name_search`에 색인 시점 베이크하므로(예: brand.keyword="샤넬,Chanel"), 전용 `syn_*` facet을 빼도 `name_search` 경로로 상당부분 매칭 유지. (전용 필드 `brand_title.text` 등의 동의어 매칭은 사라짐 — 폐지 결정 사항.)

---

## 4. 전환 작업 항목

### ① [데이터·핵심] 시트 → `ll_category.keyword` 적재 (노드별 순수 그룹)
- 시트 각 행의 레벨별 동의어 셀(단독/조합어 구분 없이)을 **그 레벨 노드의 동의어**로 본다.
- 시트 카테고리 **전체 경로**(예: `남성>의류>아우터>자켓`)를 `ll_category.name` 계층으로 매칭해 `categoryCode`를 찾고, 그 노드의 `keyword`에 동의어 그룹을 기록. 같은 노드가 여러 행 반복 → `categoryCode` 기준 dedup(합집합).
- 적재 후엔 **기존 파이프라인이 코드 변경 없이** `syn_name` + `category_keywords`로 운반.
- 변환 로직: opensearch-study `packages/backend/scripts/sheets-to-synonyms.mjs`를 "글로벌 평탄화" → **"노드별 산출(path→code)"** 로 개조. 산출물 `{ categoryCode, keyword }[]` → DB upsert.

### ② [코드·소] facet 가지 제거 — `full-reindex.service.ts buildSynonymsMap`
- `findBrand/Color/Gender/MaterialSynonymLines` 호출 + `syn_brand/color/material/gender/size` 머지 제거. `syn_name`만 남김.

### ③ [코드·소] 매핑 정리 — `assets/mappings/goods.json`
- `filter`에서 `syn_brand/color/material/gender/size` 제거.
- 분석기 `brand_kr/brand_en/material_kr/color_kr/gender/size _search_syn` 제거.
- 해당 필드 `search_analyzer`를 동의어 없는 분석기(`kr_std`/`en_std`/`kw_lc`)로 환원.
- `synonym-loader.service.ts` `CATEGORY_FILES`에서 폐지 facet 항목 제거.

### ④ [코드·주의] user_dict 재소싱 — `synonym-loader.buildUserDictRules`
- 현재 color/gender/material/size txt single-token으로 nori 분해 방지(아우터→터). 이 사전들이 폐지되므로 **`ll_category.keyword`의 single-token 한/영으로 재소싱** 필요.
- 규칙 유지: 공백 없는 토큰, 길이 2+, 한/영 포함. 합성어 atomic화 금지(`CASE-009` 롤백 사유).

### ⑤ [운영] blue-green 전량 재색인 + 검증
- 분석기 구조 변경 → 증분 불가, 전량 재색인 필수(`full-reindex.service`).
- 프로덕션은 **수동 승인 단계** 포함(CLAUDE.md CI 규칙).

---

## 5. path → categoryCode 매칭 (적재 핵심 로직)

- 매칭율은 100%(2장)지만 **이름 매칭이 아니라 전체 경로 매칭**이어야 한다: `자켓`은 남성/여성 양쪽에 존재(동명이품) → leaf 이름만으로 매칭 금지.
- 시트: 4탭 = lv1(남성/여성/키즈/라이프), 컬럼 lvl2~lvl6 = 하위 레벨. 각 행 = 하나의 카테고리 경로.
- `ll_category`를 `categoryCode`(4자리 계층)로 트리 복원 → 시트 경로의 레벨별 `name`을 부모-자식으로 따라가며 노드 특정.
- 노드별로 `keyword`(그 레벨 동의어 셀들의 합집합) 산출. name 매칭은 정규화(trim, 공백/슬래시 표기) 후.
- 매칭 실패 노드는 리포트로 남겨 부서/운영과 확인(현재 0건이지만 시트 갱신 시 회귀 감시).

---

## 6. 검증 방법 (opensearch-study 도구 이식)

llink-api **검색 시점 분석기**(`kr_std_search_syn`) 기준으로 이식해 전/후 비교:
- `scripts/check-synonyms.mjs` — 그룹별 hub 기준 도달성 점검. **단일어 유실(과소확장)** / 다중어 유실 분리 집계.
- `scripts/search-smoke.mjs` + `golden-queries.json` — 골든셋 회귀. `expect`(소프트) / `forbid`(하드, exit 1). 예: `재킷 → forbid 부츠/가방`으로 과다확장 감시.

권장: ⑤ 재색인 전 baseline → 후 재측정 → 회귀 비교.

---

## 7. 롤아웃 순서

1. 부서와 시트 구조 합의 (8장).
2. 시트 → `ll_category.keyword` 적재 스크립트(노드별 산출, path→code) 작성·검증.
3. ② ③ ④ 코드 수정 (facet 제거 + user_dict 재소싱).
4. 검증 도구 이식 → baseline 측정.
5. 스테이징 blue-green 재색인 → 재측정 → 회귀 비교.
6. 프로덕션 재색인(수동 승인).

---

## 8. 부서 협의 사항

시트는 이미 카테고리 택소노미(lvl2~lvl6) + `단독`/`조합어` 컬럼 구조다. 본 설계에선 **단독/조합어를 다른 곳에 보내지 않고 둘 다 "그 레벨 노드의 동의어"로** 쓴다. 부서엔:

> - 각 셀은 **그 카테고리 레벨에서 서로 바꿔 써도 같은 뜻**인 표기만 담아 주세요(순수 동의어 그룹).
> - 길이·소재 수식어(롱/숏/데님)는 **그 수식어의 동의어끼리만**(롱=긴=long), garment(자켓 등)와 섞지 마세요. → 레벨별 순수성이 과다확장을 막는 핵심.
> - 카테고리 노드 추가/이름 변경 시 시트와 `ll_category`를 함께 갱신.

---

## 9. 미결 결정 / 확인 필요

- **size_norm 정규화 필드** 유지 여부: `syn_size` 폐지와 별개로 `buildSizeNormMap`/`extractSizeNorms`/`size_norm` 필드는 사이즈 boost에 쓰임. 폐지 시 사이즈 검색 약화.
- **보조 인덱스**(`goods_brand/color/gender/material`) 거취: 단순 facet 서빙용이면 제거, 자동완성/브라우즈 등 다른 용도면 유지. 용도 확인 필요.
- **속성 매칭 대체안**: 브랜드 표기변형(샤넬=Chanel) 등은 `name_search` 베이크로 일부 유지되나 전용 필드 동의어는 사라짐. UI 구조 필터 등 대체 경로 확인.
- **조합 노드 keyword 형태 = 레벨별 분리(B안) 확정.** 조합 전개(A안: 데님×자켓 전부 생성)는 maxClause 폭발/category_keywords 비대로 채택 안 함. 검색은 `name_search`(ancestor 이름 베이크) + `syn_name`(노드별 순수 그룹) 결합으로 동작.

---

### 부록 — 참조 파일
- `assets/mappings/goods.json` — 분석기/필터/매핑
- `services/full-reindex.service.ts` — `buildSynonymsMap`, 오케스트레이션
- `services/synonym-loader.service.ts` — txt 로더, `buildUserDictRules`, `buildSizeNormMap`
- `services/document-builder.service.ts` — `buildUnifiedSearchText`, `collectCategoryKeywords`, `collectProductKeywords`
- `services/opensearch-admin.service.ts` — `createIndexes`(goods만 주입), `swapAliases`, `cleanupOldIndexes`
- `repositories/search-indexer.repository.ts` — `findCategorySynonymLines`(keyword only), `findCategoriesForProducts`(ancestor 로드)
- `shared/domain/product-meta/category/entities/category.entity.ts` — `ll_category`(categoryCode/name/keyword/marketKeyword)
- opensearch-study(학습 레포): `scripts/sheets-to-synonyms.mjs`, `scripts/check-synonyms.mjs`, `scripts/search-smoke.mjs`
