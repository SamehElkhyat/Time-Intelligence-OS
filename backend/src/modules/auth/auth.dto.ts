import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { IsIanaTimezone } from '@/common/http/decorators';
import { PreferenceDto, UserDto } from '../users/users.dto';

const normaliseEmail = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export class RegisterDto {
  @Transform(normaliseEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  /** 10–128 characters. */
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password: string;

  @IsString()
  @Length(1, 80)
  displayName: string;

  /** Browser-detected IANA timezone; can be changed later in preferences. */
  @IsOptional()
  @IsIanaTimezone()
  timezone?: string;

  @IsOptional()
  @IsString()
  @Length(2, 16)
  locale?: string;
}

export class LoginDto {
  @Transform(normaliseEmail)
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX)
  password: string;
}

export class ForgotPasswordDto {
  @Transform(normaliseEmail)
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @Length(20, 200)
  token: string;

  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  newPassword: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX)
  currentPassword: string;

  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  newPassword: string;
}

export class VerifyEmailDto {
  @IsString()
  @Length(20, 200)
  token: string;
}

export class SessionDto {
  user: UserDto;
  preference: PreferenceDto;
  /** Send back in the X-CSRF-Token header on every state-changing request. Keep in memory only. */
  csrfToken: string;
}

export class DeviceSessionDto {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  /** True for the session making this request. */
  current: boolean;
}

export class RevokedDto {
  revoked: number;
}
