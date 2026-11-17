import type { StockItemView } from '../inventory/inventory.types';

// The party ledger rows a bill leaves are tied back to it by these source
// types. An edit or a cancel posts a credit with the same source as the
// charge, which the khata reads as a reversal.
export const BILL_SOURCE = 'bill';
export const PAYMENT_SOURCE = 'customer_payment';
export const PAYMENT_RETURNED_SOURCE = 'payment_returned';
export const CHEQUE_BOUNCE_SOURCE = 'cheque_bounce';
export const CHEQUE_CLEAR_SOURCE = 'customer_cheque';
export const SALE_STOCK_SOURCE = 'sale_give';

export const PAYMENT_METHODS = ['cash', 'bank', 'cheque'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const billNo = (seq: number) => `B-${String(seq).padStart(4, '0')}`;
export const collNo = (seq: number) => `G-${String(seq).padStart(3, '0')}`;
export const orderNo = (seq: number) => `OR-${String(seq).padStart(3, '0')}`;
export const receiptNo = (seq: number) => `RC-${String(seq).padStart(4, '0')}`;

export type BillLineView = {
  lineNo: number;
  item: StockItemView;
  qty: number;
  inches: number;
  tons: number;
  rate: number;
  orderLineId: string | null;
};

export type OrderLineView = BillLineView & { id: string };

export type BillView = {
  id: string;
  billNo: string;
  date: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  factoryId: string;
  factoryName: string;
  lines: BillLineView[];
  discount: number;
  transport: number;
  total: number;
  status: 'active' | 'cancelled';
  orderId: string | null;
  note: string;
  cancelReason: string | null;
  collections: {
    id: string;
    collNo: string;
    date: string;
    vehicle: string;
    receivedBy: string;
    lines: { lineNo: number; qty: number; inches: number }[];
    createdBy: string;
  }[];
  payments: {
    id: string;
    date: string;
    amount: number;
    method: 'cash' | 'bank';
    accountName: string;
  }[];
  log: { date: string; text: string; by: string }[];
  createdBy: string;
  /** What the customer's payments have covered of this bill (oldest bill first). */
  paid: number;
};

export type OrderView = {
  id: string;
  orderNo: string;
  date: string;
  customerId: string;
  customerName: string;
  factoryId: string;
  factoryName: string;
  neededBy: string;
  cancelled: boolean;
  note: string;
  lines: OrderLineView[];
  advances: {
    id: string;
    date: string;
    amount: number;
    method: 'cash' | 'bank';
    accountName: string;
  }[];
  createdBy: string;
};

export type PaymentView = {
  id: string;
  receiptNo: string;
  date: string;
  customerId: string | null;
  customerName: string;
  amount: number;
  method: PaymentMethod;
  accountId: string;
  accountName: string;
  billId: string | null;
  billNo: string | null;
  orderId: string | null;
  orderNo: string | null;
  note: string;
  status: 'posted' | 'reversed';
  chequeId: string | null;
  createdBy: string;
};

export type ChequeView = {
  id: string;
  paymentId: string;
  customerId: string;
  customerName: string;
  bankName: string;
  chequeNo: string;
  chequeDate: string;
  receivedOn: string;
  amount: number;
  status: 'pending' | 'cleared' | 'bounced';
  depositAccountId: string | null;
  depositAccountName: string | null;
  clearedOn: string | null;
  bouncedOn: string | null;
  bounceReason: string | null;
};
