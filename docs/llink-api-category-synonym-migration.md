# llink-api 동의어 전환 설계: facet → category

> 목적: llink-api `search-indexer`의 동의어 체계를 **속성 facet 기반(brand/color/material/gender/size)** 에서 **카테고리 기반**으로 전환한다.
> 이 문서는 opensearch-study(학습 레포)에서 실제 코드를 읽고 검증한 결과를 담은 **llink-api 담당자 전달용** 설계서다.
> 검증 대상 경로: `apps/api/src/modules/search-indexer/` (별도 표기 없으면 이 기준).

---

## 0. 결론 요약 (TL;DR)

- llink-api는 동의어를 **검색 시점 `synonym_graph`** 로 적용한다 (색인 시점 아님). 색인 분석기 `kr_std`엔 동의어 없음.
- **`ll_category.keyword` / `ll_category.marketKeyword`(DB)가 이미 카테고리 동의어의 중심 소스**이고, 두 갈래(`syn_name` + `category_keywords`)로 동시에 쓰인다.
- **키워드 컬럼 라우팅이 "단독/조합어 분리"를 이미 구현**하고 있다 → 과다 확장(`롱`→`재킷`류) 구조적 차단.
- 따라서 전환은 대부분 **데이터 작업**(시트 → `ll_category` 적재)이고, 코드 변경은 facet 가지 제거 + user_dict 재소싱 수준으로 작다.
- **단, 결정 사항:** 속성 facet(brand/color/material/gender/size) 동의어는 **전부 폐지**한다(확정). size_norm 정규화 필드와 보조 인덱스 거취는 별도 결정 필요.

---

## 1. 현재 구조 (검증된 사실)

### 1-1. 인덱스 / 동의어 주입
- 인덱스 6종: `goods`(메인) + 보조 5종 `goods_brand` / `goods_color` / `goods_gender` / `goods_material` / `goods_category`.
- 동의어·user_dict는 **`goods` 인덱스에만** 주입된다. (`services/opensearch-admin.service.ts` `createIndexes`, `if (kind === 'goods')`)
- alias atomic swap + 직전 1세대 보존 cleanup 으로 blue-green 무중단 재색인. (`swapAliases`, `cleanupOldIndexes`)

### 1-2. 동의어 적용 = 검색 시점 synonym_graph
`assets/mappings/goods.json`:
- `filter`: `syn_name`, `syn_brand`, `syn_color`, `syn_material`, `syn_gender`, `syn_size` — 전부 `type: synonym_graph`, 빈 배열(런타임 주입).
- 색인 분석기 `kr_std` = `nori_user_dict` + `nori_part_of_speech`, `nori_readingform`, `lowercase` (**동의어 없음**).
- 검색 분석기 `*_search_syn` 들만 `syn_*` 필터를 단다 (예: `name_search.search_analyzer = kr_std_search_syn`).
- 토크나이저 `nori_user_dict`는 `user_dictionary_rules`(런타임 주입)로 색상/성별/소재/사이즈 단일토큰을 atomic 유지(빨간→빨갛, 아우터→터 분해 방지).

### 1-3. 동의어 소스 머지 (txt + DB)
`services/full-reindex.service.ts` `buildSynonymsMap()`:
```
syn_name     = merge(txt[synonyms.txt, synonym_size.txt, synonym_fit.txt], DB findCategorySynonymLines)
syn_brand    = merge(synonym_brand.txt,         DB findBrandSynonymLines)
syn_color    = merge(synonym_ko_colors.txt,     DB findColorSynonymLines)
syn_material = merge(synonym_material.txt,       DB findMaterialSynonymLines)
syn_gender   = merge(synonym_gender.txt+en,      DB findGenderSynonymLines)
syn_size     = synonym_size.txt (DB 없음)
```
- txt 사전 로더: `services/synonym-loader.service.ts` (`CATEGORY_FILES`, `loadAll`, `buildUserDictRules`, `buildSizeNormMap`).
- **DB 카테고리 동의어:** `repositories/search-indexer.repository.ts` `findCategorySynonymLines()` → `ll_category.keyword`만 읽어 콤마구분 라인으로 반환(`marketKeyword`는 안 읽음).

### 1-4. 문서 빌드 — name_search / category_keywords / product_keywords
`services/document-builder.service.ts`:
- **`name_search`** (`buildUnifiedSearchText`): 색인 시점에 상품명 변형 + 브랜드(name/nameEn/keyword/marketKeyword) + **카테고리 각 level 이름(lv1~leaf, path)** + 색상/성별/소재 변형을 한 텍스트로 합침. (주석: *"검색 단계 syn_name 의존도를 낮춰 maxClauseCount 폭발 방지"*) → 검색 분석기에서 `syn_name` 추가 적용.
- **`category_keywords`** (`collectCategoryKeywords`): `categoryCode`를 4자리씩 잘라 ancestor 노드를 따라가며 각 `Category.keyword` + `Category.marketKeyword`를 **콤마 분해 → multi-valued `keyword` 필드**(정확매치, 토큰 분해 X). 주석: *"name_search 토큰 분해로 인한 cross-category 오염 회피"*.
- **`product_keywords`** (`collectProductKeywords`): 상품의 `search/marketSearch/manualSearch` 콤마 분해 → 동일하게 정확매치 keyword.
- **`size_norm`** (`extractSizeNorms` + `buildSizeNormMap`): option_values를 canonical 사이즈(S/M/L…)로 정규화 → 검색 사이즈 intent boost용.

### 1-5. categoryCode 구조
- `Category` 엔티티(`shared/domain/product-meta/category/entities/category.entity.ts`, 테이블 `ll_category`): `categoryCode`, `name`, `nameEn`, `keyword`, `marketKeyword`.
- **`categoryCode` = 4자리 계층 prefix** (`0001` > `00010002` > `000100020003` > …). ancestor는 prefix slice로 도출.
- 색인 시 leaf + 모든 4자리 prefix ancestor를 `categoryByCode` 맵에 로드(`repository.findCategoriesForProducts`).

---

## 2. 핵심 발견 — "단독/조합어 분리"가 이미 컬럼 라우팅으로 구현돼 있음

`syn_name`은 `ll_category.keyword`만 읽고(`findCategorySynonymLines`), `category_keywords`는 `keyword`+`marketKeyword` 둘 다 읽는다(`collectCategoryKeywords`). 이 비대칭이 우리가 원하는 분리를 그대로 만든다:

| 시트 컬럼 | → `ll_category` 컬럼 | → 도달 필드 | 매칭 성격 | 오염 |
|---|---|---|---|---|
| **단독 동의어** (자켓=재킷=jacket) | `keyword` | `syn_name` **+** `category_keywords` | 전역 free-text + 정확매치 | 없음(순수 동의어) |
| **조합어** (롱·숏·데님·가죽, "롱 다운 재킷") | `marketKeyword` | `category_keywords` **만** | 정확매치(카테고리 스코프) | **차단** (synonym_graph 미진입) |

→ 조합어가 `synonym_graph`(syn_name)에 절대 안 들어가므로, opensearch-study에서 재현했던 **`롱`이 든 모든 상품에 `재킷`이 주입되는 과다 확장**이 구조적으로 불가능하다.

> opensearch-study 재현 근거: 색인 시점 단일 사전으로 동의어를 펼쳤더니 `"롱 부츠"`의 색인 토큰이 74개로 폭발하며 `자켓/재킷/점퍼`가 섞여 `재킷` 검색에 부츠가 잡힘. llink-api는 (a) 검색시점 + (b) 조합어를 정확매치 keyword로 격리 → 두 겹으로 방지.

---

## 3. 목표 구조 (After)

```
goods 인덱스
├─ name_search (text)         syn_name (검색시점 synonym_graph) 유지
│     소스: synonyms.txt 등 + ll_category.keyword(단독)   ← 시트가 채움
├─ category_keywords (keyword 정확매치)
│     소스: ll_category.keyword(단독) + ll_category.marketKeyword(조합어)  ← 시트가 채움, ancestor 전파
├─ product_keywords (keyword 정확매치)   기존 유지
├─ nori_user_dict.user_dictionary_rules   ← 시트 단일토큰으로 재소싱 (3-④)
└─ 제거: syn_brand / syn_color / syn_material / syn_gender / syn_size
         + brand_*_search_syn / color_kr_search_syn / material_kr_search_syn /
           gender_search_syn / size_search_syn 분석기
```

속성 facet 폐지의 리스크 완화 근거: 브랜드/색상/소재/성별 변형은 **이미 `buildUnifiedSearchText`가 `name_search`에 색인 시점 베이크**하므로(예: brand.keyword="샤넬,Chanel" → 문서 name_search에 그대로 포함), 전용 `syn_*` facet을 빼도 `name_search` 경로로 상당부분 매칭 유지된다. (단 전용 필드 `brand_title.text` 등의 동의어 매칭은 사라짐 — 폐지 결정 사항.)

---

## 4. 전환 작업 항목

### ① [데이터·핵심] 시트 → `ll_category.keyword` / `marketKeyword` 적재
- 시트 카테고리 경로(예: `남성 > 의류 > 아우터 > 자켓`)를 `ll_category.name` **전체 경로**로 매칭해 `categoryCode`를 찾고, 해당 노드에:
  - `keyword` ← 그 레벨의 **단독 동의어** 셀
  - `marketKeyword` ← 그 레벨의 **조합어** 셀
- 적재 후엔 **기존 파이프라인이 코드 변경 없이** `syn_name` + `category_keywords`로 운반(2장 라우팅).
- 변환 로직은 opensearch-study `packages/backend/scripts/sheets-to-synonyms.mjs`를 **"글로벌 평탄화" → "노드별 산출"** 로 개조해 재사용. 산출물: `{ categoryCode, keyword, marketKeyword }[]` → DB upsert.

### ② [코드·소] facet 가지 제거 — `full-reindex.service.ts buildSynonymsMap`
- `findBrandSynonymLines/ColorSynonymLines/GenderSynonymLines/MaterialSynonymLines` 호출 및 `syn_brand/color/material/gender/size` 머지 제거. `syn_name`만 남김.

### ③ [코드·소] 매핑 정리 — `assets/mappings/goods.json`
- `filter`에서 `syn_brand/color/material/gender/size` 제거.
- 분석기 `brand_kr_search_syn`, `brand_en_search_syn`, `material_kr_search_syn`, `color_kr_search_syn`, `gender_search_syn`, `size_search_syn` 제거.
- 해당 필드(`brand_title.text`, `color_kr`, `material`, `gender.text` 등)의 `search_analyzer`를 동의어 없는 분석기(`kr_std`/`en_std`/`kw_lc`)로 환원.
- `synonym-loader.service.ts`의 `CATEGORY_FILES`에서 폐지 facet 항목 제거.

### ④ [코드·주의] user_dict 재소싱 — `synonym-loader.buildUserDictRules`
- 현재 `synonym_ko_colors/gender/en_genders/material/size.txt`의 single-token으로 nori 분해 방지. 이 사전들이 폐지되므로 **시트(또는 `ll_category.keyword`)의 single-token 한글/영문으로 재소싱**해야 `아우터→터`, `가벼운→가볍` 류 과소확장이 재발하지 않는다.
- 규칙 유지: 공백 없는 토큰, 길이 2+, 한/영 포함. 합성어 atomic화는 금지(`CASE-009` 롤백 사유 — 인덱스 토큰과 mismatch).

### ⑤ [운영] blue-green 전량 재색인 + 검증
- 분석기 구조 변경이라 증분 불가 → 전량 재색인 필수(`full-reindex.service`).
- 프로덕션은 **수동 승인 단계** 포함(CLAUDE.md CI 규칙).

---

## 5. path → categoryCode 매칭 (유일한 난관)

- **동명이품 주의:** leaf 이름만으로 매칭 금지. `남성>...>자켓`과 `여성>...>자켓`은 다른 노드 → **전체 경로(레벨별 name)로 매칭**.
- 시트 구조: 4탭 = lv1(남성/여성/키즈/라이프), 컬럼 lvl2~lvl6 = 하위 레벨. 각 행은 하나의 카테고리 경로. 같은 상위 노드가 여러 행에 반복 → `categoryCode` 기준 dedup.
- 산출: **카테고리 노드별로** `keyword`(단독 셀 합집합) / `marketKeyword`(조합어 셀 합집합).
- name 매칭은 정규화(trim, 공백/슬래시 표기) 후 비교. 매칭 실패 노드는 리포트로 남겨 부서/운영과 확인.

---

## 6. 검증 방법 (opensearch-study 도구 이식)

opensearch-study에 만든 두 도구를 llink-api **검색 시점 분석기**(`kr_std_search_syn`) 기준으로 이식해 전/후 비교:

- `scripts/check-synonyms.mjs` — 그룹별 hub 기준 도달성 점검(`analyze(member, 검색분석기) ⊆ analyze(hub, 색인분석기)`). **단일어 유실(과소확장)** / 다중어 유실 분리 집계.
- `scripts/search-smoke.mjs` + `golden-queries.json` — 골든셋 검색 회귀. `expect`(소프트) / `forbid`(하드, exit 1). 예: `재킷 → forbid 부츠/가방`으로 과다확장 감시.

권장: ⑤ 재색인 전 baseline 측정 → 후 재측정 → 회귀 비교.

---

## 7. 롤아웃 순서

1. 부서와 시트 구조 합의 (8장).
2. 시트 → `ll_category` 매핑/적재 스크립트(노드별 산출, path→code) 작성·검증.
3. ② ③ ④ 코드 수정 (facet 제거 + user_dict 재소싱).
4. 검증 도구 이식 → **baseline 측정**.
5. 스테이징 blue-green 재색인 → 재측정 → 회귀 비교.
6. 프로덕션 재색인(수동 승인).

---

## 8. 부서 협의 사항

시트는 이미 `lvlN 단독` / `앞·뒷 조합어` 컬럼으로 구분돼 있다. 부서에 요청할 것은 동의어 추가가 아니라 **분류 규칙 유지**:

> - 서로 바꿔 써도 **항상 같은 뜻**인 표기만 **단독** 컬럼에. (자켓=재킷=jacket)
> - 길이·소재·핏 등 **수식어**는 **조합어** 컬럼에. (롱, 숏, 데님, 가죽)
> - 이 구분이 곧 `keyword`(전역 동의어) vs `marketKeyword`(카테고리 정확매치) 라우팅을 결정한다.

---

## 9. 미결 결정 / 확인 필요

- **size_norm 정규화 필드** 유지 여부: `syn_size` 폐지와 별개로 `buildSizeNormMap`/`extractSizeNorms`/`size_norm` 필드는 검색 사이즈 boost에 쓰임. 폐지 시 사이즈 검색 약화.
- **보조 인덱스**(`goods_brand/color/gender/material`) 거취: 단순 facet 서빙용이면 제거, 다른 용도(자동완성/브라우즈)면 유지. 용도 확인 필요.
- **속성 매칭 대체안**: 브랜드 표기변형(샤넬=Chanel) 등은 `name_search` 베이크로 일부 유지되나, 전용 필드 동의어는 사라짐. UI 구조 필터 등 대체 경로 확인.
- `findCategorySynonymLines`가 `marketKeyword`를 안 읽는 현 동작을 **유지**(조합어를 synonym_graph에서 배제)하는 것이 전제. 바꾸지 말 것.

---

### 부록 — 참조 파일
- `assets/mappings/goods.json` — 분석기/필터/매핑
- `services/full-reindex.service.ts` — `buildSynonymsMap`, 오케스트레이션
- `services/synonym-loader.service.ts` — txt 로더, `buildUserDictRules`, `buildSizeNormMap`
- `services/document-builder.service.ts` — `buildUnifiedSearchText`, `collectCategoryKeywords`, `collectProductKeywords`, `extractSizeNorms`
- `services/opensearch-admin.service.ts` — `createIndexes`(goods만 주입), `swapAliases`, `cleanupOldIndexes`
- `repositories/search-indexer.repository.ts` — `findCategorySynonymLines`(keyword only), `findCategoriesForProducts`(ancestor 로드)
- `shared/domain/product-meta/category/entities/category.entity.ts` — `ll_category`(categoryCode/name/keyword/marketKeyword)
- opensearch-study(학습 레포): `scripts/sheets-to-synonyms.mjs`, `scripts/check-synonyms.mjs`, `scripts/search-smoke.mjs`
