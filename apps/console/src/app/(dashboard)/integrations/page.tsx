'use client';

import React, { useState } from 'react';
import {
  Plug,
  Shield,
  Key,
  Server,
  Terminal,
  ExternalLink,
  Copy,
  Check,
  Cpu,
  Layers,
  Code,
  AlertCircle,
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
} from '@/components/ui';

export default function IntegrationsPage() {
  const [copiedKey, setCopiedKey] = useState(false);

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const sdkInstallCode = `npm install @aegis/agent-sdk`;
  const sdkExampleCode = `import { AegisGuard } from '@aegis/agent-sdk';

const guard = new AegisGuard({
  gatewayUrl: process.env.AEGIS_GATEWAY_URL,
  agentId: 'cs-support-agent',
});

// Intercept action before execution
const decision = await guard.evaluate({
  action: 'customer-data:read',
  resource: 'customer-data/account/12345',
});

if (decision.effect === 'ALLOW') {
  await executeToolCall();
} else if (decision.effect === 'REQUIRE_APPROVAL') {
  await notifyHumanReviewer(decision.approvalId);
}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/[.06] pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Plug className="h-7 w-7 text-cyan-400" />
            Integrations & Agent Gateways
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            Connect AI agent frameworks, model context protocol (MCP) servers, and runtime execution environments.
          </p>
        </div>
      </div>

      {/* Integration Options Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: Agent SDK Integration */}
        <Card className="border-white/[.08] flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center justify-between">
              <Badge variant="allow">PRODUCTION READY</Badge>
              <Terminal className="h-5 w-5 text-cyan-400" />
            </div>
            <CardTitle className="text-base text-white pt-2">Agent SDK</CardTitle>
            <CardDescription>
              Embed inline authorization checks in LangChain, LlamaIndex, or custom TypeScript/Python agent loops.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <p className="text-neutral-400">
              The lightweight client intercepts tool calls, issues signed evaluation requests, and yields until policy clearance.
            </p>
            <div className="bg-neutral-950 p-2.5 rounded border border-white/[.06] font-mono text-[11px] text-neutral-300">
              {sdkInstallCode}
            </div>
          </CardContent>
          <CardFooter className="border-t border-white/[.06] pt-3">
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2"
              onClick={() => copyCode(sdkInstallCode)}
            >
              {copiedKey ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              {copiedKey ? 'Copied' : 'Copy Install Command'}
            </Button>
          </CardFooter>
        </Card>

        {/* Card 2: Trusted Tool Gateway (Reverse Proxy) */}
        <Card className="border-white/[.08] flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center justify-between">
              <Badge variant="pending">BETA GATEWAY</Badge>
              <Server className="h-5 w-5 text-purple-400" />
            </div>
            <CardTitle className="text-base text-white pt-2">Trusted Tool Gateway</CardTitle>
            <CardDescription>
              Zero-code transparent proxy that sits between your LLM tool-calling layer and internal APIs or databases.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <p className="text-neutral-400">
              Enforces least-privilege egress, intercepts dangerous payload patterns, and buffers operations requiring human sign-off.
            </p>
            <div className="bg-neutral-950 p-2.5 rounded border border-white/[.06] font-mono text-[11px] text-neutral-300">
              Endpoint: http://localhost:3200/v1
            </div>
          </CardContent>
          <CardFooter className="border-t border-white/[.06] pt-3">
            <Button variant="outline" size="sm" className="w-full" disabled>
              Gateway Active (Local Port 3200)
            </Button>
          </CardFooter>
        </Card>

        {/* Card 3: Model Context Protocol (MCP) Bridge */}
        <Card className="border-white/[.08] flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center justify-between">
              <Badge variant="default">ARCHITECTURE PREVIEW</Badge>
              <Cpu className="h-5 w-5 text-amber-400" />
            </div>
            <CardTitle className="text-base text-white pt-2">MCP Security Connector</CardTitle>
            <CardDescription>
              Security enforcement middleware for Claude Desktop, Cursor, and Anthropic MCP servers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <p className="text-neutral-400">
              Intercepts MCP JSON-RPC tool invocations and filters resource reads against AEGIS declarative policy rules.
            </p>
            <div className="bg-neutral-950 p-2.5 rounded border border-white/[.06] font-mono text-[11px] text-neutral-400">
              Spec: Anthropic MCP 2024-11-05
            </div>
          </CardContent>
          <CardFooter className="border-t border-white/[.06] pt-3">
            <Button variant="ghost" size="sm" className="w-full text-neutral-500" disabled>
              Proposed Extension
            </Button>
          </CardFooter>
        </Card>
      </div>

      {/* Code Sample Implementation Guide */}
      <Card className="border-white/[.08]">
        <CardHeader className="border-b border-white/[.06] pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-white flex items-center gap-2">
            <Code className="h-4 w-4 text-cyan-400" />
            Reference Integration Pattern
          </CardTitle>
          <CardDescription>
            How agents query the AEGIS gateway for pre-execution evaluation and authorization tokens
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4">
          <pre className="p-4 bg-neutral-950 border border-white/[.06] rounded-md font-mono text-xs text-neutral-300 overflow-x-auto leading-relaxed">
            {sdkExampleCode}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
