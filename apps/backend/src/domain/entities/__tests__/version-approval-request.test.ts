import {
  VersionApprovalRequest,
  type ApprovalVote,
} from "../version-approval-request.js";

const make = (overrides: Partial<{
  requestedBy: string;
  requiredApprovals: number;
}> = {}): VersionApprovalRequest =>
  VersionApprovalRequest.create({
    id: "r1",
    organizationId: "o1",
    promptId: "p1",
    versionId: "v1",
    requestedBy: overrides.requestedBy ?? "requester",
    requiredApprovals: overrides.requiredApprovals ?? 2,
  });

describe("VersionApprovalRequest aggregate", () => {
  it("starts pending with empty vote arrays", () => {
    const r = make();
    expect(r.status).toBe("pending");
    expect(r.approvals).toEqual([]);
    expect(r.rejections).toEqual([]);
    expect(r.resolvedAt).toBeNull();
    expect(r.revision).toBe(0);
  });

  it("rejects non-positive thresholds at creation", () => {
    expect(() => make({ requiredApprovals: 0 })).toThrow(/positive/);
    expect(() => make({ requiredApprovals: 1.5 })).toThrow(/positive/);
  });

  it("accumulates approvals while below threshold", () => {
    const r = make({ requiredApprovals: 3 });
    r.approve("u1");
    expect(r.status).toBe("pending");
    expect(r.approvals.map((v) => v.userId)).toEqual(["u1"]);
    expect(r.approvals[0]?.userId).toBe("u1");
    expect(r.approvals[0]?.decidedAt).toBeInstanceOf(Date);
    expect(r.approvals[0]?.comment).toBeNull();
    expect(r.resolvedAt).toBeNull();
    r.approve("u2");
    expect(r.status).toBe("pending");
    expect(r.approvals.map((v) => v.userId)).toEqual(["u1", "u2"]);
  });

  it("captures decidedAt and an optional trimmed comment on each vote", () => {
    const r = make({ requiredApprovals: 2 });
    const t = new Date("2026-04-30T10:00:00Z");
    r.approve("u1", { now: t, comment: "  looks good  " });
    expect(r.approvals[0]).toEqual({
      userId: "u1",
      decidedAt: t,
      comment: "looks good",
    });
    r.approve("u2", { now: t, comment: "" });
    // Empty / whitespace-only comments normalise to null.
    expect(r.approvals[1]?.comment).toBeNull();
  });

  it("auto-resolves to approved when threshold is reached", () => {
    const r = make({ requiredApprovals: 2 });
    r.approve("u1");
    r.approve("u2");
    expect(r.status).toBe("approved");
    expect(r.isApproved).toBe(true);
    expect(r.resolvedAt).toBeInstanceOf(Date);
  });

  it("rejects self-approval by the requester", () => {
    const r = make({ requestedBy: "requester" });
    expect(() => r.approve("requester")).toThrow(/own approval request/i);
  });

  it("rejects duplicate votes (same direction)", () => {
    const r = make({ requiredApprovals: 3 });
    r.approve("u1");
    expect(() => r.approve("u1")).toThrow(/already voted/i);
  });

  it("rejects voting in the opposite direction after first vote", () => {
    const r = make({ requiredApprovals: 3 });
    r.approve("u1");
    expect(() => r.reject("u1")).toThrow(/already voted/i);
  });

  it("any rejection resolves immediately as rejected", () => {
    const r = make({ requiredApprovals: 5 });
    r.approve("u1");
    r.approve("u2");
    r.reject("u3", { comment: "blocking on legal review" });
    expect(r.status).toBe("rejected");
    expect(r.rejections[0]?.userId).toBe("u3");
    expect(r.rejections[0]?.comment).toBe("blocking on legal review");
    expect(r.resolvedAt).toBeInstanceOf(Date);
  });

  it("rejects votes after resolution", () => {
    const r = make({ requiredApprovals: 1 });
    r.approve("u1");
    expect(() => r.approve("u2")).toThrow(/no longer pending/i);
    expect(() => r.reject("u3")).toThrow(/no longer pending/i);
    expect(() => r.cancel()).toThrow(/no longer pending/i);
  });

  it("cancel transitions pending → cancelled", () => {
    const r = make();
    r.cancel();
    expect(r.status).toBe("cancelled");
    expect(r.resolvedAt).toBeInstanceOf(Date);
  });

  it("snapshot+markPersisted advances revision", () => {
    const r = make();
    const snap = r.toSnapshot();
    expect(snap.expectedRevision).toBe(0);
    expect(snap.primitives.revision).toBe(1);
    expect(r.revision).toBe(0);
    r.markPersisted();
    expect(r.revision).toBe(1);
  });

  it("hydrate clones array fields so callers can't mutate internal state", () => {
    const r = make();
    r.approve("u1");
    const snap = r.toSnapshot();
    const r2 = VersionApprovalRequest.hydrate(snap.primitives);
    (snap.primitives.approvals as ApprovalVote[]).push({
      userId: "hacker",
      decidedAt: new Date(),
      comment: null,
    });
    expect(r2.approvals.map((v) => v.userId)).toEqual(["u1"]);
  });
});
