# llink-api 동의어 전환 설계: facet → category

> 목적: llink-api `search-indexer`의 동의어 체계를 **속성 facet(brand/color/material/gender/size)** 폐지 + **카테고리 동의어를 정확매치 경로로 정리**하는 방향으로 전환한다.
> 이 문서는 opensearch-study(학습 레포)에서 실제 코드·DB를 확인한 결과를 담은 **llink-api 담당자 전달용** 설계서다.
> 검증 대상 경로: `apps/api/src/modules/search-indexer/` (별도 표기 없으면 이 기준).

---

## 0. 결론 요약 (TL;DR)

- **카테고리 동의어는 이미 운영 중이다.** `ll_category.keyword`가 931/1212 노드 채워져 있고(운영자가 admin API로 수동 관리), 그게 `syn_name`(검색시점 synonym_graph) + `category_keywords`(정확매치) 양쪽으로 흐른다.
- 문제는 **그 데이터가 `syn_name`으로도 흘러 거대 혼합 그룹**을 만든다는 것: 예) `[데님 자켓]` 한 줄 = `옷, 의류, 아우터, 자켓, 잠바, 점퍼, 청자켓, …` 가 **하나의 synonym_graph 그룹** → 쿼리 과다확장 + maxClauseCount 위험.
- **채택 방향(옵션 1):** 기존 데이터(A안: 노드별 완전 전개)는 **그대로 두고**, ① 속성 facet 전부 폐지, ② **카테고리 keyword를 `syn_name`에서 분리**(→ `category_keywords` 정확매치로만), ③ `syn_name`은 순수 동의어 사전(`synonyms.txt` 등)만 담당.
- 결과: 과다확장·maxClause 폭발 해소, 기존 931노드 데이터 재작업 불필요. **트레이드오프:** 카테고리 매칭이 정확매치 위주가 됨(자유 쿼리 확장은 순수 사전 몫).

---

## 1. 현재 구조 (검증된 사실)

### 1-1. 인덱스 / 동의어 주입
- 인덱스 6종: `goods`(메인) + 보조 5종 `goods_brand` / `goods_color` / `goods_gender` / `goods_material` / `goods_category`.
- 동의어·user_dict는 **`goods` 인덱스에만** 주입. (`services/opensearch-admin.service.ts` `createIndexes`)
- alias atomic swap + 직전 1세대 보존으로 blue-green 무중단 재색인.

### 1-2. 동의어 적용 = 검색 시점 synonym_graph
`assets/mappings/goods.json`:
- `filter`: `syn_name`, `syn_brand`, `syn_color`, `syn_material`, `syn_gender`, `syn_size` — 전부 `type: synonym_graph`(런타임 주입).
- 색인 분석기 `kr_std` = `nori_user_dict` + `nori_part_of_speech`/`nori_readingform`/`lowercase` (**동의어 없음**).
- 검색 분석기 `*_search_syn` 들만 `syn_*` 필터를 단다 (예: `name_search.search_analyzer = kr_std_search_syn`).

### 1-3. 동의어 소스 머지 (txt + DB) — `full-reindex.service.ts buildSynonymsMap`
```
syn_name     = merge(txt[synonyms.txt, synonym_size.txt, synonym_fit.txt], DB findCategorySynonymLines)  ← 카테고리 DB가 여기 섞임 (문제 지점)
syn_brand    = merge(synonym_brand.txt,     DB findBrandSynonymLines)
syn_color    = merge(synonym_ko_colors.txt, DB findColorSynonymLines)
syn_material = merge(synonym_material.txt,   DB findMaterialSynonymLines)
syn_gender   = merge(synonym_gender.txt+en,  DB findGenderSynonymLines)
syn_size     = synonym_size.txt
```
- `findCategorySynonymLines()` (`repositories/search-indexer.repository.ts`) → `ll_category.keyword`만 읽어 콤마구분 라인 반환. **각 행(노드)의 keyword가 통째로 하나의 synonym_graph 그룹이 됨.**

### 1-4. 문서 빌드 — `services/document-builder.service.ts`
- **`name_search`** (`buildUnifiedSearchText`): 색인 시점에 상품명/브랜드/카테고리 **이름**(lv1~leaf, path)/색상/성별/소재 변형을 합침(주석: *"syn_name 의존도를 낮춰 maxClauseCount 폭발 방지"*). 검색 시 `syn_name` 추가 적용.
- **`category_keywords`** (`collectCategoryKeywords`): `categoryCode`를 4자리씩 잘라 ancestor 노드를 따라가며 각 `Category.keyword`+`marketKeyword`를 콤마 분해 → multi-valued `keyword` 필드(**정확매치**).
- **`product_keywords`** (`collectProductKeywords`): 상품 `search/marketSearch/manualSearch` 콤마 분해 → 정확매치.
- **`size_norm`**: option_values를 canonical 사이즈로 정규화(`buildSizeNormMap`/`extractSizeNorms`).

### 1-5. 카테고리 데이터 현황 (DB 확인)
- `ll_category`(엔티티 `shared/domain/product-meta/category/entities/category.entity.ts`): `categoryCode`(4자리 계층 prefix), `name`, `keyword`(주석 "키워드"), `marketKeyword`(주석 **"오픈마켓 키워드"** — 별도 용도, 본 작업과 무관).
- **`keyword` 채워진 노드 931/1212.** 운영자가 admin API(`apps/api/.../product-meta/category/services/category.service.ts`, create/update-category-command)로 **수동 관리.** 시트→DB 자동 생성기는 레포에 **없음**(google-sheet sync는 brand 등 타 메타용).
- 데이터 형태 = **노드별 완전 전개(A안):**
  ```
  [데님 자켓] = 옷, 의류, 아우터, 자켓, 잠바, 점퍼, 청자켓, 청점퍼, 청잠바, 데님 자켓, 데님 점퍼, 데님 잠바
  [롱 코트]   = 옷, 의류, 아우터, 코트, 겨울 코트, 롱 코트, 긴 코트
  ```
  조상어 + 조합 전개가 한 노드에 모두 포함. (참고: 동의어 시트 4탭의 카테고리 노드명은 `ll_category.name`과 100% 일치 — 시트가 택소노미 기반.)

---

## 2. 핵심 문제와 해법 (옵션 1)

### 문제
`ll_category.keyword`(A안 데이터)가 `findCategorySynonymLines` → `syn_name`으로 흐르면, `[데님 자켓]` 한 줄이 `{옷, 의류, 아우터, 자켓, 잠바, 점퍼, 청자켓, …}` **하나의 동의어 그룹**이 된다.
- `category_keywords`(정확매치, 문서별)에선 → **정상** (그 상품이 "자켓"·"청자켓"·"데님 자켓"에 매칭되는 건 맞음).
- `syn_name`(쿼리 확장)에선 → **과다확장** (`자켓` 쿼리가 `옷/의류/청자켓/…`로 확장) + 그룹이 수백 개라 maxClauseCount 폭발 위험.

### 해법 — 카테고리 동의어를 `syn_name`에서 분리
- 카테고리 동의어는 **`category_keywords`(정확매치)로만** 흐르게 한다 (기존 `collectCategoryKeywords` 그대로, 잘 동작).
- `syn_name`은 **순수 동의어 사전(`synonyms.txt` 등)만** 담당 (자유 쿼리 확장은 깨끗한 작은 사전으로).
- `ll_category.keyword` 데이터(A안, 931노드)는 **그대로 둔다** — `category_keywords`에선 그대로 유효하므로 재작업 불필요.

### 트레이드오프 (인지 필요)
- 카테고리 매칭이 **정확매치 위주**가 됨. 예: `청자켓`(저장된 phrase) → 매칭, `청 자켓`(띄어쓰기 변형)·`데님재킷`(미저장 변형) → 검색측 정규화/저장 phrase 커버 범위에 의존.
- A안 데이터가 phrase 변형을 풍부히 담고 있어 상당부분 커버되나, 띄어쓰기/미등록 변형은 (a) 검색측 normalize 또는 (b) 운영이 phrase 추가로 보완.

---

## 3. 목표 구조 (After)

```
goods 인덱스
├─ name_search (text)        syn_name (검색시점 synonym_graph) 유지
│     소스: synonyms.txt + synonym_size.txt + synonym_fit.txt 만   ← 카테고리 DB 제거
├─ category_keywords (keyword 정확매치)   기존 그대로
│     소스: ll_category.keyword(+marketKeyword) ancestor 전파       ← 데이터 유지(A안)
├─ product_keywords (keyword 정확매치)   기존 유지
├─ nori_user_dict.user_dictionary_rules  유지 (아래 ④)
└─ 제거: syn_brand / syn_color / syn_material / syn_gender / syn_size 필터
         + 대응 search 분석기 (brand_*/color_kr/material_kr/gender/size _search_syn)
```

속성 facet 폐지 리스크 완화: 브랜드/색상/소재/성별 변형은 이미 `buildUnifiedSearchText`가 `name_search`에 색인 시점 베이크하므로(예: brand.keyword="샤넬,Chanel"), 전용 `syn_*`를 빼도 `name_search`로 상당부분 매칭 유지. (전용 필드 `brand_title.text` 등 동의어 매칭은 사라짐 — 폐지 결정 사항.)

---

## 4. 전환 작업 항목

### ① [코드·핵심] 카테고리 keyword를 syn_name에서 분리 — `full-reindex.service.ts buildSynonymsMap`
- `syn_name = merge(defaults.syn_name, categoryDB)` → **`syn_name = defaults.syn_name`** (즉 `findCategorySynonymLines()` 호출 및 머지 제거).
- 동시에 `syn_brand/color/material/gender/size` 머지·DB 호출 전부 제거.
- 결과: 주입되는 `synonymsMap = { syn_name }` 하나만. (`findCategorySynonymLines`는 미사용 → 정리 대상)

### ② [코드·소] 매핑 정리 — `assets/mappings/goods.json`
- `filter`에서 `syn_brand/color/material/gender/size` 제거.
- 분석기 `brand_kr/brand_en/material_kr/color_kr/gender/size _search_syn` 제거.
- 해당 필드 `search_analyzer`를 동의어 없는 분석기(`kr_std`/`en_std`/`kw_lc`)로 환원.
- `synonym-loader.service.ts` `CATEGORY_FILES`에서 폐지 facet 항목 제거(syn_name/유지 항목만 남김).

### ③ [데이터] `ll_category.keyword` — 변경 없음
- 기존 A안 데이터(931노드) 유지. `category_keywords` 경로로 계속 동작.
- (선택·향후) 시트→`ll_category.keyword` **자동 생성기**: 현재 수동 관리. 자동화하면 운영 부담↓. 단 본 전환의 필수 작업은 아님.

### ④ [코드·확인] user_dict — 유지
- `buildUserDictRules`는 `synonym_ko_colors/gender/en_genders/material/size.txt`의 single-token으로 nori 분해 방지(아우터→터). **이 txt 파일들은 동의어 필터에선 빠지지만 user_dict 소스로는 남겨** 그대로 사용 → 추가 작업 없음.
- (txt 파일을 완전히 지우려면 user_dict 소스를 `synonyms.txt`/`ll_category.keyword` single-token으로 재소싱 필요 — 권장은 파일 보존.)

### ⑤ [운영] blue-green 전량 재색인 + 검증
- 분석기/매핑 변경 → 증분 불가, 전량 재색인 필수(`full-reindex.service`).
- 프로덕션은 **수동 승인 단계** 포함(CLAUDE.md CI 규칙).

---

## 5. 검증 방법 (opensearch-study 도구 이식)

llink-api **검색 시점 분석기**(`kr_std_search_syn`) 기준으로 전/후 비교:
- `scripts/search-smoke.mjs` + `golden-queries.json` — 골든셋 회귀. `forbid`로 과다확장 감시(예: `자켓 → forbid 옷/의류`, `재킷 → forbid 부츠`). **분리 후 거대 그룹 과다확장이 사라졌는지 확인.**
- `scripts/check-synonyms.mjs` — syn_name(순수 사전)의 단어 유실 점검.
- 추가 확인: 분리 전/후 `_search` 결과 비교로 "카테고리 정확매치는 유지되고, syn_name 과다확장은 제거" 검증.

권장: ⑤ 재색인 전 baseline → 후 재측정 → 회귀 비교.

---

## 6. 롤아웃 순서

1. ① ② 코드 수정 (카테고리 keyword를 syn_name에서 분리 + facet 제거).
2. 검증 도구 이식 → baseline 측정.
3. 스테이징 blue-green 재색인 → 재측정 → 회귀 비교(과다확장 해소 + 카테고리 정확매치 유지 확인).
4. 프로덕션 재색인(수동 승인).
5. (향후) 시트→`ll_category.keyword` 자동 생성기.

---

## 7. 미결 결정 / 확인 필요

- **카테고리 매칭 정확매치 트레이드오프**: 띄어쓰기/미등록 변형 커버를 (a) 검색측 normalize로 메울지 (b) 운영 phrase 보완으로 둘지.
- **size_norm 정규화 필드** 유지 여부: `syn_size` 폐지와 별개로 `size_norm`(`buildSizeNormMap`/`extractSizeNorms`)은 사이즈 boost에 쓰임. 폐지 시 사이즈 검색 약화 → 유지 권장.
- **보조 인덱스**(`goods_brand/color/gender/material`) 거취: 단순 facet 서빙용이면 제거, 자동완성/브라우즈 등 다른 용도면 유지. 용도 확인 필요.
- **속성 매칭 대체안**: 브랜드 표기변형(샤넬=Chanel) 등은 `name_search` 베이크로 일부 유지되나 전용 필드 동의어는 사라짐. UI 구조 필터 등 대체 경로 확인.
- **user_dict txt 보존 여부**: 권장은 보존(④). 완전 삭제 시 재소싱 필요.

---

### 부록 — 참조 파일
- `assets/mappings/goods.json` — 분석기/필터/매핑
- `services/full-reindex.service.ts` — `buildSynonymsMap`(① 분리 지점), 오케스트레이션
- `services/synonym-loader.service.ts` — txt 로더, `buildUserDictRules`, `buildSizeNormMap`
- `services/document-builder.service.ts` — `buildUnifiedSearchText`, `collectCategoryKeywords`(category_keywords 경로 — 유지)
- `services/opensearch-admin.service.ts` — `createIndexes`(goods만 주입), `swapAliases`, `cleanupOldIndexes`
- `repositories/search-indexer.repository.ts` — `findCategorySynonymLines`(① 제거 대상), `findCategoriesForProducts`
- `shared/domain/product-meta/category/entities/category.entity.ts` — `ll_category`(categoryCode/name/keyword/marketKeyword)
- 카테고리 keyword 수동 관리: `apps/api/src/modules/product-meta/category/services/category.service.ts` (create/update-category-command)
- opensearch-study(학습 레포): `scripts/check-synonyms.mjs`, `scripts/search-smoke.mjs`
