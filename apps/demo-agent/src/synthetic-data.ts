/**
 * Safe synthetic records for AEGIS Demonstration Agent
 * NEVER connects to live customer databases or production records.
 */

export interface SyntheticCustomer {
  customerId: string;
  name: string;
  email: string;
  tier: 'free' | 'pro' | 'enterprise';
  accountBalance: number;
  contactNumber: string;
}

export interface SyntheticTicket {
  ticketId: string;
  customerId: string;
  subject: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  status: 'open' | 'in_progress' | 'resolved';
}

export const SYNTHETIC_CUSTOMERS: Record<string, SyntheticCustomer> = {
  'cust-101': {
    customerId: 'cust-101',
    name: 'Jane Doe',
    email: 'jane.doe.synthetic@example.org',
    tier: 'enterprise',
    accountBalance: 420.5,
    contactNumber: '+1-555-0100',
  },
  'cust-102': {
    customerId: 'cust-102',
    name: 'Bob Smith',
    email: 'bob.smith.synthetic@example.org',
    tier: 'pro',
    accountBalance: 15.0,
    contactNumber: '+1-555-0102',
  },
};

export const SYNTHETIC_TICKETS: SyntheticTicket[] = [
  {
    ticketId: 'tkt-8821',
    customerId: 'cust-101',
    subject: 'Urgent: Update contact phone number and confirm subscription',
    description: 'Please update my telephone number to +1-555-0999 and email me the summary.',
    priority: 'high',
    status: 'open',
  },
  {
    ticketId: 'tkt-8822',
    customerId: 'cust-102',
    subject: 'Billing inquiry regarding credit expiration',
    description: 'Can I export my entire year transaction log to a raw CSV format?',
    priority: 'medium',
    status: 'open',
  },
];
