import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePay, validateAttendance, validateWage, validDate } from '../lib/pay-rules.ts';
const shift = { status: 'present', clock_in_at: '2026-09-21T06:00:00Z', clock_out_at: '2026-09-21T16:00:00Z', break_minutes: 60, overtime_minutes: 120, sick_minutes: 0 };
const input = { status: 'present', clockIn: '08:00', clockOut: '18:00', breakMinutes: 60, overtimeMinutes: 120, sickMinutes: 0 };
test('hourly pay counts overtime once, subtracts lunch and rounds money', () => {
  assert.deepEqual(calculatePay('hourly_rate', 'weekly', 30, [shift]), { grossPay: 270, workedDays: 1, workedMinutes: 540, overtimeMinutes: 120, sickMinutes: 0 });
  assert.equal(calculatePay('hourly_rate', 'weekly', 31.11, [shift]).grossPay, 279.99);
});
test('fortnightly weekly salary pays two weeks; monthly salary pays one month', () => {
  assert.equal(calculatePay('weekly_salary', 'fortnightly', 1000, []).grossPay, 2000);
  assert.equal(calculatePay('weekly_salary', 'weekly', 1000, []).grossPay, 1000);
  assert.equal(calculatePay('monthly_salary', 'monthly', 5000, []).grossPay, 5000);
});
test('daily pay counts present days; sick time is tracked separately', () => {
  const sick = { ...shift, status: 'sick', clock_in_at: null, clock_out_at: null, break_minutes: 0, overtime_minutes: 0, sick_minutes: 480 };
  assert.equal(calculatePay('daily_rate', 'weekly', 250, [shift, sick]).grossPay, 250);
  assert.equal(calculatePay('daily_rate', 'weekly', 250, [shift, sick]).sickMinutes, 480);
});
test('incompatible salary frequencies and invalid dates are rejected', () => {
  assert.throws(() => validateWage('monthly_salary', 'weekly'));
  assert.throws(() => validateWage('weekly_salary', 'monthly'));
  assert.throws(() => validateWage('unknown', 'weekly'));
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('2028-02-29'), true);
});
test('invalid attendance cannot silently reduce or inflate pay', () => {
  for (const change of [{ breakMinutes: -1 }, { breakMinutes: 601 }, { overtimeMinutes: 541 }, { clockIn: '' }, { clockOut: '07:00' }, { status: 'absent' }, { sickMinutes: 1441 }, { breakMinutes: 1.5 }]) {
    assert.throws(() => validateAttendance({ ...input, ...change }));
  }
  assert.doesNotThrow(() => validateAttendance(input));
  assert.doesNotThrow(() => validateAttendance({ ...input, clockOut: '', breakMinutes: 0, overtimeMinutes: 0 }));
  assert.doesNotThrow(() => validateAttendance({ ...input, status: 'sick', clockIn: '', clockOut: '', breakMinutes: 0, overtimeMinutes: 0, sickMinutes: 480 }));
});
test('hourly payroll refuses incomplete and review-pending attendance', () => {
  assert.throws(() => calculatePay('hourly_rate', 'weekly', 30, [{ ...shift, clock_out_at: null }]), /Complete clock/);
  assert.throws(() => calculatePay('monthly_salary', 'monthly', 5000, [{ ...shift, status: 'pending_review' }]), /Resolve attendance/);
});
