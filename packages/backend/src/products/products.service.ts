import { Injectable } from '@nestjs/common';
import { OpensearchService } from '../opensearch/opensearch.service';

/**
 * 🛍️ 상품 유사도 검색 서비스
 *
 * market_name 을 대상으로 유사도(_score) 높은 순으로 상품을 검색한다.
 * 품절 처리:
 *  - 기본: 품절(is_sold_out=true) 상품은 결과에서 제외 (filter)
 *  - includeSoldOut=true: 품절도 노출하되 맨 뒤로 정렬 (sort)
 */
@Injectable()
export class ProductsService {
  private readonly index = process.env.PRODUCTS_INDEX ?? 'products';

  constructor(private readonly opensearch: OpensearchService) {}

  async search(
    q: string,
    opts: { size?: number; includeSoldOut?: boolean } = {},
  ) {
    const size = opts.size ?? 20;
    const includeSoldOut = opts.includeSoldOut ?? false;

    // 품절 숨김(기본): filter 로 in-stock 만. 품절 포함: filter 없음.
    const filter = includeSoldOut ? [] : [{ term: { is_sold_out: false } }];

    // 품절 포함 시: 재고 있는 것(is_sold_out=false) 먼저, 그 안에서 유사도순 → 품절은 뒤로
    // 품절 숨김 시: 순수 유사도순
    const sort = includeSoldOut
      ? [{ is_sold_out: 'asc' }, { _score: 'desc' }]
      : [{ _score: 'desc' }];

    const body = {
      size,
      query: {
        bool: {
          must: [
            {
              // market_name 에 가중치 2배 — 검색용 분석기(동의어)가 자동 적용됨
              multi_match: {
                query: q,
                fields: ['market_name^2', 'name'],
              },
            },
          ],
          filter,
        },
      },
      sort,
    };

    const res = await this.opensearch.getClient().search({
      index: this.index,
      body,
    });

    return {
      total: res.body.hits.total.value,
      items: res.body.hits.hits.map((h: any) => ({
        id: h._id,
        score: h._score,
        ...h._source,
      })),
    };
  }
}
