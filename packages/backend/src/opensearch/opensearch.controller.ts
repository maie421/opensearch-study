import { Controller, Get, Post, Put, Delete, Query, Body, Param } from '@nestjs/common';
import { OpensearchService } from './opensearch.service';

/**
 * 🎮 OpenSearch 컨트롤러
 *
 * OpenSearch 관련 API 엔드포인트를 제공합니다.
 *
 * @Controller('opensearch'):
 * - 이 컨트롤러의 모든 라우트는 /api/opensearch/ 로 시작
 */
@Controller('opensearch')
export class OpensearchController {
  constructor(private readonly opensearchService: OpensearchService) {}

  /**
   * GET /api/opensearch/info
   *
   * OpenSearch 서버 정보 조회
   * 서버가 잘 연결되었는지 확인하는 용도
   */
  @Get('info')
  async getInfo() {
    const info = await this.opensearchService.getInfo();
    return {
      success: true,
      data: info,
    };
  }

  /**
   * GET /api/opensearch/indices
   *
   * 모든 인덱스 목록 조회
   * 어떤 인덱스들이 있는지 확인
   */
  @Get('indices')
  async listIndices() {
    const indices = await this.opensearchService.listIndices();
    return {
      success: true,
      count: indices.length,
      data: indices,
    };
  }

  /**
   * GET /api/opensearch/search?index=products&q=맥북
   *
   * 검색 API
   *
   * @Query() - URL의 쿼리 파라미터를 받아옴
   * 예: /search?index=products&q=맥북
   *     → index = 'products', q = '맥북'
   */
  @Get('search')
  async search(
    @Query('index') index: string,
    @Query('q') query: string,
  ) {
    if (!index || !query) {
      return {
        success: false,
        error: 'index와 q 파라미터가 필요합니다',
        example: '/api/opensearch/search?index=products&q=맥북',
      };
    }

    try {
      const result = await this.opensearchService.search(index, query);
      return {
        success: true,
        query,
        index,
        ...result,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // ============================================
  // 📚 CRUD API 엔드포인트들
  // ============================================

  /**
   * POST /api/opensearch/index
   *
   * 인덱스 생성 (매핑과 함께)
   *
   * Body 예시:
   * {
   *   "index": "books",
   *   "mappings": {
   *     "properties": {
   *       "title": { "type": "text" },
   *       "author": { "type": "keyword" }
   *     }
   *   }
   * }
   */
  @Post('index')
  async createIndex(@Body() body: { index: string; mappings: any }) {
    try {
      const result = await this.opensearchService.createIndex(
        body.index,
        body.mappings,
      );
      return {
        success: true,
        message: `인덱스 '${body.index}' 생성 완료`,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * DELETE /api/opensearch/index/:name
   *
   * 인덱스 삭제
   *
   * 예: DELETE /api/opensearch/index/books
   */
  @Delete('index/:name')
  async deleteIndex(@Param('name') index: string) {
    try {
      const result = await this.opensearchService.deleteIndex(index);
      return {
        success: true,
        message: `인덱스 '${index}' 삭제 완료`,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * GET /api/opensearch/:index/documents
   *
   * 특정 인덱스의 모든 문서 조회
   *
   * 예: GET /api/opensearch/books/documents
   */
  @Get(':index/documents')
  async getAllDocuments(@Param('index') index: string) {
    try {
      const result = await this.opensearchService.getAllDocuments(index);
      return {
        success: true,
        index,
        ...result,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * GET /api/opensearch/:index/document/:id
   *
   * 특정 문서 조회 (ID로)
   *
   * 예: GET /api/opensearch/books/document/1
   */
  @Get(':index/document/:id')
  async getDocument(
    @Param('index') index: string,
    @Param('id') id: string,
  ) {
    try {
      const result = await this.opensearchService.getDocument(index, id);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * POST /api/opensearch/:index/document
   *
   * 문서 추가
   *
   * Body 예시:
   * {
   *   "id": "1",  // 선택 사항
   *   "document": {
   *     "title": "해리포터",
   *     "author": "J.K. 롤링"
   *   }
   * }
   */
  @Post(':index/document')
  async createDocument(
    @Param('index') index: string,
    @Body() body: { document: any; id?: string },
  ) {
    try {
      const result = await this.opensearchService.createDocument(
        index,
        body.document,
        body.id,
      );
      return {
        success: true,
        message: '문서 생성 완료',
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * PUT /api/opensearch/:index/document/:id
   *
   * 문서 수정
   *
   * Body 예시:
   * {
   *   "document": {
   *     "price": 27000
   *   }
   * }
   */
  @Put(':index/document/:id')
  async updateDocument(
    @Param('index') index: string,
    @Param('id') id: string,
    @Body() body: { document: any },
  ) {
    try {
      const result = await this.opensearchService.updateDocument(
        index,
        id,
        body.document,
      );
      return {
        success: true,
        message: '문서 수정 완료',
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * DELETE /api/opensearch/:index/document/:id
   *
   * 문서 삭제
   *
   * 예: DELETE /api/opensearch/books/document/1
   */
  @Delete(':index/document/:id')
  async deleteDocument(
    @Param('index') index: string,
    @Param('id') id: string,
  ) {
    try {
      const result = await this.opensearchService.deleteDocument(index, id);
      return {
        success: true,
        message: '문서 삭제 완료',
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // ============================================
  // 🔍 고급 검색 API 엔드포인트들
  // ============================================

  /**
   * GET /api/opensearch/:index/search/category?category=fantasy
   *
   * 카테고리별 검색 (Term 쿼리)
   *
   * 예: GET /api/opensearch/books/search/category?category=fantasy
   */
  @Get(':index/search/category')
  async searchByCategory(
    @Param('index') index: string,
    @Query('category') category: string,
  ) {
    try {
      if (!category) {
        return {
          success: false,
          error: 'category 파라미터가 필요합니다',
        };
      }

      const result = await this.opensearchService.searchByCategory(
        index,
        category,
      );
      return {
        success: true,
        category,
        ...result,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * GET /api/opensearch/:index/search/price?min=10000&max=20000
   *
   * 가격 범위 검색 (Range 쿼리)
   *
   * 예: GET /api/opensearch/books/search/price?min=10000&max=20000
   */
  @Get(':index/search/price')
  async searchByPrice(
    @Param('index') index: string,
    @Query('min') minPrice?: string,
    @Query('max') maxPrice?: string,
  ) {
    try {
      const min = minPrice ? parseInt(minPrice) : undefined;
      const max = maxPrice ? parseInt(maxPrice) : undefined;

      const result = await this.opensearchService.searchByPriceRange(
        index,
        min,
        max,
      );
      return {
        success: true,
        priceRange: { min, max },
        ...result,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * GET /api/opensearch/:index/search/advanced
   *
   * Bool 쿼리를 사용한 복합 조건 검색
   *
   * 쿼리 파라미터:
   * - category: 카테고리 (must)
   * - minPrice: 최소 가격 (filter)
   * - maxPrice: 최대 가격 (filter)
   * - minRating: 최소 평점 (filter)
   * - excludeCategory: 제외할 카테고리 (must_not)
   *
   * 예: GET /api/opensearch/books/search/advanced?category=fantasy&maxPrice=20000&minRating=4.7
   */
  @Get(':index/search/advanced')
  async advancedSearch(
    @Param('index') index: string,
    @Query('category') category?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('minRating') minRating?: string,
    @Query('excludeCategory') excludeCategory?: string,
  ) {
    try {
      const filters = {
        category,
        minPrice: minPrice ? parseInt(minPrice) : undefined,
        maxPrice: maxPrice ? parseInt(maxPrice) : undefined,
        minRating: minRating ? parseFloat(minRating) : undefined,
        excludeCategory,
      };

      const result = await this.opensearchService.advancedSearch(
        index,
        filters,
      );
      return {
        success: true,
        filters,
        ...result,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * GET /api/opensearch/:index/statistics
   *
   * 통계 조회 (Aggregation)
   *
   * 예: GET /api/opensearch/books/statistics
   */
  @Get(':index/statistics')
  async getStatistics(@Param('index') index: string) {
    try {
      const result = await this.opensearchService.getStatistics(index);
      return {
        success: true,
        index,
        statistics: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}