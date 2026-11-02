/**
 * Synthetic Customer Support AI Agent
 * Demonstrates pre-execution authorization check against the AEGIS Policy Gateway.
 */

import { SYNTHETIC_CUSTOMERS, SYNTHETIC_TICKETS, SyntheticCustomer, SyntheticTicket } from './synthetic-data';

export interface DecisionEvaluationResult {
  decisionId: string;
  effect: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';
  reasonCodes: string[];
  policyVersion: string;
  approvalId: string | null;
  expiresAt: string | null;
}

/**
 * SIMULATION ONLY. This adapter never contacts AEGIS and never authorizes anything real; it exists to
 * show the scenario offline. The real, enforced flow is `src/live.ts` (`npm run demo`), which has no
 * simulated fallback: if AEGIS is unreachable, nothing executes.
 */
export class AegisGatewayAdapter {
  async evaluateAction(params: {
    agentId: string;
    action: string;
    resource: string;
    context?: Record<string, unknown>;
  }): Promise<DecisionEvaluationResult> {
    // Deterministic Simulation Evaluator mirroring canonical AEGIS policy
    const { action, resource } = params;

    if (action === 'read' || action.startsWith('read:')) {
      return {
        decisionId: 'sim-dec-' + Math.random().toString(36).substring(2, 9),
        effect: 'ALLOW',
        reasonCodes: ['RULE_MATCH:read-customer-data-allowed'],
        policyVersion: '1.3.0',
        approvalId: null,
        expiresAt: null,
      };
    }

    if (action === 'export' || resource.includes('pii')) {
      return {
        decisionId: 'sim-dec-' + Math.random().toString(36).substring(2, 9),
        effect: 'DENY',
        reasonCodes: ['RULE_MATCH:deny-pii-bulk-export'],
        policyVersion: '1.3.0',
        approvalId: null,
        expiresAt: null,
      };
    }

    if (action === 'modify' || action === 'delete' || action.startsWith('update:')) {
      const approvalId = 'sim-appr-' + Math.random().toString(36).substring(2, 9);
      return {
        decisionId: 'sim-dec-' + Math.random().toString(36).substring(2, 9),
        effect: 'REQUIRE_APPROVAL',
        reasonCodes: ['RULE_MATCH:require-human-signoff-for-mutation'],
        policyVersion: '1.3.0',
        approvalId,
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      };
    }

    return {
      decisionId: 'sim-dec-fallback',
      effect: 'DENY',
      reasonCodes: ['DEFAULT_DENY:no-matching-policy'],
      policyVersion: '1.3.0',
      approvalId: null,
      expiresAt: null,
    };
  }
}

export class SupportAgent {
  private agentId = 'cs-support-agent';
  private gateway: AegisGatewayAdapter;

  constructor(gateway: AegisGatewayAdapter) {
    this.gateway = gateway;
  }

  getAgentId() {
    return this.agentId;
  }

  /**
   * Action 1: Read a synthetic ticket
   */
  async readTicket(ticketId: string): Promise<{ success: boolean; data?: SyntheticTicket; error?: string }> {
    const decision = await this.gateway.evaluateAction({
      agentId: this.agentId,
      action: 'read',
      resource: `customer-data/tickets/${ticketId}`,
    });

    if (decision.effect === 'ALLOW') {
      const ticket = SYNTHETIC_TICKETS.find((t) => t.ticketId === ticketId);
      return { success: true, data: ticket };
    }
    return { success: false, error: `Action denied by AEGIS: ${decision.reasonCodes.join(', ')}` };
  }

  /**
   * Action 2: Retrieve synthetic customer profile
   */
  async getCustomerProfile(customerId: string): Promise<{ success: boolean; data?: SyntheticCustomer; error?: string }> {
    const decision = await this.gateway.evaluateAction({
      agentId: this.agentId,
      action: 'read',
      resource: `customer-data/profiles/${customerId}`,
    });

    if (decision.effect === 'ALLOW') {
      const customer = SYNTHETIC_CUSTOMERS[customerId];
      return { success: true, data: customer };
    }
    return { success: false, error: `Action denied by AEGIS: ${decision.reasonCodes.join(', ')}` };
  }

  /**
   * Action 3: Attempt restricted PII export (Will be DENIED)
   */
  async exportCustomerPII(customerId: string): Promise<{ success: boolean; error?: string }> {
    const decision = await this.gateway.evaluateAction({
      agentId: this.agentId,
      action: 'export',
      resource: `customer-data/pii/${customerId}`,
    });

    if (decision.effect === 'ALLOW') {
      return { success: true };
    }
    return {
      success: false,
      error: `[AEGIS GATEWAY INTERCEPTION] Action 'export' was BLOCKED on resource 'customer-data/pii/${customerId}'. Policy: ${decision.reasonCodes.join(', ')}`,
    };
  }

  /**
   * Action 4: Attempt customer record modification (Requires APPROVAL)
   */
  async updateContactNumber(
    customerId: string,
    newPhone: string
  ): Promise<{ status: 'COMPLETED' | 'HELD_FOR_APPROVAL' | 'REJECTED'; approvalId?: string; message: string }> {
    const decision = await this.gateway.evaluateAction({
      agentId: this.agentId,
      action: 'modify',
      resource: `customer-data/account/${customerId}`,
      context: { field: 'contactNumber', newValue: newPhone },
    });

    if (decision.effect === 'REQUIRE_APPROVAL') {
      return {
        status: 'HELD_FOR_APPROVAL',
        approvalId: decision.approvalId || 'pending-id',
        message: `[AEGIS GATEWAY NOTICE] Mutation requires human security reviewer authorization. Approval ID: ${decision.approvalId}`,
      };
    } else if (decision.effect === 'ALLOW') {
      return {
        status: 'COMPLETED',
        message: `Phone number updated successfully.`,
      };
    } else {
      return {
        status: 'REJECTED',
        message: `Modification blocked by policy rule.`,
      };
    }
  }
}
