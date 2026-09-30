import { describe, expect, it } from "vitest";
import { DealStatus as PrismaDealStatus } from "@/generated/prisma/enums";
import {
  ACTIVE_DEAL_STATUSES,
  allowedActions,
  DEAL_STATUSES,
  isActiveStatus,
  isEditable,
  isPubliclyVisible,
  transition,
  type DealAction,
  type DealStatus,
} from "./workflow";

describe("deal statuses", () => {
  it("match the database enum", () => {
    expect([...DEAL_STATUSES].sort()).toEqual(Object.values(PrismaDealStatus).sort());
  });
});

describe("allowedActions", () => {
  const editor: Record<DealStatus, DealAction[]> = {
    DETECTED: ["submit", "reject", "expire"],
    PENDING_REVIEW: ["approve", "reject", "expire"],
    APPROVED: ["reject", "publish", "expire", "remove"],
    PUBLISHED: ["expire", "remove"],
    REJECTED: [],
    EXPIRED: ["remove"],
    REMOVED: [],
  };
  const system: Record<DealStatus, DealAction[]> = {
    DETECTED: ["submit", "expire"],
    PENDING_REVIEW: ["expire"],
    APPROVED: ["expire"],
    PUBLISHED: ["expire"],
    REJECTED: [],
    EXPIRED: [],
    REMOVED: [],
  };

  it.each(DEAL_STATUSES)("editor actions on %s", (status) => {
    expect(allowedActions(status, "editor")).toEqual(editor[status]);
  });

  it.each(DEAL_STATUSES)("system actions on %s", (status) => {
    expect(allowedActions(status, "system")).toEqual(system[status]);
  });
});

describe("transition", () => {
  it.each([
    ["DETECTED", "submit", "PENDING_REVIEW", null],
    ["PENDING_REVIEW", "approve", "APPROVED", "reviewedAt"],
    ["PENDING_REVIEW", "reject", "REJECTED", "reviewedAt"],
    ["APPROVED", "publish", "PUBLISHED", "publishedAt"],
    ["PUBLISHED", "expire", "EXPIRED", "expiredAt"],
    ["PUBLISHED", "remove", "REMOVED", null],
    ["EXPIRED", "remove", "REMOVED", null],
  ] as const)("%s —%s→ %s (sets %s)", (from, action, to, sets) => {
    expect(transition(from, action, "editor")).toEqual({ ok: true, from, to, sets });
  });

  it("refuses transitions from the wrong status", () => {
    expect(transition("PENDING_REVIEW", "publish", "editor")).toEqual({
      ok: false,
      error: "INVALID_TRANSITION",
      message: "Cannot publish a deal that is PENDING_REVIEW",
    });
  });

  it("refuses actions the actor may not take", () => {
    expect(transition("PENDING_REVIEW", "approve", "system")).toEqual({
      ok: false,
      error: "NOT_PERMITTED",
      message: "A system cannot approve deals",
    });
  });

  it("can reach every status from DETECTED", () => {
    const seen = new Set<DealStatus>(["DETECTED"]);
    const queue: DealStatus[] = ["DETECTED"];
    while (queue.length) {
      const status = queue.shift()!;
      for (const action of allowedActions(status, "editor")) {
        const result = transition(status, action, "editor");
        if (result.ok && !seen.has(result.to)) {
          seen.add(result.to);
          queue.push(result.to);
        }
      }
    }
    expect([...seen].sort()).toEqual([...DEAL_STATUSES].sort());
  });
});

describe("status predicates", () => {
  it.each(DEAL_STATUSES)("%s", (status) => {
    const active = ACTIVE_DEAL_STATUSES.includes(status);
    expect(isActiveStatus(status)).toBe(active);
    expect(isEditable(status)).toBe(active);
    expect(isPubliclyVisible(status)).toBe(status === "PUBLISHED");
  });
});
