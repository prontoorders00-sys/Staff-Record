import assert from "node:assert/strict";
import test from "node:test";
import { attendanceTime } from "../lib/format.ts";

test("saved UTC attendance survives an unchanged Johannesburg form submission", () => {
  for (const original of ["2026-09-25T06:00:00+00:00", "2026-09-25T15:30:00+00:00", "2026-09-24T22:15:00+00:00"]) {
    const time = attendanceTime(original);
    const submitted = `2026-09-25T${time}:00+02:00`;
    assert.equal(Date.parse(submitted), Date.parse(original));
  }
});
test("local offsets and empty attendance render correctly", () => {
  assert.equal(attendanceTime("2026-09-25T08:00:00+02:00"), "08:00");
  assert.equal(attendanceTime(null), "");
  assert.equal(attendanceTime(undefined), "");
});
