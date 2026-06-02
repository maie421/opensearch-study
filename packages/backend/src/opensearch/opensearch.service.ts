import { Injectable, OnModuleInit } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';

/**
 * 🔍 OpenSearch 서비스
 *
 * OpenSearch 클라이언트를 관리하고, 검색 로직을 처리합니다.
 *
 * OnModuleInit:
 * - NestJS 모듈이 초기화될 때 자동으로 실행
 * - OpenSearch 연결 테스트용
 */
@Injectable()
export class OpensearchService implements OnModuleInit {
  private client: Client;

  constructor() {
    // OpenSearch 클라이언트 초기화
    this.client = new Client({
      node: process.env.OPENSEARCH_NODE || 'http://localhost:9200',
      // SSL 인증서 검증 비활성화 (로컬 개발용)
      // 실제 운영 환경에서는 제대로 된 인증 설정 필요!
      ssl: {
        rejectUnauthorized: false,
      },
    });
  }

  /**
   * 모듈 초기화 시 실행
   * OpenSearch 서버 연결 상태 확인
   */
  async onModuleInit() {
    try {
      const info = await this.client.info();
      console.log('✅ OpenSearch 연결 성공!');
      console.log('📊 OpenSearch 버전:', info.body.version.number);
    } catch (error) {
      console.error('❌ OpenSearch 연결 실패:', error.message);
      console.error('   Docker로 OpenSearch를 실행했는지 확인하세요!');
    }
  }

  /**
   * OpenSearch 클라이언트 반환 (다른 서비스에서 재사용)
   */
  getClient(): Client {
    return this.client;
  }

  /**
   * OpenSearch 서버 정보 가져오기
   */
  async getInfo() {
    const response = await this.client.info();
    return response.body;
  }

  /**
   * 모든 인덱스 목록 조회
   */
  async listIndices() {
    const response = await this.client.cat.indices({ format: 'json' });
    return response.body;
  }

  /**
   * 간단한 검색 예제 (나중에 확장 예정)
   *
   * @param index - 검색할 인덱스 이름
   * @param query - 검색어
   */
  async search(index: string, query: string) {
    try {
      const response = await this.client.search({
        index,
        body: {
          query: {
            // match: 전문 검색 (Full-text search)
            // 나중에 여러 쿼리 타입을 배울 예정!
            wildcard: {
                "title.keyword": `*${query}*`, // 모든 필드에서 검색
            },
          },
        },
      });

      return {
        total: response.body.hits.total.value,
        hits: response.body.hits.hits,
      };
    } catch (error) {
      throw new Error(`검색 실패: ${error.message}`);
    }
  }

  // ============================================
  // 📚 CRUD 작업 메서드들
  // ============================================

  /**
   * 인덱스 생성 (매핑과 함께)
   *
   * @param index - 생성할 인덱스 이름
   * @param mappings - 매핑 정의
   */
  async createIndex(index: string, mappings: any) {
    try {
      const response = await this.client.indices.create({
        index,
        body: {
          mappings,
        },
      });
      return response.body;
    } catch (error) {
      throw new Error(`인덱스 생성 실패: ${error.message}`);
    }
  }

  /**
   * 인덱스 삭제
   *
   * @param index - 삭제할 인덱스 이름
   */
  async deleteIndex(index: string) {
    try {
      const response = await this.client.indices.delete({
        index,
      });
      return response.body;
    } catch (error) {
      throw new Error(`인덱스 삭제 실패: ${error.message}`);
    }
  }

  /**
   * 문서 추가 (Create)
   *
   * @param index - 인덱스 이름
   * @param id - 문서 ID (선택)
   * @param document - 문서 데이터
   */
  async createDocument(index: string, document: any, id?: string) {
    try {
      const response = await this.client.index({
        index,
        id,
        body: document,
      });
      return response.body;
    } catch (error) {
      throw new Error(`문서 생성 실패: ${error.message}`);
    }
  }

  /**
   * 문서 조회 (Read by ID)
   *
   * @param index - 인덱스 이름
   * @param id - 문서 ID
   */
  async getDocument(index: string, id: string) {
    try {
      const response = await this.client.get({
        index,
        id,
      });
      return response.body;
    } catch (error) {
      throw new Error(`문서 조회 실패: ${error.message}`);
    }
  }

  /**
   * 문서 수정 (Update)
   *
   * @param index - 인덱스 이름
   * @param id - 문서 ID
   * @param document - 수정할 데이터
   */
  async updateDocument(index: string, id: string, document: any) {
    try {
      const response = await this.client.update({
        index,
        id,
        body: {
          doc: document,
        },
      });
      return response.body;
    } catch (error) {
      throw new Error(`문서 수정 실패: ${error.message}`);
    }
  }

  /**
   * 문서 삭제 (Delete)
   *
   * @param index - 인덱스 이름
   * @param id - 문서 ID
   */
  async deleteDocument(index: string, id: string) {
    try {
      const response = await this.client.delete({
        index,
        id,
      });
      return response.body;
    } catch (error) {
      throw new Error(`문서 삭제 실패: ${error.message}`);
    }
  }

  /**
   * 모든 문서 조회 (Read All)
   *
   * @param index - 인덱스 이름
   */
  async getAllDocuments(index: string) {
    try {
      const response = await this.client.search({
        index,
        body: {
          query: {
            match_all: {},
          },
        },
      });

      return {
        total: response.body.hits.total.value,
        documents: response.body.hits.hits,
      };
    } catch (error) {
      throw new Error(`전체 문서 조회 실패: ${error.message}`);
    }
  }

  // ============================================
  // 🔍 고급 검색 메서드들
  // ============================================

  /**
   * 카테고리별 검색
   *
   * @param index - 인덱스 이름
   * @param category - 카테고리
   */
  async searchByCategory(index: string, category: string) {
    try {
      const response = await this.client.search({
        index,
        body: {
          query: {
            term: {
              category: category,
            },
          },
        },
      });

      return {
        total: response.body.hits.total.value,
        hits: response.body.hits.hits,
      };
    } catch (error) {
      throw new Error(`카테고리 검색 실패: ${error.message}`);
    }
  }

  /**
   * 가격 범위 검색
   *
   * @param index - 인덱스 이름
   * @param minPrice - 최소 가격
   * @param maxPrice - 최대 가격
   */
  async searchByPriceRange(
    index: string,
    minPrice?: number,
    maxPrice?: number,
  ) {
    try {
      const rangeQuery: any = {};
      if (minPrice !== undefined) rangeQuery.gte = minPrice;
      if (maxPrice !== undefined) rangeQuery.lte = maxPrice;

      const response = await this.client.search({
        index,
        body: {
          query: {
            range: {
              price: rangeQuery,
            },
          },
        },
      });

      return {
        total: response.body.hits.total.value,
        hits: response.body.hits.hits,
      };
    } catch (error) {
      throw new Error(`가격 범위 검색 실패: ${error.message}`);
    }
  }

  /**
   * Bool 쿼리를 사용한 고급 검색
   *
   * @param index - 인덱스 이름
   * @param filters - 검색 조건들
   */
  async advancedSearch(
    index: string,
    filters: {
      category?: string;
      minPrice?: number;
      maxPrice?: number;
      minRating?: number;
      excludeCategory?: string;
    },
  ) {
    try {
      const boolQuery: any = {
        must: [],
        filter: [],
        must_not: [],
      };

      // 카테고리 조건
      if (filters.category) {
        boolQuery.must.push({
          term: { category: filters.category },
        });
      }

      // 가격 범위
      if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
        const rangeQuery: any = {};
        if (filters.minPrice !== undefined) rangeQuery.gte = filters.minPrice;
        if (filters.maxPrice !== undefined) rangeQuery.lte = filters.maxPrice;

        boolQuery.filter.push({
          range: { price: rangeQuery },
        });
      }

      // 평점 조건
      if (filters.minRating !== undefined) {
        boolQuery.filter.push({
          range: { rating: { gte: filters.minRating } },
        });
      }

      // 제외할 카테고리
      if (filters.excludeCategory) {
        boolQuery.must_not.push({
          term: { category: filters.excludeCategory },
        });
      }

      const response = await this.client.search({
        index,
        body: {
          query: {
            bool: boolQuery,
          },
        },
      });

      return {
        total: response.body.hits.total.value,
        hits: response.body.hits.hits,
      };
    } catch (error) {
      throw new Error(`고급 검색 실패: ${error.message}`);
    }
  }

  /**
   * 통계 조회 (Aggregation)
   *
   * @param index - 인덱스 이름
   */
  async getStatistics(index: string) {
    try {
      const response = await this.client.search({
        index,
        body: {
          size: 0,
          aggs: {
            categories: {
              terms: {
                field: 'category',
              },
              aggs: {
                avg_price: {
                  avg: {
                    field: 'price',
                  },
                },
                avg_rating: {
                  avg: {
                    field: 'rating',
                  },
                },
              },
            },
            price_stats: {
              stats: {
                field: 'price',
              },
            },
            rating_stats: {
              stats: {
                field: 'rating',
              },
            },
          },
        },
      });

      return {
        categories: response.body.aggregations.categories.buckets,
        priceStats: response.body.aggregations.price_stats,
        ratingStats: response.body.aggregations.rating_stats,
      };
    } catch (error) {
      throw new Error(`통계 조회 실패: ${error.message}`);
    }
  }
}