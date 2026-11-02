'use client';

import React, { useState } from 'react';
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  User,
  Bot,
  ExternalLink,
  RefreshCw,
  Info,
} from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Badge,
  Button,
  Dialog,
  DialogTitle,
  DialogDescription,
  DialogActions,
  Skeleton,
} from '@/components/ui';
import { useApprovals, useResolveApproval } from '@/lib/hooks/use-api';
import {
  formatAbsoluteTime,
  formatRelativeTime,
  isExpired,
  statusToVariant,
  approvalStatusLabel,
  shortId,
} from '@/lib/utils/format';
import type { Approval, ApprovalStatus } from '@/lib/api/types';

export default function ApprovalsPage() {
  const [selectedStatus, setSelectedStatus] = useState<ApprovalStatus | 'ALL'>('PENDING');
  const [activeApproval, setActiveApproval] = useState<Approval | null>(null);
  const [dialogAction, setDialogAction] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [resolveReason, setResolveReason] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data: approvalsResponse, isLoading, refetch, isFetching } = useApprovals(
    selectedStatus === 'ALL' ? undefined : { status: selectedStatus }
  );

  const resolveMutation = useResolveApproval();

  const approvals = approvalsResponse?.data ?? [];

  const handleOpenDialog = (approval: Approval, action: 'APPROVE' | 'REJECT') => {
    setActiveApproval(approval);
    setDialogAction(action);
    setResolveReason('');
    setErrorMessage(null);
  };

  const handleCloseDialog = () => {
    setActiveApproval(null);
    setDialogAction(null);
    setResolveReason('');
    setErrorMessage(null);
  };

  const handleConfirmResolution = async () => {
    if (!activeApproval || !dialogAction) return;

    try {
      setErrorMessage(null);
      await resolveMutation.mutateAsync({
        approvalId: activeApproval.approvalId,
        request: {
          action: dialogAction,
          reason: resolveReason || (dialogAction === 'APPROVE' ? 'Approved by security reviewer' : 'Rejected per policy guidelines'),
          reviewerId: 'operator@aegis.internal',
        },
      });
      handleCloseDialog();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Failed to resolve approval request. Backend conflict or network issue.');
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/[.06] pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <CheckCircle className="h-7 w-7 text-amber-400" />
            Human Approval Center
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            Authoritative gatekeeper for high-risk operations requiring explicit human oversight.
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

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-white/[.08] pb-2">
        {(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'ALL'] as const).map((tab) => {
          const isActive = selectedStatus === tab;
          return (
            <button
              key={tab}
              onClick={() => setSelectedStatus(tab)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-white/[.1] text-white shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/[.04]'
              }`}
            >
              {tab === 'PENDING'
                ? 'Pending Review'
                : tab === 'ALL'
                ? 'All Statuses'
                : approvalStatusLabel(tab)}
            </button>
          );
        })}
      </div>

      {/* Approvals Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : approvals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/[.08] p-12 text-center">
          <CheckCircle className="mx-auto h-12 w-12 text-neutral-500 mb-3" />
          <h3 className="text-base font-medium text-neutral-200">No requests in this queue</h3>
          <p className="text-sm text-neutral-400 mt-1">
            All agent actions within selected filter are settled or compliant with autonomous policies.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {approvals.map((item) => {
            const hasExpired = isExpired(item.expiresAt) && item.status === 'PENDING';
            const displayStatus: ApprovalStatus = hasExpired ? 'EXPIRED' : item.status;
            const canResolve = item.status === 'PENDING' && !hasExpired;

            return (
              <Card
                key={item.approvalId}
                className={`border-white/[.08] flex flex-col justify-between ${
                  canResolve ? 'border-amber-500/30' : ''
                }`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={statusToVariant(displayStatus)}>
                          {approvalStatusLabel(displayStatus)}
                        </Badge>
                        <span className="font-mono text-xs text-neutral-400">
                          {shortId(item.approvalId)}
                        </span>
                      </div>
                      <CardTitle className="text-base text-white pt-1">
                        Operation:{' '}
                        <span className="font-mono text-amber-300 bg-amber-950/40 px-2 py-0.5 rounded">
                          {item.action}
                        </span>
                      </CardTitle>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-xs text-neutral-400">
                        <Clock className="h-3 w-3" />
                        <span>Expires {formatRelativeTime(item.expiresAt)}</span>
                      </div>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 text-xs">
                  {/* Target Resource & Agent */}
                  <div className="p-3 bg-neutral-950 border border-white/[.04] rounded-md space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-500">Requesting Agent:</span>
                      <span className="font-mono font-semibold text-cyan-400 flex items-center gap-1">
                        <Bot className="h-3.5 w-3.5" />
                        {item.agentId}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-500">Resource Target:</span>
                      <span className="font-mono text-neutral-300 max-w-[240px] truncate">
                        {item.resource}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-500">Policy Version:</span>
                      <span className="font-mono text-neutral-400">
                        {item.policyVersion}
                      </span>
                    </div>
                  </div>

                  {/* Context and Argument Digest */}
                  {item.context && (
                    <div className="space-y-1">
                      <span className="text-neutral-400 font-medium block">
                        Proposed Arguments & Delta:
                      </span>
                      <pre className="p-2.5 bg-neutral-950 border border-white/[.04] rounded font-mono text-[11px] text-neutral-300 overflow-x-auto">
                        {JSON.stringify(item.context, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Policy Reasoning Codes */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-neutral-500">Triggered Rules:</span>
                    {item.reasonCodes.map((code) => (
                      <span
                        key={code}
                        className="px-2 py-0.5 rounded bg-white/[.04] text-neutral-400 font-mono text-[10px]"
                      >
                        {code}
                      </span>
                    ))}
                  </div>

                  {/* Resolution Footnote */}
                  {item.resolvedBy && (
                    <div className="border-t border-white/[.06] pt-2 text-[11px] text-neutral-400 flex items-center justify-between">
                      <span>Reviewed by: {item.resolvedBy}</span>
                      <span>{item.resolvedAt ? formatRelativeTime(item.resolvedAt) : ''}</span>
                    </div>
                  )}
                </CardContent>

                <CardFooter className="pt-2 border-t border-white/[.06] flex items-center justify-end gap-3">
                  {canResolve ? (
                    <>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleOpenDialog(item, 'REJECT')}
                        className="gap-1.5"
                      >
                        <XCircle className="h-4 w-4" />
                        Reject Operation
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleOpenDialog(item, 'APPROVE')}
                        className="gap-1.5"
                      >
                        <CheckCircle className="h-4 w-4" />
                        Authorize & Release
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-neutral-500 italic">
                      {item.status === 'APPROVED' && 'Authorized — Action executed'}
                      {item.status === 'REJECTED' && 'Rejected by security reviewer'}
                      {hasExpired && 'Expired — Window closed'}
                    </span>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {/* Confirmation & Concurrency Resolution Dialog */}
      {dialogAction && activeApproval && (
        <Dialog open={true} onClose={handleCloseDialog}>
          <DialogTitle>
            {dialogAction === 'APPROVE' ? 'Authorize Agent Operation?' : 'Reject Agent Operation?'}
          </DialogTitle>
          <DialogDescription>
            {dialogAction === 'APPROVE'
              ? 'This will immediately release the held action through the AEGIS Policy Gateway to execute against downstream targets.'
              : 'This will deny execution and return an authoritative rejection error to the agent execution runtime.'}
          </DialogDescription>

          <div className="my-4 space-y-3">
            <div className="p-3 bg-neutral-950 border border-white/[.08] rounded text-xs space-y-1">
              <div>
                <span className="text-neutral-500">Agent: </span>
                <span className="font-mono text-cyan-400 font-semibold">{activeApproval.agentId}</span>
              </div>
              <div>
                <span className="text-neutral-500">Action: </span>
                <span className="font-mono text-amber-300 font-semibold">{activeApproval.action}</span>
              </div>
              <div>
                <span className="text-neutral-500">Target: </span>
                <span className="font-mono text-neutral-300">{activeApproval.resource}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1">
                Audit Justification / Reviewer Notes:
              </label>
              <textarea
                value={resolveReason}
                onChange={(e) => setResolveReason(e.target.value)}
                placeholder="Enter mandatory audit trail reason..."
                rows={3}
                className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-white placeholder-neutral-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            {errorMessage && (
              <div className="p-2.5 bg-red-950/60 border border-red-500/30 rounded text-xs text-red-300 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}
          </div>

          <DialogActions>
            <Button variant="ghost" size="sm" onClick={handleCloseDialog} disabled={resolveMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant={dialogAction === 'APPROVE' ? 'primary' : 'danger'}
              size="sm"
              loading={resolveMutation.isPending}
              onClick={handleConfirmResolution}
            >
              {dialogAction === 'APPROVE' ? 'Confirm Authorization' : 'Confirm Rejection'}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </div>
  );
}
