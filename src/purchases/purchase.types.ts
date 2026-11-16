export const PURCHASE_STATUSES = [
  'pending',
  'in_stock',
  'cutting',
  'cut',
  'rejected',
  'cancelled',
] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

// The party ledger rows a truck leaves are tied back to it by this source type.
export const PURCHASE_SOURCE = 'purchase';
export const PURCHASE_ENTITY = 'purchase';

// The permission that approves a truck. Anyone holding it is approved at once;
// everyone else's truck waits while the company's approval switch is on.
export const PURCHASE_APPROVER = 'purchasing.approve';

export type PurchaseView = {
  id: string;
  date: string;
  supplierId: string;
  supplierName: string;
  material: string;
  purchiNo: string;
  truckNo: string;
  tons: number;
  ratePerTon: number;
  discount: number;
  total: number;
  stones: number;
  factoryId: string;
  factoryName: string;
  markSeq: number | null;
  /** `seq/stones`, e.g. `20/3`: what the munshi paints on every stone. */
  mark: string | null;
  status: PurchaseStatus;
  note: string;
  reason: string | null;
  createdBy: string;
  approvedBy: string | null;
  createdAt: string;
  // Set by Production when it sends the truck to one of our machines.
  machineId: string | null;
  machineName: string | null;
  thekadarId: string | null;
  thekadarName: string | null;
  cutStart: string | null;
  cutEnd: string | null;
  cutRatePerTon: number | null;
};
