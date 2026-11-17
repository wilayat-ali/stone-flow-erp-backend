export const CUSTOMER_TYPES = ['builder', 'dealer', 'cutting'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

// Every customer keeps their khata under this party type.
export const CUSTOMER_PARTY = 'customer' as const;

// Party ledger source types that are not ordinary business: a charge with one
// of these puts money back (a bounced cheque, a reversed payment), so it comes
// off what was received instead of adding to what was sold.
export const RETURNED_SOURCES: readonly string[] = [
  'payment_returned',
  'cheque_bounce',
];

export const CUTTING_JOB_SOURCE = 'cutting_job';

export const JOB_STATUSES = [
  'received',
  'cutting',
  'ready',
  'delivered',
  'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const jobNo = (seq: number) => `CJ-${String(seq).padStart(3, '0')}`;

export type CustomerView = {
  id: string;
  name: string;
  phone: string;
  type: CustomerType;
  city: string;
  contactPerson: string;
  openingBalance: number;
  openingDate: string;
  isActive: boolean;
};

export type CustomerSummary = CustomerView & {
  /** Bills and cutting charges. */
  totalBusiness: number;
  received: number;
  /** Positive: the customer owes. Negative: an advance. */
  balance: number;
  /** Age in days of the oldest charge not yet covered by payments. */
  oldestUnpaidDays: number | null;
  /** Cheques received but not yet cleared. */
  unclearedCheques: number;
  lastActivity: string;
};

export type CustomerKhataRow = {
  id: string;
  customerId: string;
  date: string;
  kind: 'charge' | 'credit';
  amount: number;
  detail: string;
  sourceId: string;
  ref?: string;
  /** A credit that takes a charge back; not money received. */
  reversal?: boolean;
  /** A charge that puts money back (a bounced cheque); not business done. */
  returned?: boolean;
  balance: number;
};

export type CuttingJobView = {
  id: string;
  jobNo: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  date: string;
  truckNo: string;
  material: string;
  tons: number;
  factoryId: string;
  factoryName: string;
  ratePerSqft: number;
  status: JobStatus;
  machineId: string | null;
  machineName: string | null;
  thekadarId: string | null;
  thekadarName: string | null;
  cutStart: string | null;
  sqft: number | null;
  outputNote: string;
  readyOn: string | null;
  deliveredOn: string | null;
  createdBy: string;
};
