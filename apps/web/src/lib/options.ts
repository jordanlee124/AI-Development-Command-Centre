export interface Option {
  /** null is "none"; it submits an empty string. */
  value: string | null;
  label: string;
}

/** Label/value records (like TASK_STATUS_LABELS) → select options. */
export function optionsFrom<T extends string>(labels: Record<T, string>): Option[] {
  return (Object.entries(labels) as [T, string][]).map(([value, label]) => ({ value, label }));
}
