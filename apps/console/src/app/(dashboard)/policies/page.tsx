'use client';

import React, { useState } from 'react';
import {
  FileText,
  Plus,
  Shield,
  AlertTriangle,
  CheckCircle,
  Lock,
  Layers,
  Info,
  Save,
  Trash2,
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
  Input,
  Select,
  Dialog,
  DialogTitle,
  DialogDescription,
  DialogActions,
  Skeleton,
} from '@/components/ui';
import { usePolicies, useCreatePolicy } from '@/lib/hooks/use-api';
import { formatRelativeTime } from '@/lib/utils/format';
import type { Policy, PolicyRule, DecisionEffect } from '@/lib/api/types';

export default function PoliciesPage() {
  const [isCreating, setIsCreating] = useState(false);
  const [selectedPolicy, setSelectedPolicy] = useState<Policy | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState('customer-data');
  const [ruleAction, setRuleAction] = useState('read');
  const [ruleResource, setRuleResource] = useState('customer-data/*');
  const [ruleEffect, setRuleEffect] = useState<DecisionEffect>('ALLOW');
  const [formError, setFormError] = useState<string | null>(null);

  const { data: policiesData, isLoading, refetch } = usePolicies();
  const createMutation = useCreatePolicy();

  const policies = policiesData ?? [];

  const handleOpenCreate = () => {
    setName('');
    setDescription('');
    setScope('customer-data');
    setRuleAction('read');
    setRuleResource('customer-data/*');
    setRuleEffect('ALLOW');
    setFormError(null);
    setIsCreating(true);
  };

  const handleCloseCreate = () => {
    setIsCreating(false);
    setFormError(null);
  };

  const handleSubmitPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('Policy name is required.');
      return;
    }
    if (!description.trim()) {
      setFormError('Policy description is required.');
      return;
    }

    try {
      setFormError(null);
      await createMutation.mutateAsync({
        name,
        description,
        scope,
        enabled: true,
        rules: [
          {
            action: ruleAction,
            resource: ruleResource,
            effect: ruleEffect,
            priority: 100,
          },
        ],
      });
      setIsCreating(false);
      refetch();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError('Failed to commit policy. Server validation rejected parameters.');
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/[.06] pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <FileText className="h-7 w-7 text-cyan-400" />
            Authorization Policy Management
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            Define declarative authorization boundaries, conditions, and human-in-the-loop triggers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={handleOpenCreate} className="gap-1.5">
            <Plus className="h-4 w-4" />
            New Policy Rule
          </Button>
        </div>
      </div>

      {/* Safety Notice Warning */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-950/20 p-4 text-xs text-amber-300">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
        <div>
          <p className="font-semibold text-amber-200">Policy Enforcement Safety Guardrail</p>
          <p className="mt-0.5 text-neutral-400">
            Policy evaluations are deterministic and fail-closed. Modifying resource patterns or DENY directives directly alters autonomous agent decision paths across all connected workloads.
          </p>
        </div>
      </div>

      {/* Policy Catalog */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Policy Cards List (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400">
            Deployed Security Policies ({policies.length})
          </h2>

          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-36 w-full" />
              <Skeleton className="h-36 w-full" />
            </div>
          ) : policies.length === 0 ? (
            <div className="p-8 border border-dashed border-white/[.08] rounded-lg text-center text-neutral-400">
              No policies configured.
            </div>
          ) : (
            <div className="space-y-4">
              {policies.map((policy) => {
                const isSelected = selectedPolicy?.policyId === policy.policyId;
                return (
                  <Card
                    key={policy.policyId}
                    onClick={() => setSelectedPolicy(policy)}
                    className={`border-white/[.08] cursor-pointer transition-all hover:border-cyan-500/50 ${
                      isSelected ? 'border-cyan-500 bg-neutral-900/80 ring-1 ring-cyan-500/50' : ''
                    }`}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white text-base">
                              {policy.name}
                            </span>
                            <Badge variant={policy.enabled ? 'allow' : 'default'}>
                              {policy.enabled ? 'ACTIVE' : 'DISABLED'}
                            </Badge>
                          </div>
                          <CardDescription className="mt-1">
                            {policy.description}
                          </CardDescription>
                        </div>
                        <span className="font-mono text-xs text-neutral-400 bg-white/[.04] px-2 py-0.5 rounded">
                          v{policy.version}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs">
                      <div className="flex items-center gap-4 text-neutral-400">
                        <span>Scope: <code className="text-cyan-300">{policy.scope || 'global'}</code></span>
                        <span>Rules: <strong className="text-white">{policy.rules.length}</strong></span>
                        <span>Created by: <code className="text-neutral-300">{policy.createdBy}</code></span>
                        <span>Updated: {formatRelativeTime(policy.updatedAt)}</span>
                      </div>

                      {/* Rule Digest Pills */}
                      <div className="pt-2 flex flex-wrap gap-2">
                        {policy.rules.map((rule, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-neutral-950 border border-white/[.06] text-[11px] font-mono"
                          >
                            <span className="text-neutral-400">{rule.action}</span>
                            <span className="text-neutral-500">→</span>
                            <span className="text-neutral-300 truncate max-w-[150px]">{rule.resource}</span>
                            <span className="text-neutral-500">|</span>
                            <span
                              className={
                                rule.effect === 'ALLOW'
                                  ? 'text-emerald-400 font-bold'
                                  : rule.effect === 'DENY'
                                  ? 'text-red-400 font-bold'
                                  : 'text-amber-400 font-bold'
                              }
                            >
                              {rule.effect}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected Policy Detail / Preview (1 col) */}
        <div>
          <Card className="border-white/[.08] sticky top-20">
            <CardHeader className="border-b border-white/[.06] pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-white flex items-center gap-2">
                <Layers className="h-4 w-4 text-cyan-400" />
                Policy Inspector & AST
              </CardTitle>
              <CardDescription>
                {selectedPolicy ? selectedPolicy.name : 'Select a policy from the list'}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-4 text-xs">
              {selectedPolicy ? (
                <>
                  <div>
                    <span className="text-neutral-500 block mb-1">Policy Identifier:</span>
                    <span className="font-mono text-neutral-300 select-all block break-all">
                      {selectedPolicy.policyId}
                    </span>
                  </div>

                  <div>
                    <span className="text-neutral-500 block mb-1">Human-Readable Evaluation Logic:</span>
                    <ul className="list-disc pl-4 space-y-1 text-neutral-300">
                      {selectedPolicy.rules.map((r, i) => (
                        <li key={i}>
                          When agent performs <code className="text-cyan-300">{r.action}</code> on{' '}
                          <code className="text-cyan-300">{r.resource}</code>, the policy engine enforces{' '}
                          <strong
                            className={
                              r.effect === 'ALLOW'
                                ? 'text-emerald-400'
                                : r.effect === 'DENY'
                                ? 'text-red-400'
                                : 'text-amber-400'
                            }
                          >
                            {r.effect}
                          </strong>.
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <span className="text-neutral-500 block mb-1 font-medium">Underlying Policy JSON:</span>
                    <pre className="p-3 bg-neutral-950 border border-white/[.06] rounded font-mono text-[11px] text-neutral-300 overflow-x-auto max-h-64">
                      {JSON.stringify(selectedPolicy, null, 2)}
                    </pre>
                  </div>
                </>
              ) : (
                <div className="py-12 text-center text-neutral-500">
                  <FileText className="mx-auto h-8 w-8 mb-2 opacity-50" />
                  <p>Click any policy on the left to inspect its complete AST rules and boundary constraints.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Structured Policy Creator Dialog */}
      {isCreating && (
        <Dialog open={true} onClose={handleCloseCreate}>
          <DialogTitle>Create Structured Authorization Policy</DialogTitle>
          <DialogDescription>
            Define an authoritative enforcement rule for AI agent execution paths.
          </DialogDescription>

          <form onSubmit={handleSubmitPolicy} className="space-y-4 my-4">
            <Input
              label="Policy Name"
              placeholder="e.g., Allow Customer Data Reads"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />

            <Input
              label="Description & Security Intent"
              placeholder="Explicit rationale for this policy rule..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Target Resource Pattern"
                placeholder="e.g., customer-data/*"
                value={ruleResource}
                onChange={(e) => setRuleResource(e.target.value)}
                required
              />

              <Input
                label="Action"
                placeholder="e.g., read, export, modify"
                value={ruleAction}
                onChange={(e) => setRuleAction(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1">
                Enforcement Effect
              </label>
              <Select
                value={ruleEffect}
                onChange={(e) => setRuleEffect(e.target.value as DecisionEffect)}
                options={[
                  { value: 'ALLOW', label: 'ALLOW — Permit without human friction' },
                  { value: 'DENY', label: 'DENY — Block immediately at gateway' },
                  { value: 'REQUIRE_APPROVAL', label: 'REQUIRE_APPROVAL — Hold for human review' },
                ]}
              />
            </div>

            {formError && (
              <div className="p-2.5 bg-red-950/60 border border-red-500/30 rounded text-xs text-red-300 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <DialogActions>
              <Button variant="ghost" size="sm" type="button" onClick={handleCloseCreate}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" type="submit" loading={createMutation.isPending}>
                Create & Deploy Policy
              </Button>
            </DialogActions>
          </form>
        </Dialog>
      )}
    </div>
  );
}
