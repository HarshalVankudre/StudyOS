/**
 * Shapes shared by the study-kit API routes and the dialog. Pure types.
 */
import type { QuizQuestion, SourceRef } from "@/lib/workspace/types";
import type { KitAmount, KitOutputs } from "./limits";

export type MaterialKind = "pdf" | "docx" | "text" | "page";

/** A stored material as listed in a workspace (no page text). */
export interface MaterialSummary {
  id: string;
  title: string;
  kind: MaterialKind;
  pageCount: number;
  /** Characters per page, so the dialog can plan a run and show its cost. */
  pageChars: number[];
  charCount: number;
  /** Pages in the original document; more than pageCount when it was cut. */
  sourcePages: number;
  truncated: boolean;
  /** For kind "page": the workspace page the text came from. */
  sourcePageId: string | null;
  createdAt: string;
}

/** One page of a material, for the citation viewer. */
export interface MaterialPage {
  id: string;
  title: string;
  page: number;
  pageCount: number;
  text: string;
}

export interface KitNoteSection {
  heading: string;
  points: string[];
  /** 1-based page the section mostly summarises. */
  page?: number;
}

export interface KitCard {
  id: string;
  front: string;
  back: string;
  source: SourceRef;
}

export interface KitStats {
  /** Cards and questions the model proposed (well-formed ones). */
  proposed: number;
  /** Dropped because their quote could not be found on the cited pages. */
  unverified: number;
  /** Dropped because they were malformed (bad JSON item, impossible answer). */
  malformed: number;
  /** Dropped as duplicates or near-duplicates of another item. */
  duplicates: number;
  /** Verified items left over after balancing to the requested amount. */
  surplus: number;
  sections: number;
  failedSections: number;
  /** Page ranges of sections that produced nothing (failed or ran out of time). */
  failedRanges: { from: number; to: number }[];
}

export interface KitResult {
  materialId: string;
  title: string;
  /** Pages this run read (1-based, inclusive). */
  from: number;
  to: number;
  pageCount: number;
  notes: KitNoteSection[];
  cards: KitCard[];
  questions: QuizQuestion[];
  stats: KitStats;
}

export type KitLanguage = "material" | "interface";

export interface KitRequest {
  workspaceId: string;
  materialId: string;
  outputs: KitOutputs;
  amount: KitAmount;
  range?: { from: number; to: number };
  language: KitLanguage;
  generationId?: string;
}

export type KitErrorCode =
  | "out_of_credits"
  | "rate_limited"
  | "not_found"
  | "invalid"
  | "generation_failed"
  | "too_many_failures"
  | "not_configured";

/** One NDJSON line of POST /api/materials/generate. */
export type KitEvent =
  | {
      type: "start";
      sections: { from: number; to: number }[];
      from: number;
      to: number;
      estimate: number;
      maxCredits: number;
    }
  | {
      type: "section";
      index: number;
      status: "working" | "retrying" | "done" | "failed";
      /** Verified items this section contributed (when done). */
      made?: number;
    }
  | { type: "checking" }
  | { type: "complete"; result: KitResult; credits: number; balance: number }
  | { type: "error"; code: KitErrorCode; message: string };
