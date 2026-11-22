import { z } from 'zod';

/** Client-side validation mirrors the API's rules so users get instant feedback; the server remains the authority. */
export const PASSWORD_MIN = 10;

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email address').pipe(z.email('Enter a valid email address')),
  password: z.string().min(1, 'Enter your password'),
});

export const registerSchema = z.object({
  displayName: z.string().trim().min(1, 'Tell us what to call you').max(80, 'Use 80 characters or fewer'),
  email: z.string().trim().min(1, 'Enter your email address').pipe(z.email('Enter a valid email address')),
  password: z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`).max(128, 'Use 128 characters or fewer'),
});

export const forgotSchema = z.object({ email: loginSchema.shape.email });

export const resetSchema = z
  .object({
    newPassword: registerSchema.shape.password,
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: registerSchema.shape.password,
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'Choose a different password' });

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;

/** Only same-site relative paths are honoured after login (prevents open redirects). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/';
  return next;
}
