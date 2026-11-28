import { describe, expect, it } from "vitest";
import { picksByScope } from "../src/chat/planning/commit";
import { settleReviewerPick } from "../src/engines/agent-fields";
import { reviewOf } from "../src/engines/video/scenes/maker";
import type { AgentPick } from "../src/studio/repositories/provider-settings";
import type { StudioRepositories } from "../src/studio/repositories";

/** Repositories that remember only the given picks. */
function reposWith(picks: AgentPick[]): StudioRepositories {
  return { providerSettings: { listPicks: async () => picks } } as unknown as StudioRepositories;
}

describe("a video planned with a reviewer pick", () => {
  it("asks for no fresh viewer when the reviewer is off", async () => {
    const picks = await picksByScope(
      reposWith([
        {
          scope: "video",
          agent: "claude",
          model: "opus",
          effort: "low",
          updatedAt: "2026-11-28T00:00:00.000Z",
        },
        { scope: "video.review", off: true, updatedAt: "2026-11-28T00:00:00.000Z" },
      ]),
      "owner-1",
    );
    expect(picks).toEqual({
      video: { agent: "claude", model: "opus", effort: "low" },
      "video.review": { off: true },
    });
    expect(settleReviewerPick("video", {}, picks)).toEqual({ reviewer: "off" });
    expect(reviewOf({ minutes: 0, aspect: "portrait", reviewer: "off" }, undefined)).toEqual({
      review: false,
    });
  });

  it("asks for the picked reviewer, on its model and effort", async () => {
    const picks = await picksByScope(
      reposWith([
        {
          scope: "video.review",
          agent: "claude",
          model: "opus",
          effort: "low",
          updatedAt: "2026-11-28T00:00:00.000Z",
        },
      ]),
      "owner-1",
    );
    expect(picks).toEqual({ "video.review": { agent: "claude", model: "opus", effort: "low" } });
    expect(settleReviewerPick("video", {}, picks)).toEqual({
      reviewer: "agent:claude:opus",
      reviewEffort: "low",
    });
    expect(
      reviewOf({ minutes: 0, aspect: "portrait", reviewer: "agent:claude:opus", reviewEffort: "low" }, undefined),
    ).toEqual({
      review: true,
      reviewAgent: "claude",
      reviewModel: "opus",
      reviewEffort: "low",
    });
  });
});
