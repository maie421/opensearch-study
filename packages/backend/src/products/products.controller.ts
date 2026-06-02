import { Controller, Get, Query } from '@nestjs/common';
import { ProductsService } from './products.service';

/**
 * 🛍️ 상품 검색 API
 *
 * GET /api/products/search?q=가방&size=20&includeSoldOut=false
 */
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get('search')
  async search(
    @Query('q') q: string,
    @Query('size') size?: string,
    @Query('includeSoldOut') includeSoldOut?: string,
  ) {
    if (!q) {
      return {
        success: false,
        error: 'q 파라미터가 필요합니다',
        example: '/api/products/search?q=가방',
      };
    }

    const result = await this.products.search(q, {
      size: size ? Number(size) : 20,
      includeSoldOut: includeSoldOut === 'true',
    });

    return {
      success: true,
      query: q,
      includeSoldOut: includeSoldOut === 'true',
      ...result,
    };
  }
}
