# AEGIS — API Proposals & Roadmap for Future Extensions

This document outlines proposed backend endpoints identified during the implementation of the enterprise security console.

> [!IMPORTANT]
> In accordance with AEGIS engineering principles, these endpoints are **not** assumed to exist in production. The current console UI implements clear separation: in production mode, metrics are derived strictly from canonical `/v1/audit/events` and `/v1/approvals`, while demo mode leverages deterministic fixture simulations.

---

## Proposal 1: Agent Inventory Registry (`GET /v1/agents`)

### Motivation

Enterprise security operators need visibility into all registered AI agents, their runtime environments, trust tiers, and current activity status. Currently, agents are observed reactively through audit events.

### Proposed Specification

- **Method**: `GET`
- **Path**: `/v1/agents`
- **Query Parameters**:
  - `status`: `active | suspended | decommissioned`
  - `tier`: `untrusted | standard | privileged`
  - `page`: `number` (default: 1)
  - `pageSize`: `number` (default: 20)
- **Response Schema (`200 OK`)**:
  ```json
  {
    "data": [
      {
        "agentId": "cs-support-agent",
        "name": "Customer Support Agent",
        "framework": "LangChain v0.2",
        "runtime": "node20-isolated",
        "status": "active",
        "tier": "standard",
        "registeredAt": "2026-10-15T08:00:00Z",
        "lastActiveAt": "2026-11-02T12:00:00Z",
        "activePolicies": ["p1010101-0001-4ddd-8888-000000000001"]
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20,
    "hasMore": false
  }
  ```

---

## Proposal 2: Aggregated Security Metrics (`GET /v1/metrics/overview`)

### Motivation

Rather than client-side aggregation over recent audit event pages, an authoritative backend aggregation endpoint avoids excessive payload transfer and gives historical 24h / 7d trends across millions of agent decisions.

### Proposed Specification

- **Method**: `GET`
- **Path**: `/v1/metrics/overview`
- **Query Parameters**:
  - `timeframe`: `1h | 24h | 7d | 30d`
- **Response Schema (`200 OK`)**:
  ```json
  {
    "timeframe": "24h",
    "totalDecisions": 142050,
    "allowedCount": 139200,
    "deniedCount": 2450,
    "pendingApprovals": 12,
    "decisionsByHour": [
      {
        "hour": "2026-11-02T11:00:00Z",
        "allowed": 1240,
        "denied": 15,
        "pending": 2
      }
    ],
    "topDeniedActions": [
      { "action": "customer-data:export", "count": 1820 },
      { "action": "customer-data:delete", "count": 410 }
    ]
  }
  ```

---

## Proposal 3: Cryptographic Audit Verification (`GET /v1/audit/events/{id}/verify`)

### Motivation

For compliance and legal investigations, operators need to verify that an audit record has not been tampered with in storage, accompanied by HMAC / Merkle tree inclusion proofs.

### Proposed Specification

- **Method**: `GET`
- **Path**: `/v1/audit/events/{eventId}/verify`
- **Response Schema (`200 OK`)**:
  ```json
  {
    "eventId": "e1e2e3e4-0001-4fff-aaaa-000000000001",
    "verified": true,
    "signature": "30450221008f...ecdsa_p256",
    "ledgerRootHash": "sha256:7b92f441...",
    "inclusionProof": ["hash1", "hash2"],
    "signerIdentity": "aegis-gateway-hsm-primary"
  }
  ```
