import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PolicyTranslationError,
  toApproval,
  toAuditEvent,
  toCreatePolicyRequest,
  toPage,
  WireApproval,
  WireAuditEvent,
  wirePage,
} from "@/lib/api/contract";

// The published contract examples are the source of truth for wire shapes.
const example = (name: string) =>
  JSON.parse(
    readFileSync(join(process.cwd(), "../../packages/contracts/examples", `${name}.json`), "utf8"),
  ) as unknown;

describe("v1 contract mapping", () => {
  it("parses the published approval page and keeps the binding digest for resolution", () => {
    const page = wirePage(WireApproval).parse(example("approval-page"));
    const vm = toPage(page, toApproval);
    expect(vm.data[0]).toMatchObject({
      action: "crm.customers.export",
      resource: "crm.customer_table/customers",
      status: "PENDING",
      bindingDigest: page.items[0]!.bindingDigest,
      resolvedBy: null,
    });
    expect(vm.hasMore).toBe(false);
  });

  it("parses the published audit page including hash-chain metadata", () => {
    const page = wirePage(WireAuditEvent).parse(example("audit-event-page"));
    const events = page.items.map(toAuditEvent);
    expect(events[0]).toMatchObject({ type: "DECISION_EVALUATED", agentId: "agent-crm-assistant", effect: "REQUIRE_APPROVAL" });
    expect(events[1]!.metadata?.previousEventHash).toBe(page.items[0]!.eventHash);
  });

  it("rejects responses that do not match the contract", () => {
    expect(wirePage(WireApproval).safeParse({ data: [], total: 0 }).success).toBe(false);
  });
});

describe("policy editor → aegis.policy/v1 DSL", () => {
  const base = { name: "Bulk Export Guard", description: "d", enabled: true };

  it("translates rules and conditions into the canonical DSL", () => {
    const body = toCreatePolicyRequest({
      ...base,
      rules: [
        {
          action: "crm.customers.export",
          resource: "crm.customer_table",
          effect: "REQUIRE_APPROVAL",
          conditions: [{ field: "resource.attributes.recordCount", operator: "gt", value: 1000 }],
        },
      ],
    });
    expect(body).toEqual({
      policyId: "bulk-export-guard",
      name: "Bulk Export Guard",
      description: "d",
      activate: true,
      expectedLatestVersion: null,
      document: {
        schemaVersion: "aegis.policy/v1",
        rules: [
          {
            id: "rule-1",
            effect: "REQUIRE_APPROVAL",
            actions: ["crm.customers.export"],
            resourceTypes: ["crm.customer_table"],
            when: { gt: [{ ref: "resource.attributes.recordCount" }, { value: 1000 }] },
            approval: { ttlSeconds: 3600 },
          },
        ],
      },
    });
  });

  it("refuses operators the DSL deliberately does not support", () => {
    for (const operator of ["contains", "matches"] as const) {
      expect(() =>
        toCreatePolicyRequest({
          ...base,
          rules: [{ action: "a.b", resource: "t", effect: "ALLOW", conditions: [{ field: "resource.id", operator, value: "x" }] }],
        }),
      ).toThrow(PolicyTranslationError);
    }
  });

  it("refuses condition fields that are not attribute references", () => {
    expect(() =>
      toCreatePolicyRequest({
        ...base,
        rules: [{ action: "a.b", resource: "t", effect: "ALLOW", conditions: [{ field: "process.env.SECRET", operator: "equals", value: "x" }] }],
      }),
    ).toThrow(PolicyTranslationError);
  });
});
