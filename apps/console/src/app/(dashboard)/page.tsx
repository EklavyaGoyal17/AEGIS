'use client';

import { QueryError } from '@/components/ui/query-error';
import React from 'react';
import Link from 'next/link';
import {
  ShieldAlert,
  ShieldCheck,
  Clock,
  Activity,
  ArrowRight,
  AlertTriangle,
  FileCheck2,
  Lock,
  ExternalLink,
  Bot,
} from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  Button,
  Skeleton,
} from '@/components/ui';
import { useApprovals, useAuditEvents, usePolicies } from '@/lib/hooks/use-api';
import {
  formatRelativeTime,
  effectToVariant,
  effectLabel,
  auditEventLabel,
  shortId,
} from '@/lib/utils/format';

export default function SecurityOverviewPage() {
  const { data: approvalsData, isLoading: approvalsLoading, error: approvalsError } = useApprovals({
    status: 'PENDING',
  });
  const { data: auditData, isLoading: auditLoading, error: auditError } = useAuditEvents({
    pageSize: 10,
  });
  const { data: policiesData, isLoading: policiesLoading, error: policiesError } = usePolicies();

  const pendingApprovals = approvalsData?.data ?? [];
  const recentEvents = auditData?.data ?? [];
  const policies = policiesData ?? [];

  // Derived real metrics from available audit events
  const totalEvaluated = recentEvents.filter(
    (e) => e.type === 'DECISION_EVALUATED' || e.effect !== undefined
  ).length;
  const allowedEvents = recentEvents.filter((e) => e.effect === 'ALLOW');
  const deniedEvents = recentEvents.filter((e) => e.effect === 'DENY');
  const requireApprovalEvents = recentEvents.filter(
    (e) => e.effect === 'REQUIRE_APPROVAL'
  );

  return (
    <div className="space-y-6">
      <QueryError error={approvalsError ?? auditError ?? policiesError} />
      {/* Top Banner / Hero Summary */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/[.06] pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <ShieldCheck className="h-7 w-7 text-cyan-400" />
            Security Operations Console
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            Real-time policy enforcement, AI agent activity telemetry, and human-in-the-loop governance.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/approvals">
            <Button variant="primary" size="sm" className="gap-2">
              <Clock className="h-4 w-4" />
              Review Approvals ({pendingApprovals.length})
            </Button>
          </Link>
          <Link href="/activity">
            <Button variant="outline" size="sm" className="gap-2">
              <Activity className="h-4 w-4" />
              Agent Explorer
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Metrics Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Metric 1: Pending Approvals */}
        <Card className="border-amber-500/20 bg-amber-950/10 hover:border-amber-500/40 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-amber-400">
              Pending Approvals
            </CardTitle>
            <Clock className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            {approvalsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold text-white">
                {pendingApprovals.length}
              </div>
            )}
            <p className="mt-1 text-xs text-neutral-400">
              Awaiting human authorization
            </p>
          </CardContent>
        </Card>

        {/* Metric 2: Denied Actions */}
        <Card className="border-red-500/20 bg-red-950/10 hover:border-red-500/40 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-red-400">
              Blocked Actions
            </CardTitle>
            <ShieldAlert className="h-4 w-4 text-red-400" />
          </CardHeader>
          <CardContent>
            {auditLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold text-white">
                {deniedEvents.length}
              </div>
            )}
            <p className="mt-1 text-xs text-neutral-400">
              Denied by active policy rules
            </p>
          </CardContent>
        </Card>

        {/* Metric 3: Allowed Executions */}
        <Card className="border-emerald-500/20 bg-emerald-950/10 hover:border-emerald-500/40 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
              Allowed Operations
            </CardTitle>
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            {auditLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold text-white">
                {allowedEvents.length}
              </div>
            )}
            <p className="mt-1 text-xs text-neutral-400">
              Clean authorization decisions
            </p>
          </CardContent>
        </Card>

        {/* Metric 4: Active Policies */}
        <Card className="border-cyan-500/20 bg-cyan-950/10 hover:border-cyan-500/40 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-cyan-400">
              Active Policies
            </CardTitle>
            <Lock className="h-4 w-4 text-cyan-400" />
          </CardHeader>
          <CardContent>
            {policiesLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold text-white">
                {policies.filter((p) => p.enabled).length}
              </div>
            )}
            <p className="mt-1 text-xs text-neutral-400">
              {policies.length} total defined policies
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Grid: Pending Action Queue & Recent Activity Timeline */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Urgent Action Queue (2 cols) */}
        <div className="space-y-6 lg:col-span-2">
          {/* Pending Approvals Widget */}
          <Card className="border-white/[.08]">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base text-white flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  Requires Human Approval
                </CardTitle>
                <CardDescription>
                  Critical agent operations held at policy gateway pending explicit sign-off
                </CardDescription>
              </div>
              <Link href="/approvals" className="text-xs font-medium text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </CardHeader>
            <CardContent>
              {approvalsLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : pendingApprovals.length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/[.08] p-6 text-center">
                  <ShieldCheck className="mx-auto h-8 w-8 text-neutral-500" />
                  <p className="mt-2 text-sm text-neutral-300 font-medium">No pending approval requests</p>
                  <p className="text-xs text-neutral-500">Autonomous operations within standard policy limits.</p>
                </div>
              ) : (
                <div className="divide-y divide-white/[.06]">
                  {pendingApprovals.slice(0, 4).map((approval) => (
                    <div
                      key={approval.approvalId}
                      className="flex flex-col sm:flex-row sm:items-center justify-between py-3.5 gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="pending">PENDING</Badge>
                          <span className="font-mono text-xs text-neutral-400">
                            {shortId(approval.approvalId)}
                          </span>
                          <span className="text-xs text-neutral-500">•</span>
                          <span className="text-xs text-neutral-400">
                            {formatRelativeTime(approval.requestedAt)}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-neutral-200">
                          <span className="text-cyan-400 font-mono">{approval.agentId}</span>{' '}
                          attempted{' '}
                          <span className="font-mono bg-white/[.05] px-1.5 py-0.5 rounded text-amber-300 text-xs">
                            {approval.action}
                          </span>{' '}
                          on{' '}
                          <span className="font-mono text-xs text-neutral-300">
                            {approval.resource}
                          </span>
                        </p>
                      </div>
                      <Link href={`/approvals`}>
                        <Button variant="outline" size="sm" className="self-start sm:self-center shrink-0">
                          Resolve Decision
                        </Button>
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* High-Risk Operation Summaries */}
          <Card className="border-white/[.08]">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base text-white flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-red-400" />
                  Blocked & Sensitive Interceptions
                </CardTitle>
                <CardDescription>
                  Actions rejected or restricted to mitigate risk and data leakage
                </CardDescription>
              </div>
              <Link href="/activity" className="text-xs font-medium text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                Explore all <ArrowRight className="h-3 w-3" />
              </Link>
            </CardHeader>
            <CardContent>
              {auditLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : deniedEvents.length === 0 ? (
                <p className="text-sm text-neutral-400">No blocked actions recorded in recent sample.</p>
              ) : (
                <div className="divide-y divide-white/[.06]">
                  {deniedEvents.map((event) => (
                    <div key={event.eventId} className="py-3 flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="deny">DENIED</Badge>
                          <span className="font-mono text-xs text-red-300 font-medium">
                            {event.action}
                          </span>
                          <span className="text-xs text-neutral-500 font-mono">
                            {event.resource}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-400">
                          Agent:{' '}
                          <span className="font-mono text-neutral-300">{event.agentId || 'Unknown'}</span>{' '}
                          • {formatRelativeTime(event.timestamp)}
                        </p>
                      </div>
                      <span className="text-xs font-mono text-neutral-500">
                        {event.correlationId ? shortId(event.correlationId) : 'no-corr'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Live Audit Timeline & Policy Health */}
        <div className="space-y-6">
          {/* Recent Audit Activity */}
          <Card className="border-white/[.08]">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base text-white flex items-center gap-2">
                <Activity className="h-4 w-4 text-cyan-400" />
                Audit Stream
              </CardTitle>
              <Link href="/audit" className="text-xs font-medium text-cyan-400 hover:text-cyan-300">
                Full Log
              </Link>
            </CardHeader>
            <CardContent>
              {auditLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : recentEvents.length === 0 ? (
                <p className="text-sm text-neutral-400">No recent events logged.</p>
              ) : (
                <ol className="relative border-l border-white/[.08] ml-2 space-y-4 my-2">
                  {recentEvents.slice(0, 6).map((item) => (
                    <li key={item.eventId} className="ml-4">
                      <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-neutral-900 bg-cyan-500" />
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-neutral-200">
                          {auditEventLabel(item.type)}
                        </span>
                        {item.effect && (
                          <Badge variant={effectToVariant(item.effect)}>
                            {effectLabel(item.effect)}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-neutral-400 mt-0.5 truncate">
                        {item.agentId ? `${item.agentId} → ` : ''}
                        {item.action || item.resource || 'System event'}
                      </p>
                      <time className="text-[10px] text-neutral-500">
                        {formatRelativeTime(item.timestamp)}
                      </time>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* Connected Agent Systems */}
          <Card className="border-white/[.08]">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-white flex items-center gap-2">
                <Bot className="h-4 w-4 text-purple-400" />
                Monitored Agents
              </CardTitle>
              <CardDescription>Active AI workloads communicating through gateway</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span className="font-mono text-neutral-300">cs-support-agent</span>
                  </div>
                  <Badge variant="info">Customer Support</Badge>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span className="font-mono text-neutral-300">analytics-agent</span>
                  </div>
                  <Badge variant="info">Batch Processing</Badge>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    <span className="font-mono text-neutral-300">data-export-agent</span>
                  </div>
                  <Badge variant="pending">Restricted Scope</Badge>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span className="font-mono text-neutral-300">admin-agent</span>
                  </div>
                  <Badge variant="default">Privileged</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
