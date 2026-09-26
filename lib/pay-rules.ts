export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateWage(wageType: string, frequency: string) {
  if (!["monthly_salary", "weekly_salary", "daily_rate", "hourly_rate"].includes(wageType)
    || !["monthly", "weekly", "fortnightly"].includes(frequency)) throw new Error("Choose a valid wage type and pay frequency.");
  if (wageType === "monthly_salary" && frequency !== "monthly") throw new Error("Monthly salaries must be paid monthly.");
  if (wageType === "weekly_salary" && frequency === "monthly") throw new Error("Weekly salaries must be paid weekly or every two weeks.");
}

export type AttendanceInput = {
  status: string; clockIn: string; clockOut: string;
  breakMinutes: number; overtimeMinutes: number; sickMinutes: number;
};

export function validateAttendance(input: AttendanceInput) {
  const { status, clockIn, clockOut, breakMinutes, overtimeMinutes, sickMinutes } = input;
  if (!["present", "absent", "sick", "leave", "pending_review"].includes(status)) throw new Error("Choose a valid attendance status.");
  for (const minutes of [breakMinutes, overtimeMinutes, sickMinutes]) {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) throw new Error("Hours and breaks must be between 0 and 24 hours, in whole minutes.");
  }
  for (const time of [clockIn, clockOut]) {
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Enter valid clock times.");
  }
  if (clockOut && !clockIn) throw new Error("Add a clock-in time before clocking out.");
  if (clockIn && status !== "present") throw new Error("Only present entries can include clock times.");
  if (status !== "present" && (breakMinutes || overtimeMinutes)) throw new Error("Only present entries can include breaks or overtime.");
  if (sickMinutes && !["sick", "present"].includes(status)) throw new Error("Sick hours require Sick or Present status.");
  if (!clockOut && (breakMinutes || overtimeMinutes)) throw new Error("Add both clock times before recording breaks or overtime.");
  if (clockIn && clockOut) {
    const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const elapsed = minutes(clockOut) - minutes(clockIn);
    if (elapsed < 0) throw new Error("Clock-out must follow clock-in. Split overnight shifts into separate dates.");
    if (breakMinutes > elapsed) throw new Error("Breaks cannot exceed the shift length.");
    if (overtimeMinutes > elapsed - breakMinutes) throw new Error("Overtime is part of worked hours and cannot exceed them.");
    if (elapsed - breakMinutes + sickMinutes > 1440) throw new Error("Worked and sick hours cannot exceed 24 hours in a day.");
  }
}

export type PayAttendance = { status: string; clock_in_at: string | null; clock_out_at: string | null; break_minutes: number; overtime_minutes: number; sick_minutes?: number };
export function calculatePay(wageType: string, frequency: string, rate: number, attendance: PayAttendance[]) {
  validateWage(wageType, frequency);
  if (!Number.isFinite(rate) || rate < 0) throw new Error("Enter a valid wage amount.");
  let workedDays = 0, workedMinutes = 0, overtimeMinutes = 0, sickMinutes = 0;
  for (const entry of attendance) {
    if (entry.status === "pending_review") throw new Error("Resolve attendance marked Review later before preparing pay.");
    sickMinutes += Number(entry.sick_minutes ?? 0);
    if (entry.status !== "present") continue;
    workedDays++;
    if (!entry.clock_in_at || !entry.clock_out_at) {
      if (wageType === "hourly_rate") throw new Error("Complete clock-in and clock-out for every present day before preparing hourly pay.");
      continue;
    }
    const elapsed = Math.round((Date.parse(entry.clock_out_at) - Date.parse(entry.clock_in_at)) / 60000);
    const net = elapsed - Number(entry.break_minutes);
    if (!Number.isFinite(net) || net < 0 || Number(entry.overtime_minutes) > net) throw new Error("Correct invalid attendance before preparing pay.");
    workedMinutes += net;
    overtimeMinutes += Number(entry.overtime_minutes);
  }
  // Overtime is included in clocked hours. Any agreed premium is entered as Extra pay.
  const gross = wageType === "hourly_rate" ? rate * workedMinutes / 60
    : wageType === "daily_rate" ? rate * workedDays
    : wageType === "weekly_salary" && frequency === "fortnightly" ? rate * 2 : rate;
  return { grossPay: Math.round(gross * 100) / 100, workedDays, workedMinutes, overtimeMinutes, sickMinutes };
}
