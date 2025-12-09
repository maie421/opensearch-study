import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * 🚀 애플리케이션 진입점
 *
 * 이 파일은 NestJS 앱을 시작하는 곳입니다.
 * Node.js를 실행하면 가장 먼저 이 파일이 실행됩니다.
 */
async function bootstrap() {
  // AppModule을 기반으로 NestJS 앱 인스턴스 생성
  const app = await NestFactory.create(AppModule);

  // CORS 활성화 (Next.js 프론트엔드에서 API 호출 가능하게)
  app.enableCors({
    origin: 'http://localhost:3000', // Next.js 기본 포트
    credentials: true,
  });

  // API 경로에 /api 프리픽스 추가
  // 예: GET /search → GET /api/search
  app.setGlobalPrefix('api');

  // 3001 포트에서 서버 시작 (3000은 프론트엔드용)
  await app.listen(3001);

  console.log('🚀 Backend server is running on http://localhost:3001');
  console.log('📚 API endpoint: http://localhost:3001/api');
}

bootstrap();