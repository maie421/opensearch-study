import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { OpensearchModule } from '../opensearch/opensearch.module';

/**
 * 🛍️ 상품 모듈
 * OpensearchModule 을 가져와서 OpenSearch 클라이언트를 재사용한다.
 */
@Module({
  imports: [OpensearchModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
