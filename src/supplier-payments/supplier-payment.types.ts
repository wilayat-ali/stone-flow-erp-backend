export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'cheque'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type PaymentStatus = 'pending' | 'confirmed' | 'reversed';
export type ChequeStatus = 'issued' | 'cleared' | 'bounced' | 'cancelled';

// The rows a payment leaves are tied back to it by these source types.
export const PAYMENT_SOURCE = 'supplier_payment';
export const CHEQUE_CLEAR_SOURCE = 'supplier_cheque_clear';
export const CHEQUE_RETURN_SOURCE = 'supplier_cheque_return';
export const CHEQUE_CHARGE_SOURCE = 'supplier_cheque_charge';
export const PAYMENT_ENTITY = 'supplier_payment';

// The permission that confirms a Munshi's payment and decides cheques. Anyone
// holding it is approved at once; everyone else waits while approval is on.
export const PAYMENT_APPROVER = 'purchasing.approve';

export type SupplierPaymentView = {
  id: string;
  voucherNo: string;
  date: string;
  supplierId: string;
  supplierName: string;
  method: PaymentMethod;
  accountId: string;
  accountName: string;
  amount: number;
  reference: string;
  chequeId: string | null;
  forPurchaseIds: string[];
  status: PaymentStatus;
  note: string;
  createdBy: string;
};

export type ChequeView = {
  id: string;
  no: string;
  accountId: string;
  accountName: string;
  supplierId: string;
  supplierName: string;
  amount: number;
  issuedOn: string;
  chequeDate: string;
  status: ChequeStatus;
  statusDate: string | null;
  reason: string | null;
  charge: number;
  paymentId: string;
  replacedByPaymentId: string | null;
};

export const voucherNo = (seq: number) => `PV-${String(seq).padStart(4, '0')}`;
