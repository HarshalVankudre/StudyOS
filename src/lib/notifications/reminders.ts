/**
 * Which deadlines and exams a student should hear about today. Uses the Daily
 * Study Agent's own reading of coursework (lib/agents/daily-study/classify)
 * and the editor's "is done" rule (lib/workspace/view-logic), so a reminder
 * agrees with the plan and the database views: a row marked done gets no
 * reminder, and an exam is whatever the planner treats as an exam.
 */
import {
  classifyExam,
  estimateEffortMinutes,
  rowCourse,
  rowDueDate,
  rowTitle,
  rowWeight,
  cleanText,
} from "@/lib/agents/daily-study/classify";
import { gradesWeightResolver } from "@/lib/agents/daily-study/grades-hook";
import { pageForDatabase } from "@/lib/workspace/deep-link";
import type { Workspace } from "@/lib/workspace/types";
import { completionField, dayDiff, isRowComplete } from "@/lib/workspace/view-logic";
import type { DeadlineReminder } from "./content";

export interface LeadSettings {
  deadlineLeads: number[];
  examLeads: number[];
}

/**
 * Reminders due on `localDate`: open rows whose due day is exactly one of the
 * chosen lead times away. Nearest first.
 */
export function deadlineRemindersFor(
  workspaces: Workspace[],
  localDate: string,
  leads: LeadSettings,
): DeadlineReminder[] {
  const deadlineLeads = new Set(leads.deadlineLeads);
  const examLeads = new Set(leads.examLeads);
  if (deadlineLeads.size === 0 && examLeads.size === 0) return [];
  const weightOf = gradesWeightResolver();
  const out: DeadlineReminder[] = [];

  for (const workspace of workspaces) {
    for (const database of workspace.databases) {
      if (!database.properties.some((p) => p.type === "date")) continue;
      const field = completionField(database);
      const pageId = pageForDatabase(workspace, database.id);
      for (const row of database.rows) {
        if (isRowComplete(database, row, field)) continue;
        const due = rowDueDate(database, row);
        if (!due) continue;
        const days = dayDiff(localDate, due);
        if (days < 1) continue;
        const title = rowTitle(database, row) ?? cleanText(database.name);
        if (!title) continue;
        const weight = weightOf(workspace, database, row) ?? rowWeight(database, row);
        const exam = classifyExam(database, row, title, weight).isExam;
        if (!(exam ? examLeads : deadlineLeads).has(days)) continue;
        out.push({
          key: `deadline:${workspace.id}:${database.id}:${row.id}:${due}:${days}`,
          title,
          context: rowCourse(workspace, database, row) ?? cleanText(workspace.name),
          dueDate: due,
          daysLeft: days,
          exam,
          effortMinutes: exam ? null : estimateEffortMinutes(database, row, title, weight),
          target: {
            workspaceId: workspace.id,
            ...(pageId ? { pageId } : {}),
            databaseId: database.id,
            rowId: row.id,
          },
        });
      }
    }
  }
  return out.sort(
    (a, b) => a.daysLeft - b.daysLeft || Number(b.exam) - Number(a.exam) || a.title.localeCompare(b.title),
  );
}
