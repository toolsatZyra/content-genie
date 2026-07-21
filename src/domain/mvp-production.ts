export type MvpProductionJobState =
  | "queued"
  | "repair_planning"
  | "generating"
  | "sound_designing"
  | "rendering"
  | "review_ready"
  | "needs_repair"
  | "approved"
  | "export_ready"
  | "failed"
  | "canceled";

export interface MvpProductionJobView {
  readonly attempt_number: number;
  readonly completed_clips: number;
  readonly completed_storyboards: number;
  readonly completed_sfx: number;
  readonly last_error_code: string | null;
  readonly last_error_summary: string | null;
  readonly production_run_id: string;
  readonly state: MvpProductionJobState;
  readonly total_clips: number;
  readonly total_storyboards: number;
  readonly total_sfx: number;
  readonly version: number;
}

export interface MvpMasterView {
  readonly attempt_number: number;
  readonly duration_ms: number;
  readonly height: number;
  readonly id: string;
  readonly object_name: string;
  readonly state: "approved" | "pending_review" | "rejected" | "superseded";
  readonly version: number;
  readonly width: number;
}

export interface MvpEditPackageView {
  readonly byte_length: number | null;
  readonly id: string;
  readonly last_error_code: string | null;
  readonly last_error_summary: string | null;
  readonly master_id: string;
  readonly object_name: string | null;
  readonly state: "building" | "failed" | "queued" | "ready";
  readonly version: number;
}

export interface MvpRepairFeedbackPointView {
  readonly actions: readonly {
    readonly assetStatus: "planned" | "selected_complete_assets";
    readonly selectedAction: "clip_only" | "re_edit" | "storyboard_and_clip";
    readonly shotNumber: number;
  }[];
  readonly evidenceWindows: readonly {
    readonly endMs: number;
    readonly shotNumber: number;
    readonly startMs: number;
  }[];
  readonly feedbackPointIndex: number;
  readonly mappedShots: readonly number[];
  readonly resolution: "clarification" | "deterministic" | "model";
}

export interface MvpRepairProgressView {
  readonly affected_shots: number;
  readonly clarification_id: string | null;
  readonly clarification_question: string | null;
  readonly clarification_round: number | null;
  readonly clips_regenerated: number;
  readonly clips_reused: number;
  readonly clips_to_regenerate: number;
  readonly feedback_points: readonly MvpRepairFeedbackPointView[];
  readonly id: string;
  readonly last_error_code: string | null;
  readonly last_error_summary: string | null;
  readonly shots_selected: number;
  readonly state:
    | "awaiting_retry"
    | "analyzing"
    | "awaiting_clarification"
    | "planned"
    | "executing"
    | "complete"
    | "failed";
  readonly storyboards_regenerated: number;
  readonly storyboards_reused: number;
  readonly storyboards_to_regenerate: number;
  readonly target_attempt_number: number | null;
  readonly total_shots: number;
  readonly version: number;
}

export interface CreationProductionProjection {
  readonly job: MvpProductionJobView | null;
  readonly master: MvpMasterView | null;
  readonly package: MvpEditPackageView | null;
  readonly repair: MvpRepairProgressView | null;
  readonly productionRunId: string | null;
  /** Test-only fixture override. Live media is signed through the storage broker. */
  readonly signedMasterUrl: string | null;
}

export const emptyCreationProductionProjection: CreationProductionProjection = {
  job: null,
  master: null,
  package: null,
  repair: null,
  productionRunId: null,
  signedMasterUrl: null,
};
