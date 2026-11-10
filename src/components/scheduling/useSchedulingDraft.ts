import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import type { ScheduleDayDto, ScheduleDayInput } from '../../api/scheduling';
import { useUnsavedChanges } from '../../app/unsavedChanges';

/** Preserve the existing editor conversion; never fill missing hours with examples. */
export function toWeekInputs(days: ScheduleDayDto[]): ScheduleDayInput[] {
  const shortTime = (value?: string | null) => value ? value.slice(0, 5) : '';
  return days.map((day) => ({
    dayOfWeek: day.dayOfWeek,
    open: day.open,
    startTime: day.open ? shortTime(day.startTime) : null,
    endTime: day.open ? shortTime(day.endTime) : null,
    breaks: day.breaks.map((b) => ({ startTime: shortTime(b.startTime), endTime: shortTime(b.endTime) })),
  }));
}

export interface WeekDraftController {
  draft: ScheduleDayInput[];
  errors: string[];
  setDraft: Dispatch<SetStateAction<ScheduleDayInput[]>>;
  setErrors: Dispatch<SetStateAction<string[]>>;
}

export function sameDraft(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useSchedulingDraftGuard(enabled: boolean, dirty: boolean, pending: boolean): void {
  useUnsavedChanges(enabled && dirty);
  useUnsavedChanges(enabled && pending, 'scheduling-operation');
}

/** Opt-in DENTIST lifecycle. Other WeekEditor consumers keep their local state. */
export function useDentistWeekDraft(
  days: ScheduleDayDto[],
  onSave: (payload: ScheduleDayInput[]) => Promise<ScheduleDayDto[]>,
  pending: boolean,
) {
  const incoming = useMemo(() => toWeekInputs(days), [days]);
  const [state, setState] = useState(() => ({ draft: incoming, baseline: incoming, errors: [] as string[], confirmation: 0 }));
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const dirty = !sameDraft(state.draft, state.baseline);
  // Adjust only this component's state before rendering children. Dirty drafts and
  // their errors survive cache updates, including refetches while a save is pending.
  if (!saving && !pending && !dirty && !sameDraft(state.baseline, incoming)) {
    setState({ ...state, draft: incoming, baseline: incoming, errors: [] });
  }
  useSchedulingDraftGuard(true, dirty, saving || pending);

  const controller: WeekDraftController = {
    draft: state.draft,
    errors: state.errors,
    setDraft: (action) => setState((previous) => ({
      ...previous,
      draft: typeof action === 'function' ? action(previous.draft) : action,
    })),
    setErrors: (action) => setState((previous) => ({
      ...previous,
      errors: typeof action === 'function' ? action(previous.errors) : action,
    })),
  };

  function save(payload: ScheduleDayInput[]) {
    if (inFlight.current || pending) return;
    inFlight.current = true;
    setSaving(true);
    const submitted = state.draft;
    void (async () => {
      try {
        const confirmed = toWeekInputs(await onSave(payload));
        if (!mounted.current) return;
        setState((previous) => ({
          ...previous,
          baseline: confirmed,
          confirmation: previous.confirmation + 1,
          // Detect any edit after submission, even a revert to submitted values.
          ...(previous.draft === submitted ? { draft: confirmed, errors: [] } : {}),
        }));
      } catch {
        // The panel presents the mutation error. Keep the draft, baseline and errors.
      } finally {
        inFlight.current = false;
        if (mounted.current) setSaving(false);
      }
    })();
  }

  function discard() {
    if (inFlight.current || pending) return;
    setState((previous) => ({ ...previous, draft: incoming, baseline: incoming, errors: [] }));
  }

  return { controller, save, discard, dirty, confirmation: state.confirmation, pending: saving || pending };
}
