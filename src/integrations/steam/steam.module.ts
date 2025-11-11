import { Module, forwardRef } from '@nestjs/common';
import { SteamController } from '../../api/steam.api.controller';
import { SteamService } from './steam.service';
import { UpsertService } from '../../api/upsert.service';
import { AuthModule } from '../../auth/auth.module'; // ✅ 추가
import { DashboardModule } from '../../dashboard/dashboard.module';
import { ApiModule } from '../../api/api.module';

@Module({
  imports: [
    forwardRef(() => AuthModule), // ✅ JwtAuthGuard, PassportStrategy를 불러오기 위해 필요
    forwardRef(() => DashboardModule),
    ApiModule,
  ],
  controllers: [SteamController],
  providers: [SteamService, UpsertService],
  exports: [SteamService],
})
export class SteamModule {}
