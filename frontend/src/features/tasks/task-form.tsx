'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, DialogContent } from '@/components/ui/overlay';
import { useApiMutation } from '@/hooks/use-mutation-toast';
import { fromLocalInput, toLocalInput } from '@/lib/time';
import { taskApi } from '@/services';
import { LEVELS, PRIORITIES, TIMES_OF_DAY, type Task } from '@/types';
import { levelLabel, useCategories, useOpenTasks } from '../shared/hooks';

export const taskSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the task a title').max(160, 'Use 160 characters or fewer'),
    description: z.string().max(4000).optional(),
    estimatedMin: z.string().regex(/^\d+$/, 'Enter whole minutes').refine((v) => Number(v) >= 1 && Number(v) <= 1440, 'Enter 1 to 1440 minutes'),
    priority: z.enum(PRIORITIES),
    deadline: z.string().optional(),
    categoryId: z.string().optional(),
    energyRequired: z.enum(LEVELS),
    focusRequired: z.enum(LEVELS),
    complexity: z.string().regex(/^[1-5]$/, 'Choose 1 to 5'),
    status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS']),
    preferredTimeOfDay: z.enum(TIMES_OF_DAY),
    tags: z.string().optional(),
    subtasks: z.string().optional(),
    dependsOnIds: z.array(z.string()),
    recurrence: z.enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY']),
    byWeekday: z.array(z.string()),
  })
  .refine((v) => v.recurrence !== 'WEEKLY' || v.byWeekday.length > 0, { path: ['byWeekday'], message: 'Pick at least one weekday' });

export type TaskFormValues = z.infer<typeof taskSchema>;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const parseTags = (s?: string): string[] => (s ?? '').split(',').map((t) => t.trim()).filter(Boolean);

const blank = (): TaskFormValues => ({
  title: '',
  description: '',
  estimatedMin: '30',
  priority: 'MEDIUM',
  deadline: '',
  categoryId: '',
  energyRequired: 'MODERATE',
  focusRequired: 'MODERATE',
  complexity: '3',
  status: 'TODO',
  preferredTimeOfDay: 'ANY',
  tags: '',
  subtasks: '',
  dependsOnIds: [],
  recurrence: 'NONE',
  byWeekday: [],
});

export function TaskFormDialog({ open, onOpenChange, tz, task }: { open: boolean; onOpenChange: (open: boolean) => void; tz: string; task?: Task }) {
  const editing = Boolean(task);
  const categories = useCategories();
  const openTasks = useOpenTasks(open && !editing);
  const { register, handleSubmit, reset, watch, formState } = useForm<TaskFormValues>({ resolver: zodResolver(taskSchema), defaultValues: blank() });
  const recurrence = watch('recurrence');

  useEffect(() => {
    if (!open) return;
    if (task) {
      reset({
        ...blank(),
        title: task.title,
        description: task.description ?? '',
        estimatedMin: String(Math.round(task.estimatedDurationSec / 60)),
        priority: task.priority,
        deadline: task.deadline ? toLocalInput(task.deadline, tz) : '',
        categoryId: task.category?.id ?? '',
        energyRequired: task.energyRequired,
        focusRequired: task.focusRequired,
        complexity: String(task.complexity),
        status: task.status === 'COMPLETED' || task.status === 'CANCELLED' ? 'TODO' : task.status,
        preferredTimeOfDay: task.preferredTimeOfDay,
        tags: task.tags.join(', '),
      });
    } else reset(blank());
  }, [open, task, tz, reset]);

  const save = useApiMutation({
    mutationFn: (v: TaskFormValues) => {
      const common = {
        title: v.title,
        description: v.description || undefined,
        estimatedDurationSec: Number(v.estimatedMin) * 60,
        priority: v.priority,
        energyRequired: v.energyRequired,
        focusRequired: v.focusRequired,
        complexity: Number(v.complexity),
        preferredTimeOfDay: v.preferredTimeOfDay,
        tags: parseTags(v.tags),
        status: v.status,
      };
      if (editing) {
        return taskApi.update(task!.id, {
          ...common,
          description: v.description || null,
          deadline: v.deadline ? fromLocalInput(v.deadline, tz) : null,
          categoryId: v.categoryId || null,
        } as never);
      }
      return taskApi.create({
        ...common,
        deadline: v.deadline ? fromLocalInput(v.deadline, tz) : undefined,
        categoryId: v.categoryId || undefined,
        dependsOnIds: v.dependsOnIds.length ? v.dependsOnIds : undefined,
        subtasks: v.subtasks?.split('\n').map((s) => s.trim()).filter(Boolean),
        recurrence: v.recurrence === 'NONE' ? undefined : { frequency: v.recurrence, ...(v.recurrence === 'WEEKLY' ? { byWeekday: v.byWeekday.map(Number) } : {}) },
      } as never);
    },
    successMessage: editing ? 'Task updated' : 'Task created',
    onSuccess: () => onOpenChange(false),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={editing ? 'Edit task' : 'New task'} description="Estimates, energy and deadlines drive recommendations." className="max-w-2xl">
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="space-y-4">
          <Field label="Title" error={formState.errors.title?.message}>
            {(p) => <Input {...p} autoFocus {...register('title')} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Estimate (minutes)" error={formState.errors.estimatedMin?.message}>
              {(p) => <Input {...p} inputMode="numeric" {...register('estimatedMin')} />}
            </Field>
            <Field label="Priority">
              {(p) => (
                <Select {...p} {...register('priority')}>
                  {PRIORITIES.map((x) => (
                    <option key={x} value={x}>
                      {x.charAt(0) + x.slice(1).toLowerCase()}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Status">
              {(p) => (
                <Select {...p} {...register('status')}>
                  <option value="TODO">To do</option>
                  <option value="IN_PROGRESS">In progress</option>
                  <option value="BACKLOG">Backlog</option>
                </Select>
              )}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Deadline" hint={`Time zone: ${tz}`}>
              {(p) => <Input {...p} type="datetime-local" {...register('deadline')} />}
            </Field>
            <Field label="Category">
              {(p) => (
                <Select {...p} {...register('categoryId')}>
                  <option value="">None</option>
                  {categories.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Energy needed">
              {(p) => (
                <Select {...p} {...register('energyRequired')}>
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {levelLabel(l)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Focus needed">
              {(p) => (
                <Select {...p} {...register('focusRequired')}>
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {levelLabel(l)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Complexity" error={formState.errors.complexity?.message}>
              {(p) => (
                <Select {...p} {...register('complexity')}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} / 5
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Best time of day">
              {(p) => (
                <Select {...p} {...register('preferredTimeOfDay')}>
                  {TIMES_OF_DAY.map((t) => (
                    <option key={t} value={t}>
                      {t === 'ANY' ? 'Any time' : t.charAt(0) + t.slice(1).toLowerCase()}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Tags" hint="Comma separated">
            {(p) => <Input {...p} {...register('tags')} />}
          </Field>
          <Field label="Description">{(p) => <Textarea {...p} rows={2} {...register('description')} />}</Field>

          {!editing && (
            <>
              <Field label="Subtasks" hint="One per line">
                {(p) => <Textarea {...p} rows={3} {...register('subtasks')} />}
              </Field>
              <fieldset className="rounded-lg border border-border p-4">
                <legend className="px-1 text-[13px] font-medium text-fg-secondary">Depends on</legend>
                {openTasks.data?.items.length ? (
                  <div className="max-h-36 space-y-1.5 overflow-y-auto">
                    {openTasks.data.items.map((t) => (
                      <label key={t.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-fg-secondary">
                        <Checkbox value={t.id} {...register('dependsOnIds')} /> {t.title}
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] text-fg-muted">No other open tasks to depend on.</p>
                )}
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Repeats">
                  {(p) => (
                    <Select {...p} {...register('recurrence')}>
                      <option value="NONE">Does not repeat</option>
                      <option value="DAILY">Daily</option>
                      <option value="WEEKLY">Weekly</option>
                      <option value="MONTHLY">Monthly</option>
                    </Select>
                  )}
                </Field>
                {recurrence === 'WEEKLY' && (
                  <fieldset>
                    <legend className="mb-1.5 text-[13px] font-medium text-fg-secondary">On</legend>
                    <div className="flex flex-wrap gap-1.5">
                      {WEEKDAYS.map((d, i) => (
                        <label key={d} className="cursor-pointer">
                          <input type="checkbox" value={String(i + 1)} className="peer sr-only" {...register('byWeekday')} />
                          <span className="inline-block rounded-md border border-border px-2.5 py-1.5 text-xs text-fg-secondary transition-colors peer-checked:border-primary/40 peer-checked:bg-primary-soft peer-checked:text-primary peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-primary">{d}</span>
                        </label>
                      ))}
                    </div>
                    {formState.errors.byWeekday && <p role="alert" className="mt-1.5 text-xs text-danger">{formState.errors.byWeekday.message}</p>}
                  </fieldset>
                )}
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={save.isPending}>
              {editing ? 'Save changes' : 'Create task'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
