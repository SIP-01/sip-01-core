import { describe, expect, it } from "vitest";
import { suggestCapabilities } from "../ai/capabilityPlugin";
import { buildCapabilityEvent, parseCapabilityEvent } from "./capability";

describe("kind 39698 capability announcements", () => {
  it("round-trips without using kind 39697 fields", () => {
    const draft = buildCapabilityEvent({
      id: "echo-tool",
      name: "Echo",
      summary: "Returns text",
      role: "tool",
      protocols: ["mcp"],
      capabilities: ["echo", "text"],
      price: "free",
      endpoint: "https://example.com/mcp",
    });
    expect(draft?.kind).toBe(39698);
    expect(draft?.tags.find((tag) => tag[0] === "u")).toBeUndefined();
    const parsed = parseCapabilityEvent(
      {
        kind: draft!.kind,
        content: draft!.content,
        tags: draft!.tags,
        created_at: draft!.created_at,
        pubkey: "a".repeat(64),
      },
      "relay",
    );
    expect(parsed?.name).toBe("Echo");
    expect(parsed?.role).toBe("tool");
  });

  it("rejects javascript endpoints", () => {
    expect(
      buildCapabilityEvent({
        id: "bad",
        name: "X",
        summary: "Y",
        role: "tool",
        protocols: ["http"],
        capabilities: [],
        price: "free",
        endpoint: "javascript:alert(1)",
      }),
    ).toBeNull();
  });

  it("suggests a free echo tool without calling it", () => {
    const hits = suggestCapabilities("echo some text for free", [
      {
        name: "Echo",
        summary: "Returns text",
        role: "tool",
        protocols: ["mcp"],
        capabilities: ["echo", "text"],
        price: "free",
      },
    ]);
    expect(hits[0]?.name).toBe("Echo");
    expect(hits[0]!.score).toBeGreaterThan(0);
  });
});
