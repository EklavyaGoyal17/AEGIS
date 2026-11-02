'use client';

import { QueryError } from '@/components/ui/query-error';
import React, { useState, useMemo } from 'react';
import {
  ScrollText,
  Search,
  Filter,
  CheckCircle,
  XCircle,
  Clock,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  RefreshCw,
  Hash,
  Download,
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
} from '@/lib/utils/format';
import type { AuditEventType, AuditEvent } from '@/lib/api/types';

export default function AuditInvestigationPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);

  const { data: auditResponse, isLoading, refetch, isFetching, error } = useAuditEvents({
    pageSize: 100,
  });

  const events = auditResponse?.data ?? [];

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (selectedType !== 'ALL' && e.type !== selectedType) {
        return false;
      }
      if (searchTerm.trim() !== '') {
        const q = searchTerm.toLowerCase();
        const matchesEventId = e.eventId.toLowerCase().includes(q);
        const matchesAgent = e.agentId?.toLowerCase().includes(q) ?? false;
        const matchesAction = e.action?.toLowerCase().includes(q) ?? false;
        const matchesResource = e.resource?.toLowerCase().includes(q) ?? false;
        const matchesCorr = e.correlationId?.toLowerCase().includes(q) ?? false;
        const matchesDec = e.decisionId?.toLowerCase().includes(q) ?? false;
        return matchesEventId || matchesAgent || matchesAction || matchesResource || matchesCorr || matchesDec;
      }
      return true;
    });
  }, [events, selectedType, searchTerm]);

  return (
    <div className="space-y-6">
      <QueryError error={error} />
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/[.06] pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <ScrollText className="h-7 w-7 text-cyan-400" />
            Audit Investigation & Evidence Trail
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            Immutable timeline of authorization events, human reviews, and policy gateway actions.
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
            Refresh Log
          </Button>
        </div>
      </div>

      {/* Verification Notice */}
      <div className="flex items-center justify-between p-3 bg-neutral-900 border border-white/[.06] rounded-lg text-xs text-neutral-400">
        <div className="flex items-center gap-2">
          <Hash className="h-4 w-4 text-cyan-400" />
          <span>
            Evidence Status: <strong className="text-neutral-200">System Logged</strong>. Cryptographic verification tokens are recorded when provided by the canonical gateway backend.
          </span>
        </div>
        <span className="text-neutral-500 font-mono">Chain: active-gateway-v1</span>
      </div>

      {/* Search and Filters */}
      <Card className="border-white/[.08]">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <Input
                placeholder="Search by Correlation ID, Event ID, Decision ID, or Agent..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div>
              <Select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                options={[
                  { value: 'ALL', label: 'All Event Types' },
                  // v1 contract audit event types (packages/contracts AuditEventType)
                  ...[
                    'DECISION_EVALUATED',
                    'APPROVAL_REQUESTED',
                    'APPROVAL_RESOLVED',
                    'APPROVAL_CONSUMED',
                    'APPROVAL_EXPIRED',
                    'EXECUTION_AUTHORIZED',
                    'EXECUTION_REJECTED',
                    'POLICY_CREATED',
                    'POLICY_ACTIVATED',
                    'AUTHENTICATION_FAILED',
                    'AUTHORIZATION_ERROR',
                  ].map((value) => ({ value, label: value })),
                ]}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Two Column Layout: Event Timeline Table & Evidence Inspector */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Event List (2 cols) */}
        <div className="lg:col-span-2">
          <Card className="border-white/[.08]">
            <CardHeader className="py-4">
              <CardTitle className="text-base text-white">Chronological Event Timeline</CardTitle>
              <CardDescription>
                Displaying {filteredEvents.length} security events
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4">
                  <SkeletonTable rows={6} columns={4} />
                </div>
              ) : filteredEvents.length === 0 ? (
                <div className="p-8 text-center text-neutral-400">
                  No audit events found.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-neutral-300">
                    <thead className="border-y border-white/[.08] bg-white/[.02] text-xs uppercase tracking-wider text-neutral-400">
                      <tr>
                        <th className="py-3 px-4">Event Type</th>
                        <th className="py-3 px-4">Subject / Agent</th>
                        <th className="py-3 px-4">Target Resource</th>
                        <th className="py-3 px-4">Recorded</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[.06]">
                      {filteredEvents.map((evt) => {
                        const isSelected = selectedEvent?.eventId === evt.eventId;
                        return (
                          <tr
                            key={evt.eventId}
                            onClick={() => setSelectedEvent(evt)}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-cyan-950/40 border-l-2 border-cyan-400'
                                : 'hover:bg-white/[.03]'
                            }`}
                          >
                            <td className="py-3 px-4 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-xs text-white">
                                  {auditEventLabel(evt.type)}
                                </span>
                                {evt.effect && (
                                  <Badge variant={effectToVariant(evt.effect)}>
                                    {effectLabel(evt.effect)}
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4 font-mono text-xs text-cyan-300">
                              {evt.agentId || evt.actorId || 'system'}
                            </td>
                            <td className="py-3 px-4 font-mono text-xs text-neutral-400 max-w-xs truncate">
                              {evt.resource || (evt.action ? `action:${evt.action}` : '—')}
                            </td>
                            <td className="py-3 px-4 text-xs text-neutral-400 whitespace-nowrap">
                              {formatRelativeTime(evt.timestamp)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Selected Event Evidence Inspector (1 col) */}
        <div>
          <Card className="border-white/[.08] sticky top-20">
            <CardHeader className="border-b border-white/[.06] pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-white">
                Event Evidence Dossier
              </CardTitle>
              <CardDescription>
                {selectedEvent ? `ID: ${shortId(selectedEvent.eventId)}` : 'Select an event to view full trail'}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-4 text-xs">
              {selectedEvent ? (
                <>
                  <div>
                    <span className="text-neutral-500 block mb-1">Event UUID:</span>
                    <span className="font-mono text-neutral-200 bg-neutral-950 p-1.5 rounded block select-all break-all">
                      {selectedEvent.eventId}
                    </span>
                  </div>

                  <div>
                    <span className="text-neutral-500 block mb-1">Timestamp (Absolute):</span>
                    <span className="font-mono text-neutral-300">
                      {formatAbsoluteTime(selectedEvent.timestamp)}
                    </span>
                  </div>

                  {selectedEvent.correlationId && (
                    <div>
                      <span className="text-neutral-500 block mb-1">Correlation Thread ID:</span>
                      <span className="font-mono text-cyan-400 select-all block break-all">
                        {selectedEvent.correlationId}
                      </span>
                    </div>
                  )}

                  {selectedEvent.decisionId && (
                    <div>
                      <span className="text-neutral-500 block mb-1">Authorization Decision ID:</span>
                      <span className="font-mono text-neutral-300 select-all block break-all">
                        {selectedEvent.decisionId}
                      </span>
                    </div>
                  )}

                  {selectedEvent.approvalId && (
                    <div>
                      <span className="text-neutral-500 block mb-1">Associated Approval ID:</span>
                      <span className="font-mono text-amber-400 select-all block break-all">
                        {selectedEvent.approvalId}
                      </span>
                    </div>
                  )}

                  <div>
                    <span className="text-neutral-500 block mb-1 font-medium">Metadata Payload & Evidence:</span>
                    <pre className="p-3 bg-neutral-950 border border-white/[.06] rounded font-mono text-[11px] text-neutral-300 overflow-x-auto max-h-64">
                      {JSON.stringify(selectedEvent.metadata || {}, null, 2)}
                    </pre>
                  </div>
                </>
              ) : (
                <div className="py-16 text-center text-neutral-500">
                  <ScrollText className="mx-auto h-8 w-8 mb-2 opacity-50" />
                  <p>Click any event in the audit trail to inspect full raw correlation data and execution evidence.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
