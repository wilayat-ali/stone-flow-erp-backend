import { EntityManager } from 'typeorm';
import { CatalogItemEntity } from './infrastructure/persistence/relational/entities/catalog-item.entity';
import { WorkerRateEntity } from './infrastructure/persistence/relational/entities/worker-rate.entity';

// The lists every new company starts with. They can be edited or hidden like
// any other row. Factories and machines belong to one company, so none here.
export const DEFAULT_CATALOG: Record<string, string[]> = {
  soot_size: ['14 soot', '6 soot', '4 soot'],
  counter_width: ['2 inch', '1.5 inch', '1.25 inch'],
  expense_category: [
    'Machine & spare parts',
    'Maintenance',
    'Electrical maintenance',
    'Electricity bill',
    'Water tanker',
    'Drain powder & cleaning',
    'Lunch & tea',
    'Guests',
    'Diesel & transport',
    'Other',
  ],
};

export const DEFAULT_WORKER_RATES: {
  name: string;
  payType: 'perTon' | 'perSqft' | 'daily' | 'monthly';
  rate: number;
}[] = [
  { name: 'Thekadar — Vertical Cutting', payType: 'perTon', rate: 450 },
  { name: 'Thekadar — Gang Saw', payType: 'perTon', rate: 500 },
  { name: 'Section Operator', payType: 'perSqft', rate: 6 },
  { name: 'Resizer', payType: 'perSqft', rate: 8 },
  { name: 'Polisher', payType: 'perSqft', rate: 10 },
  { name: 'Labour', payType: 'daily', rate: 800 },
  { name: 'Driver', payType: 'daily', rate: 900 },
  { name: 'Munshi', payType: 'monthly', rate: 35000 },
];

// Called when a company is created, inside the same transaction.
// Every row of one transaction gets the same now(), and the lists are shown in
// the order they were created, so each row is given its own moment.
const staggered = (index: number) => new Date(Date.now() + index);

export async function seedDefaultMasters(
  em: EntityManager,
  companyId: string,
): Promise<void> {
  await em.save(
    Object.entries(DEFAULT_CATALOG).flatMap(([kind, names]) =>
      names.map((name, index) =>
        em.create(CatalogItemEntity, {
          company: { id: companyId },
          kind,
          name,
          isActive: true,
          createdAt: staggered(index),
        }),
      ),
    ),
  );
  await em.save(
    DEFAULT_WORKER_RATES.map((rate, index) =>
      em.create(WorkerRateEntity, {
        company: { id: companyId },
        ...rate,
        isActive: true,
        createdAt: staggered(index),
      }),
    ),
  );
}
