/** Shared formatting utilities for AEGIS console */

import { formatDistanceToNow, format, isAfter } from "date-fns";
import type { DecisionEffect, ApprovalStatus, AuditEventType } from "@/lib/api/types";

/** Format an ISO datetime to a human-readable relative time */
export function formatRelativeTime(isoDate: string): string {
  try {
    return formatDistanceToNow(new Date(isoDate), { addSuffix: true });
  } catch {
    return "Unknown time";
  }
}

/** Format an ISO datetime to absolute display */
export function formatAbsoluteTime(isoDate: string): string {
  try {
    return format(new Date(isoDate), "MMM d, yyyy HH:mm:ss");
  } catch {
    return "Invalid date";
  }
}

/** Format an ISO datetime to short display */
export function formatShortTime(isoDate: string): string {
  try {
    return format(new Date(isoDate), "MMM d, HH:mm");
  } catch {
    return "—";
  }
}

/** Check if a datetime is expired */
export function isExpired(isoDate: string | null): boolean {
  if (!isoDate) return false;
  try {
    return isAfter(new Date(), new Date(isoDate));
  } catch {
    return false;
  }
}

/** Map decision effect to display label */
export function effectLabel(effect: DecisionEffect): string {
  const labels: Record<DecisionEffect, string> = {
    ALLOW: "Allowed",
    DENY: "Denied",
    REQUIRE_APPROVAL: "Approval Required",
  };
  return labels[effect];
}

/** Map approval status to display label */
export function approvalStatusLabel(status: ApprovalStatus): string {
  const labels: Record<ApprovalStatus, string> = {
    PENDING: "Pending Review",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    EXPIRED: "Expired",
    CONSUMED: "Consumed",
  };
  return labels[status];
}

/** Map audit event type to human-readable label */
export function auditEventLabel(type: AuditEventType): string {
  const labels: Record<AuditEventType, string> = {
    DECISION_EVALUATED: "Decision Evaluated",
    APPROVAL_REQUESTED: "Approval Requested",
    APPROVAL_RESOLVED: "Approval Resolved",
    POLICY_CREATED: "Policy Created",
    POLICY_UPDATED: "Policy Updated",
    AGENT_REGISTERED: "Agent Registered",
    AGENT_ACTION_EXECUTED: "Action Executed",
    AGENT_ACTION_BLOCKED: "Action Blocked",
  };
  return labels[type];
}

/** Map effect to badge variant */
export function effectToVariant(effect: DecisionEffect): "allow" | "deny" | "pending" {
  const map: Record<DecisionEffect, "allow" | "deny" | "pending"> = {
    ALLOW: "allow",
    DENY: "deny",
    REQUIRE_APPROVAL: "pending",
  };
  return map[effect];
}

/** Map approval status to badge variant */
export function statusToVariant(
  status: ApprovalStatus
): "allow" | "deny" | "pending" | "expired" | "default" {
  const map: Record<ApprovalStatus, "allow" | "deny" | "pending" | "expired" | "default"> = {
    PENDING: "pending",
    APPROVED: "allow",
    REJECTED: "deny",
    EXPIRED: "expired",
    CONSUMED: "default",
  };
  return map[status];
}

/** Truncate a UUID for display */
export function shortId(id: string): string {
  if (id.length <= 8) return id;
  return id.substring(0, 8) + "…";
}

/** Redact sensitive values - show first/last 4 chars */
export function redactValue(value: string): string {
  if (value.length <= 8) return "••••••••";
  return value.substring(0, 4) + "••••" + value.substring(value.length - 4);
}

