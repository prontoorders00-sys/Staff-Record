export function taskMinutes(value: string, unit: string): number {
  const amount = Number(value);
  const multiplier = unit === 'minutes' ? 1 : unit === 'hours' ? 60 : unit === 'days' ? 1440 : 0;
  const minutes = amount * multiplier;
  if (!value.trim() || !multiplier || !Number.isSafeInteger(amount) || amount <= 0 || minutes > 525600) {
    throw new Error('Enter a whole number of minutes, hours or days (up to one year).');
  }
  return minutes;
}
export function taskStatus(task: { completed_at: string | null; due_at: string | null; started_at: string | null; problem_note: string | null; seen_at?: string | null }, now = Date.now()) {
  if (task.completed_at) return task.due_at && Date.parse(task.completed_at) > Date.parse(task.due_at) ? 'Done late' : 'Done';
  if (task.due_at && Date.parse(task.due_at) < now) return 'Overdue';
  if (task.problem_note) return 'Needs help';
  if (task.started_at) return 'Started';
  return task.seen_at ? 'Seen' : 'Sent';
}
