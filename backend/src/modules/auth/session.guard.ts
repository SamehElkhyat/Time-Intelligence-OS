import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthedRequest, IS_PUBLIC } from '@/common/http/decorators';
import { DomainError } from '@/common/http/errors';
import { AuthService, SESSION_COOKIE } from './auth.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard: every route requires a valid session unless marked @Public().
 * State-changing requests must also carry the session-bound CSRF token.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    const authed = await this.auth.authenticate(token);
    if (!authed) throw DomainError.unauthorized('UNAUTHENTICATED', 'Please sign in to continue.');

    if (!SAFE_METHODS.has(req.method)) {
      const presented = req.headers['x-csrf-token'];
      if (!this.auth.verifyCsrf(authed.session.id, Array.isArray(presented) ? presented[0] : presented)) {
        throw DomainError.forbidden('CSRF_TOKEN_INVALID', 'Your session could not be verified. Refresh the page and try again.');
      }
    }
    req.user = authed.user;
    return true;
  }
}
