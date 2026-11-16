export const FACTORY_KINDS = ['own', 'cutting'] as const;
export type FactoryKind = (typeof FACTORY_KINDS)[number];

// Vertical: 14 soot pieces. Gang saw: slabs. Both drive Production's output.
export const MACHINE_TYPES = [
  'vertical',
  'gangSaw',
  'monolama',
  'blockCutter',
] as const;
export type MachineType = (typeof MACHINE_TYPES)[number];

export const PAY_TYPES = ['perTon', 'perSqft', 'daily', 'monthly'] as const;
export type PayType = (typeof PAY_TYPES)[number];

// The plain name lists, by the path segment the frontend uses.
export const CATALOG_PATHS = {
  'soot-sizes': 'soot_size',
  'counter-widths': 'counter_width',
  'expense-categories': 'expense_category',
} as const;
export type CatalogPath = keyof typeof CATALOG_PATHS;
export type CatalogKind = (typeof CATALOG_PATHS)[CatalogPath];

export type FactoryView = {
  id: string;
  name: string;
  kind: FactoryKind;
  ratePerTon: number | null;
  isActive: boolean;
};

export type MachineView = {
  id: string;
  name: string;
  type: MachineType;
  factoryId: string;
  dayThekadar: string;
  nightThekadar: string | null;
  isActive: boolean;
};

export type CatalogItemView = {
  id: string;
  name: string;
  isActive: boolean;
};

export type WorkerRateView = {
  id: string;
  name: string;
  payType: PayType;
  rate: number;
  isActive: boolean;
};
