import { del, get, patch, post, put, setCsrfToken } from '@/lib/api/client';
import type * as T from '@/types';

/** Typed wrappers over the REST API, grouped by domain. No business rules live here. */

// ── auth & profile ───────────────────────────────────────────────────────────
export const authApi = {
  session: async () => {
    const s = await get<T.SessionPayload>('/auth/session');
    setCsrfToken(s.csrfToken);
    return s;
  },
  login: async (body: { email: string; password: string }) => {
    const s = await post<T.SessionPayload>('/auth/login', body);
    setCsrfToken(s.csrfToken);
    return s;
  },
  register: async (body: { email: string; password: string; displayName: string; timezone?: string }) => {
    const s = await post<T.SessionPayload>('/auth/register', body);
    setCsrfToken(s.csrfToken);
    return s;
  },
  logout: async () => {
    await post('/auth/logout');
    setCsrfToken(null);
  },
  forgot: (email: string) => post('/auth/password/forgot', { email }),
  reset: (body: { token: string; newPassword: string }) => post('/auth/password/reset', body),
  verifyEmail: (token: string) => post('/auth/email/verify', { token }),
  resendVerification: () => post('/auth/email/resend'),
  changePassword: (body: { currentPassword: string; newPassword: string }) => post('/auth/password/change', body),
  devices: () => get<T.DeviceSession[]>('/auth/sessions'),
  revokeDevice: (id: string) => del(`/auth/sessions/${id}`),
  revokeOthers: () => post<{ revoked: number }>('/auth/sessions/revoke-others'),
};

export const userApi = {
  updateProfile: (displayName: string) => patch<T.User>('/users/me', { displayName }),
  preferences: () => get<T.Preference>('/users/me/preferences'),
  updatePreferences: (body: T.UpdatePreference) => patch<T.Preference>('/users/me/preferences', body),
  completeOnboarding: () => post<T.Preference>('/users/me/onboarding/complete'),
  availabilityRules: () => get<T.AvailabilityRule[]>('/users/me/availability'),
  replaceAvailability: (rules: Omit<T.AvailabilityRule, 'id'>[]) => put<T.AvailabilityRule[]>('/users/me/availability', { rules }),
  categories: () => get<T.Category[]>('/categories'),
};

// ── activities & tracking ────────────────────────────────────────────────────
export interface ActivityParams {
  from?: string;
  to?: string;
  status?: string[];
  categoryId?: string;
  q?: string;
  sort?: string;
  order?: string;
  page?: number;
  pageSize?: number;
}
export const activityApi = {
  list: (p: ActivityParams) => get<T.ActivityList>('/activities', p),
  get: (id: string) => get<T.Activity>(`/activities/${id}`),
  create: (body: T.CreateActivity) => post<T.Activity>('/activities', body),
  update: (id: string, body: T.UpdateActivity) => patch<T.Activity>(`/activities/${id}`, body),
  remove: (id: string) => del(`/activities/${id}`),
  reschedule: (id: string, body: { plannedStart: string; plannedEnd: string }) => post<T.Activity>(`/activities/${id}/reschedule`, body),
  duplicate: (id: string, plannedStart?: string) => post<T.Activity>(`/activities/${id}/duplicate`, plannedStart ? { plannedStart } : {}),
  complete: (id: string) => post<T.Activity>(`/activities/${id}/complete`),
  skip: (id: string) => post<T.Activity>(`/activities/${id}/skip`),
  cancel: (id: string) => post<T.Activity>(`/activities/${id}/cancel`),
  reopen: (id: string) => post<T.Activity>(`/activities/${id}/reopen`),
};

export const timerApi = {
  active: () => get<T.ActiveTimer>('/time-tracking/active'),
  start: (body: { activityId?: string; title?: string; categoryId?: string }) =>
    post<{ timer: T.ActiveTimer; switchedFromSessionId: string | null }>('/time-tracking/start', body),
  pause: (expectedVersion?: number) => post<T.ActiveTimer>('/time-tracking/pause', { expectedVersion }),
  resume: (expectedVersion?: number) => post<T.ActiveTimer>('/time-tracking/resume', { expectedVersion }),
  stop: (body: { complete?: boolean; note?: string; expectedVersion?: number } = {}) => post<T.ActiveTimer>('/time-tracking/stop', body),
  manual: (body: { activityId: string; startedAt: string; endedAt: string; note?: string }) => post<T.TimeSession>('/time-tracking/manual', body),
  sessions: (p: { from?: string; to?: string; activityId?: string; page?: number; pageSize?: number }) => get<T.SessionList>('/time-tracking/sessions', p),
  correct: (id: string, body: { startedAt: string; endedAt: string; note?: string; reason: string }) => patch<T.TimeSession>(`/time-tracking/sessions/${id}`, body),
  remove: (id: string, reason: string) => del(`/time-tracking/sessions/${id}`, { reason }),
  corrections: (id: string) => get<T.Correction[]>(`/time-tracking/sessions/${id}/corrections`),
};

// ── tasks ────────────────────────────────────────────────────────────────────
export interface TaskParams {
  status?: string[];
  priority?: string[];
  categoryId?: string;
  q?: string;
  due?: string;
  sort?: string;
  order?: string;
  page?: number;
  pageSize?: number;
}
export const taskApi = {
  list: (p: TaskParams) => get<T.TaskList>('/tasks', p),
  get: (id: string) => get<T.Task>(`/tasks/${id}`),
  create: (body: T.CreateTask) => post<T.Task>('/tasks', body),
  update: (id: string, body: T.UpdateTask) => patch<T.Task>(`/tasks/${id}`, body),
  remove: (id: string) => del(`/tasks/${id}`),
  complete: (id: string) => post<T.Task>(`/tasks/${id}/complete`),
  reopen: (id: string) => post<T.Task>(`/tasks/${id}/reopen`),
  setDependencies: (id: string, dependsOnIds: string[]) => put<T.Task>(`/tasks/${id}/dependencies`, { dependsOnIds }),
  schedule: (id: string, body: { start: string; end?: string }) => post<T.Activity>(`/tasks/${id}/schedule`, body),
  history: (id: string) => get<T.TaskHistoryEntry[]>(`/tasks/${id}/history`),
  addSubtask: (id: string, title: string) => post(`/tasks/${id}/subtasks`, { title }),
  updateSubtask: (id: string, subtaskId: string, body: { isDone?: boolean; title?: string }) => patch(`/tasks/${id}/subtasks/${subtaskId}`, body),
  removeSubtask: (id: string, subtaskId: string) => del(`/tasks/${id}/subtasks/${subtaskId}`),
};

// ── availability, scheduling, intelligence ───────────────────────────────────
export const availabilityApi = {
  day: (date?: string) => get<T.AvailabilityDay>('/availability/day', { date }),
  range: (from: string, to: string) => get<T.AvailabilityRangeDay[]>('/availability/range', { from, to }),
  conflicts: (from: string, to: string) => get<T.Conflict[]>('/availability/conflicts', { from, to }),
  slots: (p: { durationMin: number; from?: string; days?: number }) => get<T.Slot[]>('/availability/slots', p),
};

export const scheduleApi = {
  events: () => get<T.ScheduleEvent[]>('/schedule/events'),
  createEvent: (body: object) => post<T.ScheduleEvent>('/schedule/events', body),
  updateEvent: (id: string, body: object) => patch<T.ScheduleEvent>(`/schedule/events/${id}`, body),
  removeEvent: (id: string) => del(`/schedule/events/${id}`),
  skipOccurrence: (id: string, date: string) => post<T.ScheduleEvent>(`/schedule/events/${id}/skip`, { date }),
  materialise: (id: string, date: string) => post<T.Activity>(`/schedule/events/${id}/materialise`, { date }),
  plan: (body: { date?: string; taskIds?: string[] }) => post<T.Plan>('/scheduling/plan', body),
  apply: (blocks: { taskId: string; start: string; end: string }[]) => post<T.ApplyPlanResult>('/scheduling/apply', { blocks }),
};

export const energyApi = {
  overview: () => get<T.EnergyOverview>('/energy/overview'),
  logs: () => get<T.EnergyLog[]>('/energy/logs'),
  log: (body: { energy: T.Level; focus: T.Level; note?: string }) => post<T.EnergyLog>('/energy/logs', body),
};

export const recommendationApi = {
  generate: (body: { availableMinutes?: number; energy?: T.Level; focus?: T.Level; date?: string; limit?: number }) =>
    post<T.RecommendationBatch>('/recommendations/generate', body),
  latest: () => get<T.RecommendationBatch>('/recommendations/latest'),
  next: () => post<T.NextAction>('/recommendations/next'),
  accept: (id: string) => post<T.AcceptResult>(`/recommendations/${id}/accept`),
  dismiss: (id: string) => post<T.Recommendation>(`/recommendations/${id}/dismiss`),
};

// ── analytics ────────────────────────────────────────────────────────────────
export const analyticsApi = {
  dashboard: (date?: string) => get<T.Dashboard>('/analytics/dashboard', { date }),
  summary: (from: string, to: string) => get<T.AnalyticsSummary>('/analytics/summary', { from, to }),
  weekly: (date?: string) => get<T.Report>('/analytics/reports/weekly', { date }),
  monthly: (month?: string) => get<T.Report>('/analytics/reports/monthly', { month }),
  leakage: (from?: string, to?: string) => get<T.LeakageReport>('/productivity/leakage', { from, to }),
  patterns: () => get<T.PatternReport>('/productivity/patterns'),
};

export const coachApi = {
  status: () => get<T.CoachStatus>('/ai-coach/status'),
  send: (body: { message: string; conversationId?: string }) => post<T.CoachReply>('/ai-coach/messages', body),
  conversations: () => get<T.ConversationSummary[]>('/ai-coach/conversations'),
  conversation: (id: string) => get<T.ConversationDetail>(`/ai-coach/conversations/${id}`),
  remove: (id: string) => del(`/ai-coach/conversations/${id}`),
  confirm: (id: string) => post<{ action: T.PendingAction; result: Record<string, unknown> }>(`/ai-coach/actions/${id}/confirm`),
  reject: (id: string) => post<T.PendingAction>(`/ai-coach/actions/${id}/reject`),
};

export const notificationApi = {
  list: (unreadOnly = false) => get<T.NotificationList>('/notifications', { unreadOnly, pageSize: 50 }),
  unreadCount: () => get<{ count: number }>('/notifications/unread-count'),
  read: (id: string) => post(`/notifications/${id}/read`),
  readAll: () => post<{ count: number }>('/notifications/read-all'),
};
