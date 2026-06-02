// products 인덱스를 생성한다 (매핑 + nori/동의어 분석기).
// 학습 중 반복 실행할 수 있게, 이미 있으면 지우고 다시 만든다.
// 실행: cd packages/backend && node scripts/create-index.mjs
import { readFileSync } from 'node:fs';
import { Client } from '@opensearch-project/opensearch';

// .env 직접 파싱 (pnpm 격리 구조 대응)
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const INDEX = process.env.PRODUCTS_INDEX ?? 'products';
const client = new Client({ node: process.env.OPENSEARCH_NODE ?? 'http://localhost:9200' });

// ── 인덱스 설정: 분석기(색인용/검색용) ──────────────────────────────
const settings = {
  index: {
    analysis: {
      tokenizer: {
        // 한글 형태소 토크나이저. mixed = 복합어를 "원형 + 분해" 둘 다 생성
        nori_user: { type: 'nori_tokenizer', decompound_mode: 'mixed' },
      },
      filter: {
        // 조사/어미 등 검색에 불필요한 품사 제거 (nori 기본 stoptag 사용)
        ko_pos: { type: 'nori_part_of_speech' },
        // 검색 시점 동의어 (synonym_graph = 다중 단어 동의어 지원)
        // synonyms_path 는 컨테이너 config 디렉터리 기준 상대경로
        syn_search: {
          type: 'synonym_graph',
          synonyms_path: 'synonyms.txt',
          lenient: true, // 잘못된 동의어 줄은 건너뜀
        },
      },
      analyzer: {
        // 색인용: 동의어 없음
        korean_index: {
          type: 'custom',
          tokenizer: 'nori_user',
          filter: ['ko_pos', 'lowercase'],
        },
        // 검색용: 동의어 포함
        korean_search: {
          type: 'custom',
          tokenizer: 'nori_user',
          filter: ['ko_pos', 'lowercase', 'syn_search'],
        },
      },
    },
  },
};

// ── 매핑: 필드 타입 ──────────────────────────────────────────────
const mappings = {
  properties: {
    // 유사도 검색 대상: 색인은 동의어X, 검색은 동의어O
    market_name: {
      type: 'text',
      analyzer: 'korean_index',
      search_analyzer: 'korean_search',
      fields: { keyword: { type: 'keyword', ignore_above: 512 } },
    },
    // 보조 상품명(깨끗한 버전)
    name: {
      type: 'text',
      analyzer: 'korean_index',
      search_analyzer: 'korean_search',
    },
    price: { type: 'integer' }, // 판매가
    original_price: { type: 'integer' }, // 정가
    thumbnail_url: { type: 'keyword', index: false }, // 표시용 (검색X)
    is_sold_out: { type: 'boolean' }, // 품절 여부 (product_status=40)
    product_status: { type: 'integer' }, // 원본 상태값
  },
};

// ── 실행 ────────────────────────────────────────────────────────
const exists = await client.indices.exists({ index: INDEX });
if (exists.body) {
  console.log(`기존 인덱스 '${INDEX}' 삭제`);
  await client.indices.delete({ index: INDEX });
}

await client.indices.create({ index: INDEX, body: { settings, mappings } });
console.log(`✅ 인덱스 '${INDEX}' 생성 완료\n`);

// ── 검증: 색인 분석기 vs 검색 분석기(동의어) 비교 ──────────────────
async function analyze(analyzer, text) {
  const res = await client.indices.analyze({ index: INDEX, body: { analyzer, text } });
  return res.body.tokens.map((t) => t.token).join(' / ');
}
console.log('입력: "오프화이트 반팔 티"');
console.log('  색인용(korean_index):', await analyze('korean_index', '오프화이트 반팔 티'));
console.log('  검색용(korean_search):', await analyze('korean_search', '오프화이트 반팔 티'));
console.log('   ↑ 검색용에서 동의어(티→티셔츠/반팔 등)가 확장되면 성공');
