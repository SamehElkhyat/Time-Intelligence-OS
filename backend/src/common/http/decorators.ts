import { applyDecorators, createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, registerDecorator, ValidationOptions } from 'class-validator';
import type { Request } from 'express';
import { isLocalDate, isValidTimezone } from '../time/time';

export interface AuthUser {
  id: string;
  sessionId: string;
  email: string;
  isDemo: boolean;
}

export type AuthedRequest = Request & { user?: AuthUser; requestId?: string };

export const IS_PUBLIC = 'tf:isPublic';
/** Route does not require an authenticated session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** The authenticated user. Identity always comes from the session, never from client input. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.user) throw new Error('CurrentUser used on a route without authentication');
  return req.user;
});

export function clientIp(req: Request): string | null {
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

type EnumLike = Record<string, string>;

/** Required enum property: validated and documented in OpenAPI as a named schema. */
export const EnumProp = (e: EnumLike, enumName: string) =>
  applyDecorators(ApiProperty({ enum: Object.values(e), enumName }), IsEnum(e));

export const OptionalEnumProp = (e: EnumLike, enumName: string) =>
  applyDecorators(ApiPropertyOptional({ enum: Object.values(e), enumName }), IsOptional(), IsEnum(e));

/** Response-only enum annotation (no validation). */
export const EnumOut = (e: EnumLike, enumName: string, opts: { nullable?: boolean; isArray?: boolean } = {}) =>
  ApiProperty({ enum: Object.values(e), enumName, nullable: opts.nullable ?? false, isArray: opts.isArray ?? false });

export function IsLocalDateString(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isLocalDateString',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} must be a calendar date in YYYY-MM-DD format`, ...options },
      validator: { validate: (v: unknown) => typeof v === 'string' && isLocalDate(v) },
    });
}

export function IsIanaTimezone(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isIanaTimezone',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} must be a valid IANA timezone (e.g. "Europe/Paris")`, ...options },
      validator: { validate: (v: unknown) => typeof v === 'string' && isValidTimezone(v) },
    });
}
