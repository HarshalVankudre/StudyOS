/**
 * Which deadlines and exams a student should hear about today. Uses the Daily
 * Study Agent's own reading of coursework (lib/agents/daily-study/classify)
 * and the editor's "is done" rule (lib/workspace/view-logic), so a reminder
 * agrees with the plan and the database views: a row marked done gets no
 * reminder, and an exam is whatever the planner treats as an exam.
 */
import { cleanText, datedRows, estimateEffortMinutes, rowCourse } from "@/lib/agents/daily-study/classify";
import { gradesWeightResolver } from "@/lib/agents/daily-study/grades-hook";
import type { Workspace } from "@/lib/workspace/types";
import { dayDiff } from "@/lib/workspace/view-logic";
import type { DeadlineReminder } from "./content";

export interface LeadSettings {
  deadlineLeads: number[];
  examLeads: number[];
}

/**
 * Administrative deadlines (registrations, re-registration, fees) are also
 * reminded this many days before, whatever lead times the student chose for
 * assignments: they take minutes and cannot be made up afterwards.
 */
export const FORMALITY_LEADS = [7, 3, 1] as const;

/**
 * Reminders due on `localDate`: open rows whose due day is exactly one of the
 * chosen lead times away. A formality uses the assignment lead times plus
 * FORMALITY_LEADS, and only while the student wants assignment reminders at
 * all (some assignment lead chosen; the deadline switch itself is checked by
 * the schedule). Nearest first.
 */
export function deadlineRemindersFor(
  workspaces: Workspace[],
  localDate: string,
  leads: LeadSettings,
): DeadlineReminder[] {
  const deadlineLeads = new Set(leads.deadlineLeads);
  const examLeads = new Set(leads.examLeads);
  const formalityLeads = new Set(deadlineLeads.size > 0 ? [...deadlineLeads, ...FORMALITY_LEADS] : []);
  if (deadlineLeads.size === 0 && examLeads.size === 0) return [];
  const weightOf = gradesWeightResolver();
  const out: DeadlineReminder[] = [];

  for (const workspace of workspaces) {
    for (const database of workspace.databases) {
      // Open rows with a due day, read the planner's way (lib/agents/daily-study/classify).
      for (const item of datedRows(workspace, database, { weightOf })) {
        const days = dayDiff(localDate, item.due);
        if (days < 1) continue;
        const exam = item.exam.isExam;
        const formality = item.formality;
        if (!(formality ? formalityLeads : exam ? examLeads : deadlineLeads).has(days)) continue;
        out.push({
          key: `deadline:${item.ledgerKey}:${item.due}:${days}`,
          title: item.title,
          context: rowCourse(workspace, database, item.row) ?? cleanText(workspace.name),
          dueDate: item.due,
          daysLeft: days,
          exam,
          ...(formality ? { formality: true } : {}),
          effortMinutes: exam || formality ? null : estimateEffortMinutes(database, item.row, item.title, item.weight),
          target: item.target,
        });
      }
    }
  }
  return out.sort(
    (a, b) => a.daysLeft - b.daysLeft || Number(b.exam) - Number(a.exam) || a.title.localeCompare(b.title),
  );
}
