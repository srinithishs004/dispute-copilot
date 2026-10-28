// Shapes of GET /api/disputes/:id (server/src/routes/disputes.ts) and POST /approve (server/src/routes/actions.ts).

export type LocalState =
  | 'NEW'
  | 'ANALYZING'
  | 'READY_FOR_REVIEW'
  | 'ACTION_PENDING'
  | 'ACTION_SENT'
  | 'RESOLVED'
  | 'NEEDS_MANUAL';

export type DisputeAction = 'FIGHT' | 'OFFER' | 'ACCEPT';

export type AllowedActions = {
  fight: boolean;
  offer: boolean;
  accept: boolean;
  message: boolean;
  escalate: boolean;
  adjudicate: boolean;
};

export type Fact = { id: string; label: string; value: string };

export type EvidencePack = {
  disputeId: string;
  reason: string;
  amount: string;
  currency: string;
  facts: Fact[];
  checklist: { requirement: string; present: boolean }[];
  missing: string[];
};

export type Analysis = {
  recommendation: DisputeAction | string | null;
  confidence: number | null;
  evidenceStrength: 'STRONG' | 'MEDIUM' | 'WEAK' | string | null;
  reasons: string[];
  missingEvidence: string[];
  suggestedOffer: string | null;
  flags: string[];
  letterDraft: string | null;
  modelUsed: string | null;
  createdAt: string | null;
};

export type ActionEntry = {
  id: number;
  type: DisputeAction;
  state: 'PENDING' | 'SENT' | 'FAILED';
  error: string | null;
  createdAt: string;
  sentAt: string | null;
};

export type DeadlineFlag = 'due_soon' | 'overdue' | null;

export type DisputeDetail = {
  disputeId: string;
  reason: string | null;
  status: string | null;
  amount: string | null;
  currency: string | null;
  responseDueAt: string | null;
  localState: LocalState;
  originalAmount: string | null;
  deadlineFlag: DeadlineFlag | string;
  allowedActions: AllowedActions | null;
  outcome: string | null;
  actions: ActionEntry[];
  manualReason: string | null;
  evidence: EvidencePack | null;
  latestAnalysis: Analysis | null;
};

export type ApproveBody = { action: DisputeAction; note: string; offerAmount?: string };
export type ApproveResponse = { actionId: number; state: 'PENDING' };

/** One row of `sources.disputes` from GET /api/dashboard/data (server/src/routes/dashboard.ts). */
export type DashboardDispute = {
  disputeId: string;
  reason: string | null;
  status: string | null;
  localState: LocalState | string;
  originalAmount: number;
  /** Amount PayPal still reports once resolved; null while open. */
  finalAmount: number | null;
  /** What the seller kept on a resolved dispute; null while open. */
  amountKept: number | null;
  currency: string | null;
  responseDueAt: string | null;
  /** Whole days to the deadline; null when resolved or there is no deadline. */
  daysLeft: number | null;
  deadlineFlag: DeadlineFlag | string;
  recommendation: DisputeAction | string | null;
  confidence: number | null;
  evidenceStrength: string | null;
  outcome: string | null;
  createdAt: string | null;
};

export type DashboardAction = {
  disputeId: string;
  type: DisputeAction | string;
  state: string;
  createdAt: string | null;
  sentAt: string | null;
};

export type DashboardEvidenceGap = { disputeId: string; requirement: string };

export type DashboardFeed = {
  generatedAt: string;
  sources: {
    disputes: DashboardDispute[];
    actions: DashboardAction[];
    evidence_gaps: DashboardEvidenceGap[];
  };
};
