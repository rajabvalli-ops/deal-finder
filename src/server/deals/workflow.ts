// Deal lifecycle state machine. Pure: services apply the result and write the audit log.
//
//   DETECTED ─submit─► PENDING_REVIEW ─approve─► APPROVED ─publish─► PUBLISHED
//        │                  │                       │                   │
//        └──── reject / expire (before publication) ┘                   ├─expire─► EXPIRED ─remove─► REMOVED
//                                                                       └─remove──────────────────► REMOVED

export const DEAL_STATUSES = [
  "DETECTED",
  "PENDING_REVIEW",
  "APPROVED",
  "PUBLISHED",
  "REJECTED",
  "EXPIRED",
  "REMOVED",
] as const;

export type DealStatus = (typeof DEAL_STATUSES)[number];

/** Statuses covered by the "one active deal per variant" unique index in the database. */
export const ACTIVE_DEAL_STATUSES: readonly DealStatus[] = [
  "DETECTED",
  "PENDING_REVIEW",
  "APPROVED",
  "PUBLISHED",
];

export type DealAction = "submit" | "approve" | "reject" | "publish" | "expire" | "remove";

/** `system` = background jobs and the deal engine; `editor` = EDITOR or ADMIN users. */
export type DealActor = "system" | "editor";

/** The deal timestamp a transition sets. */
export type DealTimestampField = "reviewedAt" | "publishedAt" | "expiredAt";

type Transition = {
  from: readonly DealStatus[];
  to: DealStatus;
  actors: readonly DealActor[];
  sets?: DealTimestampField;
};

const TRANSITIONS: Readonly<Record<DealAction, Transition>> = {
  submit: { from: ["DETECTED"], to: "PENDING_REVIEW", actors: ["system", "editor"] },
  approve: { from: ["PENDING_REVIEW"], to: "APPROVED", actors: ["editor"], sets: "reviewedAt" },
  reject: {
    from: ["DETECTED", "PENDING_REVIEW", "APPROVED"],
    to: "REJECTED",
    actors: ["editor"],
    sets: "reviewedAt",
  },
  publish: { from: ["APPROVED"], to: "PUBLISHED", actors: ["editor"], sets: "publishedAt" },
  expire: {
    from: ["DETECTED", "PENDING_REVIEW", "APPROVED", "PUBLISHED"],
    to: "EXPIRED",
    actors: ["system", "editor"],
    sets: "expiredAt",
  },
  remove: { from: ["APPROVED", "PUBLISHED", "EXPIRED"], to: "REMOVED", actors: ["editor"] },
};

export type TransitionResult =
  | { ok: true; from: DealStatus; to: DealStatus; sets: DealTimestampField | null }
  | { ok: false; error: "INVALID_TRANSITION" | "NOT_PERMITTED"; message: string };

export function transition(
  status: DealStatus,
  action: DealAction,
  actor: DealActor,
): TransitionResult {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(status)) {
    return {
      ok: false,
      error: "INVALID_TRANSITION",
      message: `Cannot ${action} a deal that is ${status}`,
    };
  }
  if (!rule.actors.includes(actor)) {
    return { ok: false, error: "NOT_PERMITTED", message: `A ${actor} cannot ${action} deals` };
  }
  return { ok: true, from: status, to: rule.to, sets: rule.sets ?? null };
}

/** Actions `actor` may take on a deal in `status`, in a stable order (for admin UI buttons). */
export function allowedActions(status: DealStatus, actor: DealActor): DealAction[] {
  return (Object.keys(TRANSITIONS) as DealAction[]).filter(
    (action) => transition(status, action, actor).ok,
  );
}

export function isActiveStatus(status: DealStatus): boolean {
  return ACTIVE_DEAL_STATUSES.includes(status);
}

/** Editors may change a deal's content until it reaches a final state. */
export function isEditable(status: DealStatus): boolean {
  return isActiveStatus(status);
}

/** Only published deals are shown on the public site. */
export function isPubliclyVisible(status: DealStatus): boolean {
  return status === "PUBLISHED";
}
