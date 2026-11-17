import { EntityManager } from 'typeorm';
import { CatalogItemEntity } from './infrastructure/persistence/relational/entities/catalog-item.entity';
import { PieceSizeEntity } from './infrastructure/persistence/relational/entities/piece-size.entity';
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
  material: [
    'Ziarat White (rough)',
    'Sunny Grey (rough)',
    'Jet Black (rough)',
    'Black Galaxy (rough)',
    'Carrara White (rough)',
  ],
};

// The piece sizes (width x length in inches) each soot type is counted against.
// Keyed by the number in the soot type's name ("14 soot" -> 14).
export const DEFAULT_PIECE_SIZES: Record<string, string[]> = {
  '14': [
    '12x61',
    '12x55',
    '12x49',
    '12x43',
    '12x37',
    '12x24',
    '12x12',
    '10x12',
    '6x12',
    '4x12',
  ],
  '6': ['24x24', '12x24', '12x12', '6x12'],
  '4': ['12x24', '12x12', '10x12', '6x12', '6x24', '4x24'],
};

// "12x24" -> width 12, length 24 inches; null if it is not that shape.
export function parsePieceSize(
  label: string,
): { widthInches: number; lengthInches: number } | null {
  const match = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(label);

  if (!match || !(Number(match[1]) > 0) || !(Number(match[2]) > 0)) {
    return null;
  }

  return { widthInches: Number(match[1]), lengthInches: Number(match[2]) };
}

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
  const catalog = await em.save(
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

  const sizes = catalog
    .filter((item) => item.kind === 'soot_size')
    .flatMap((soot) =>
      (DEFAULT_PIECE_SIZES[String(parseFloat(soot.name))] ?? []).map(
        (label, index) => {
          const size = parsePieceSize(label)!;

          return em.create(PieceSizeEntity, {
            company: { id: companyId },
            sootType: { id: soot.id },
            label,
            ...size,
            isActive: true,
            createdAt: staggered(index),
          });
        },
      ),
    );
  await em.save(sizes);
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
