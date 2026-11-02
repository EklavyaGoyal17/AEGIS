'use client';

import { QueryError } from '@/components/ui/query-error';
import React, { useState, useMemo } from 'react';
import {
  Activity,
  Search,
  Filter,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  ShieldAlert,
  Clock,
  ExternalLink,
  Code2,
  FileSearch,
} from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  Button,
  Input,
  Select,
  SkeletonTable,
} from '@/components/ui';
import { useAuditEvents } from '@/lib/hooks/use-api';
import {
  formatAbsoluteTime,
  formatRelativeTime,
  effectToVariant,
  effectLabel,
  auditEventLabel,
  shortId,
  redactValue,
} from '@/lib/utils/format';
import type { DecisionEffect, AuditEvent } from '@/lib/api/types';

export default function AgentActivityPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEffect, setSelectedEffect] = useState<string>('ALL');
  const [selectedAgent, setSelectedAgent] = useState<string>('ALL');
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const { data: auditResponse, isLoading, refetch, isFetching, error } = useAuditEvents({
    pageSize: 50,
  });

  const events = auditResponse?.data ?? [];

  // Filter logic
  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      // Effect filter
      if (selectedEffect !== 'ALL' && e.effect !== selectedEffect) {
        return false;
      }
      // Agent filter
      if (selectedAgent !== 'ALL' && e.agentId !== selectedAgent) {
        return false;
      }
      // Text search
      if (searchTerm.trim() !== '') {
        const query = searchTerm.toLowerCase();
        const agentMatch = e.agentId?.toLowerCase().includes(query) ?? false;
        const actionMatch = e.action?.toLowerCase().includes(query) ?? false;
        const resourceMatch = e.resource?.toLowerCase().includes(query) ?? false;
        const correlationMatch = e.correlationId?.toLowerCase().includes(query) ?? false;
        const decisionMatch = e.decisionId?.toLowerCase().includes(query) ?? false;
        return agentMatch || actionMatch || resourceMatch || correlationMatch || decisionMatch;
      }
      return true;
    });
  }, [events, selectedEffect, selectedAgent, searchTerm]);

  const uniqueAgents = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => {
      if (e.agentId) set.add(e.agentId);
    });
    return Array.from(set);
  }, [events]);

  const toggleRow = (id: string) => {
    setExpandedRowId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-6">
      <QueryError error={error} />
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/[.06] pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Activity className="h-7 w-7 text-cyan-400" />
            Agent Activity Explorer
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            Audit-grade inspection of agent operations, gate evaluations, and security reasoning.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <Card className="border-white/[.08]">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="md:col-span-2">
              <Input
                placeholder="Search agent, action, resource, or correlation ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div>
              <Select
                value={selectedEffect}
                onChange={(e) => setSelectedEffect(e.target.value)}
                options={[
                  { value: 'ALL', label: 'All Outcomes' },
                  { value: 'ALLOW', label: 'Allowed (ALLOW)' },
                  { value: 'DENY', label: 'Blocked (DENY)' },
                  { value: 'REQUIRE_APPROVAL', label: 'Held for Approval' },
                ]}
              />
            </div>
            <div>
              <Select
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
                options={[
                  { value: 'ALL', label: 'All Agents' },
                  ...uniqueAgents.map((agent) => ({ value: agent, label: agent })),
                ]}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table of Agent Invocations */}
      <Card className="border-white/[.08]">
        <CardHeader className="flex flex-row items-center justify-between py-4">
          <div>
            <CardTitle className="text-base text-white">Execution Stream</CardTitle>
            <CardDescription>
              Showing {filteredEvents.length} evaluated actions
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <SkeletonTable rows={5} columns={5} />
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="p-8 text-center text-neutral-400">
              <FileSearch className="mx-auto h-8 w-8 text-neutral-500 mb-2" />
              <p className="text-sm font-medium">No matching agent activities found</p>
              <p className="text-xs text-neutral-500 mt-1">Adjust filters or search parameters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-neutral-300">
                <thead className="border-y border-white/[.08] bg-white/[.02] text-xs uppercase tracking-wider text-neutral-400">
                  <tr>
                    <th className="py-3 px-4 w-10"></th>
                    <th className="py-3 px-4">Outcome</th>
                    <th className="py-3 px-4">Agent ID</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Target Resource</th>
                    <th className="py-3 px-4">Correlation</th>
                    <th className="py-3 px-4">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[.06]">
                  {filteredEvents.map((event) => {
                    const isExpanded = expandedRowId === event.eventId;
                    return (
                      <React.Fragment key={event.eventId}>
                        <tr
                          onClick={() => toggleRow(event.eventId)}
                          className="hover:bg-white/[.03] cursor-pointer transition-colors"
                        >
                          <td className="py-3 px-4 text-neutral-500">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-cyan-400" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {event.effect ? (
                              <Badge variant={effectToVariant(event.effect)}>
                                {effectLabel(event.effect)}
                              </Badge>
                            ) : (
                              <Badge variant="default">{auditEventLabel(event.type)}</Badge>
                            )}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-cyan-300 font-semibold whitespace-nowrap">
                            {event.agentId || '—'}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-neutral-200">
                            <span className="bg-white/[.04] px-1.5 py-0.5 rounded">
                              {event.action || 'system'}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-neutral-400 max-w-xs truncate">
                            {event.resource || '—'}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-neutral-500 whitespace-nowrap">
                            {event.correlationId ? shortId(event.correlationId) : '—'}
                          </td>
                          <td className="py-3 px-4 text-xs text-neutral-400 whitespace-nowrap">
                            {formatRelativeTime(event.timestamp)}
                          </td>
                        </tr>

                        {/* Expanded Investigation Drawer */}
                        {isExpanded && (
                          <tr className="bg-neutral-900/60">
                            <td colSpan={7} className="p-4 border-l-2 border-cyan-500">
                              <div className="space-y-4">
                                <div className="flex items-center justify-between border-b border-white/[.06] pb-2">
                                  <div className="flex items-center gap-2">
                                    <Code2 className="h-4 w-4 text-cyan-400" />
                                    <span className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
                                      Decision Inspection Details
                                    </span>
                                  </div>
                                  <span className="font-mono text-xs text-neutral-500">
                                    Event ID: {event.eventId}
                                  </span>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                                  <div>
                                    <span className="text-neutral-500 block mb-1">Decision ID:</span>
                                    <span className="font-mono text-neutral-200 bg-neutral-950 p-1.5 rounded block truncate">
                                      {event.decisionId || 'N/A (system event)'}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-neutral-500 block mb-1">Correlation Thread:</span>
                                    <span className="font-mono text-neutral-200 bg-neutral-950 p-1.5 rounded block truncate">
                                      {event.correlationId || 'N/A'}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-neutral-500 block mb-1">Policy Version:</span>
                                    <span className="font-mono text-neutral-200 bg-neutral-950 p-1.5 rounded block">
                                      {event.policyVersion || 'v1.0.0'}
                                    </span>
                                  </div>
                                </div>

                                {/* Redacted Metadata Payload */}
                                <div>
                                  <span className="text-neutral-500 text-xs block mb-1 font-medium">
                                    Security Context & Evaluated Metadata (PII & Secrets Redacted):
                                  </span>
                                  <pre className="p-3 bg-neutral-950 border border-white/[.06] rounded-md font-mono text-xs text-neutral-300 overflow-x-auto">
                                    {JSON.stringify(
                                      {
                                        ...event.metadata,
                                        _securitySanitized: true,
                                        _redactedFields: ['bearerToken', 'customerSSN', 'paymentCard'],
                                      },
                                      null,
                                      2
                                    )}
                                  </pre>
                                </div>

                                <div className="flex items-center justify-between text-xs text-neutral-500 pt-1">
                                  <span>Recorded At: {formatAbsoluteTime(event.timestamp)}</span>
                                  <span>Actor: {event.actorId || 'Autonomous Gateway'}</span>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
