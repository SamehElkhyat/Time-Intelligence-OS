import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MailerService } from './mailer.service';
import { SessionGuard } from './session.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, MailerService, { provide: APP_GUARD, useClass: SessionGuard }],
  exports: [AuthService, MailerService],
})
export class AuthModule {}
