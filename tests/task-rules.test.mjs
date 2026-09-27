import assert from 'node:assert/strict';
import test from 'node:test';
import { taskMinutes, taskStatus } from '../lib/task-rules.ts';
test('manager sets a different duration for each task without a fixed default', () => {
  assert.equal(taskMinutes('7','minutes'),7);
  assert.equal(taskMinutes('35','minutes'),35);
  assert.equal(taskMinutes('2','hours'),120);
  assert.equal(taskMinutes('3','days'),4320);
  for (const value of ['', '0', '-1','1.5','Infinity','525601']) assert.throws(() => taskMinutes(value,'minutes'));
  assert.throws(() => taskMinutes('10','invalid'));
});
test('task status preserves late completion and does not hide overdue problems', () => {
  const t={due_at:'2026-09-27T10:00:00Z',completed_at:null,started_at:null,problem_note:null,seen_at:null};
  const before=Date.parse('2026-09-27T09:00:00Z'),after=Date.parse('2026-09-27T11:00:00Z');
  assert.equal(taskStatus(t,before),'Sent');
  assert.equal(taskStatus({...t,seen_at:'2026-09-27T09:00:00Z'},before),'Seen');
  assert.equal(taskStatus({...t,started_at:'2026-09-27T09:00:00Z'},before),'Started');
  assert.equal(taskStatus({...t,problem_note:'Stock unavailable'},before),'Needs help');
  assert.equal(taskStatus({...t,problem_note:'Stock unavailable'},after),'Overdue');
  assert.equal(taskStatus({...t,completed_at:'2026-09-27T09:50:00Z'},after),'Done');
  assert.equal(taskStatus({...t,completed_at:'2026-09-27T10:01:00Z'},after),'Done late');
});
