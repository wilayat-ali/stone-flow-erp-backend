import type { StockItemView } from '../inventory/inventory.types';

// One entry is one step of the work after cutting.
export const ENTRY_TYPES = [
  'cut',
  'section',
  'counter',
  'resize',
  'polish',
] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const DIRECTIONS = ['in', 'out'] as const;
export type Direction = (typeof DIRECTIONS)[number];

// The stock movements and party rows a step leaves are tied back to it by
// these source types.
export const PRODUCTION_SOURCE = 'production';
export const PRODUCTION_REVERSAL_SOURCE = 'production_reversal';
export const CUTTING_CHARGE_SOURCE = 'cutting_charge';

// The rate-card job a worker paid per sq.ft is paid by, for each step.
export const RATE_CARD_JOB: Record<Exclude<EntryType, 'cut'>, string> = {
  section: 'Section Operator',
  counter: 'Resizer',
  resize: 'Resizer',
  polish: 'Polisher',
};

export const entryNo = (seq: number) => `PE-${String(seq).padStart(4, '0')}`;

export type EntryLineView = {
  direction: Direction;
  item: StockItemView;
  qty: number;
  /** Total inches; counters only. */
  inches: number;
};

export type ProductionEntryView = {
  id: string;
  entryNo: string;
  date: string;
  type: EntryType;
  factoryId: string;
  factoryName: string;
  material: string;
  /** The truck, for a cutting-output entry. */
  purchaseId: string | null;
  machineType: string | null;
  workerId: string | null;
  workerName: string | null;
  workerRate: number;
  workerAmount: number;
  /** Input sq.ft minus output sq.ft, for resize. */
  wasteSqft: number;
  note: string;
  status: 'posted' | 'reversed';
  lines: EntryLineView[];
  createdBy: string;
};

export type SqftWorkerView = {
  id: string;
  name: string;
  defaultJob: string;
  rate: number;
};

// What finishing a truck did, so the screen can say it and move on to counting
// the output.
export type FinishResult<P> = {
  purchase: P;
  paid: { to: string; amount: number; kind: 'thekadar' | 'cutting_factory' };
};
