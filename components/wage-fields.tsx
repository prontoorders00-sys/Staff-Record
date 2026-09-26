"use client";

import { useState } from "react";
export function WageFields({ wageType = "monthly_salary", payFrequency = "monthly", wageRate = "" }: {
  wageType?: string; payFrequency?: string; wageRate?: string | number;
}) {
  const [type, setType] = useState(wageType);
  const [frequency, setFrequency] = useState(payFrequency);
  return <>
    <div className="form-grid">
      <label>Wage type<select name="wageType" value={type} onChange={(e) => {
        const next = e.target.value;
        setType(next);
        if (next === "monthly_salary") setFrequency("monthly");
        if (next === "weekly_salary" && frequency === "monthly") setFrequency("weekly");
      }}>
        <option value="monthly_salary">Monthly salary</option><option value="weekly_salary">Weekly salary</option>
        <option value="daily_rate">Daily rate</option><option value="hourly_rate">Hourly rate</option>
      </select></label>
      <label>Pay frequency<select name="payFrequency" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
        {type !== "weekly_salary" && <option value="monthly">Monthly</option>}
        {type !== "monthly_salary" && <><option value="weekly">Weekly</option><option value="fortnightly">Every 2 weeks</option></>}
      </select></label>
    </div>
    <label>{type === "weekly_salary" ? "Salary per week (R)" : type === "monthly_salary" ? "Salary per month (R)" : type === "hourly_rate" ? "Rate per hour (R)" : "Rate per day (R)"}<input name="wageRate" type="number" min="0" max="99999999.99" step="0.01" defaultValue={wageRate} required /></label>
    {type === "weekly_salary" && frequency === "fortnightly" && <p className="muted">Each two-week pay period uses twice the weekly salary.</p>}
  </>;
}
