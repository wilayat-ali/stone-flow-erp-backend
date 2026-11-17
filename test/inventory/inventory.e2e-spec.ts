// End-to-end tests for Inventory: the stock list and history, stock entries
// (opening, adjustment, transfer) with approval, the "running low" levels and
// the materials and piece-size lists. They boot the whole app in-process, use
// the database from .env, create everything through the real API with unique
// "e2e-<run>" data, and delete it all afterwards.
//
//   npm run test:e2e -- inventory
import { Harness, Member, Workspace } from '../utils/harness';

jest.setTimeout(240000);

type Item = {
  itemType: string;
  material: string;
  factoryId: string;
  soot?: string;
  size?: string;
  width?: number;
  finish?: string;
};

type Entry = {
  id: string;
  entryNo: string;
  type: string;
  date: string;
  direction: number;
  reason: string | null;
  note: string;
  item: Item;
  qty: number;
  inches: number;
  factoryName: string;
  toFactoryId: string | null;
  toFactoryName: string | null;
  status: string;
  rejectReason: string | null;
  createdBy: string;
  approvedBy: string | null;
};

type Row = {
  itemType: string;
  factoryId: string;
  materialId: string;
  sootTypeId: string | null;
  sootSizeId: string | null;
  counterWidthId: string | null;
  finish: string | null;
  qty: number;
  inches: number;
  materialName: string;
  factoryName: string;
  sootTypeName: string | null;
  sootSizeName: string | null;
  counterWidthName: string | null;
  widthInches: number | null;
  lengthInches: number | null;
  item: Item;
  minQty: number | null;
  low: boolean;
};

type Paged<T> = { total: number; rows: T[] };
type Named = { id: string; name: string; isActive: boolean };
type Size = {
  id: string;
  sootTypeId: string;
  sootTypeName: string;
  label: string;
  widthInches: number;
  lengthInches: number;
  isActive: boolean;
};
type History = {
  id: string;
  date: string;
  qty: number;
  inches: number;
  sourceType: string;
  sourceId: string | null;
  note: string | null;
  balanceQty: number;
  balanceInches: number;
};

const codeOf = (res: { body: unknown }) => (res.body as { code?: string }).code;

describe('Inventory (e2e)', () => {
  let h: Harness;
  let A: Workspace;
  let B: Workspace;
  let manager: Member;
  let munshi: Member;
  let viewer: Member;

  let f1: string;
  let f2: string;
  let cuttingFactory: string;

  const call = (...args: Parameters<Harness['call']>) => h.call(...args);
  const owner = () => A.ownerToken;

  const piece = (over: Partial<Item> = {}): Item => ({
    itemType: 'piece',
    factoryId: f1,
    material: 'Ziarat White',
    soot: '14',
    size: '12x24',
    finish: 'unpolished',
    ...over,
  });
  const counter = (over: Partial<Item> = {}): Item => ({
    itemType: 'counter',
    factoryId: f1,
    material: 'Ziarat White',
    width: 2,
    finish: 'polished',
    ...over,
  });
  const slab = (over: Partial<Item> = {}): Item => ({
    itemType: 'slab',
    factoryId: f1,
    material: 'Ziarat White',
    ...over,
  });

  const entry = (token: string, over: Record<string, unknown> = {}) =>
    call('post', '/stock-entries', token, {
      type: 'adjustment',
      date: '2026-10-09',
      direction: 1,
      reason: 'mismatch',
      item: piece(),
      qty: 10,
      ...over,
    });
  const opening = async (item: Item, qty: number, inches?: number) =>
    (
      await entry(owner(), {
        type: 'opening',
        item,
        qty,
        ...(inches ? { inches } : {}),
      }).expect(201)
    ).body as Entry;
  const stock = async (qs = '', token = owner()) =>
    (await call('get', `/stock${qs}`, token).expect(200)).body as Paged<Row>;
  const rowOf = async (item: Item) =>
    (await stock('?limit=200')).rows.find(
      (r) =>
        r.itemType === item.itemType &&
        r.factoryId === item.factoryId &&
        r.materialName.toLowerCase() === item.material.toLowerCase() &&
        (item.itemType !== 'piece' || r.sootSizeName === item.size) &&
        (item.itemType !== 'counter' || r.widthInches === item.width) &&
        (r.finish ?? undefined) === item.finish,
    );
  const qtyOf = async (item: Item) => (await rowOf(item))?.qty ?? 0;
  const entries = async (qs = '', token = owner()) =>
    (await call('get', `/stock-entries${qs}`, token).expect(200))
      .body as Entry[];
  const setApproval = (on: boolean) =>
    call('patch', '/company/settings', owner(), {
      approvalRequired: on,
    }).expect(200);
  const newFactory = async (name: string, kind = 'own', token = owner()) =>
    (
      await call('post', '/settings/factories', token, { name, kind }).expect(
        201,
      )
    ).body.id as string;

  beforeAll(async () => {
    h = await Harness.start();
    A = await h.createCompany('inv-a');
    B = await h.createCompany('inv-b');
    manager = await h.addMember(A, 'manager', 'MgrInv');
    munshi = await h.addMember(A, 'munshi', 'MunshiInv');
    viewer = await h.addMember(A, 'viewer', 'ViewerInv');

    f1 = await newFactory('Main Factory');
    f2 = await newFactory('North Yard');
    cuttingFactory = await newFactory('Khan Cutting', 'cutting');
  });

  afterAll(async () => {
    await h.stop();
  });

  describe('materials and piece sizes', () => {
    it('should start with the default materials and piece sizes', async () => {
      const materials = (
        await call('get', '/settings/materials', owner()).expect(200)
      ).body as Named[];
      expect(materials.map((m) => m.name)).toEqual([
        'Ziarat White (rough)',
        'Sunny Grey (rough)',
        'Jet Black (rough)',
        'Black Galaxy (rough)',
        'Carrara White (rough)',
      ]);

      const sizes = (
        await call('get', '/settings/piece-sizes', owner()).expect(200)
      ).body as Size[];
      expect(sizes).toHaveLength(20);
      const fourteen = sizes.filter((s) => s.sootTypeName === '14 soot');
      expect(fourteen.map((s) => s.label)).toEqual([
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
      ]);
      expect(fourteen.find((s) => s.label === '12x24')).toMatchObject({
        widthInches: 12,
        lengthInches: 24,
        isActive: true,
      });
    });

    it('should add, hide and refuse piece sizes', async () => {
      const soot = (
        (await call('get', '/settings/soot-sizes', owner()).expect(200))
          .body as Named[]
      )[0];

      const res = await call('post', '/settings/piece-sizes', owner(), {
        sootTypeId: soot.id,
        label: '8x8',
      }).expect(201);
      expect(res.body).toMatchObject({
        label: '8x8',
        widthInches: 8,
        lengthInches: 8,
        sootTypeName: soot.name,
      });

      const dup = await call('post', '/settings/piece-sizes', owner(), {
        sootTypeId: soot.id,
        label: '8x8',
      }).expect(409);
      expect(codeOf(dup)).toBe('DUPLICATE_NAME');

      await call('post', '/settings/piece-sizes', owner(), {
        sootTypeId: soot.id,
        label: '8-8',
      }).expect(422);
      await call('post', '/settings/piece-sizes', owner(), {
        sootTypeId: '00000000-0000-4000-8000-000000000000',
        label: '9x9',
      }).expect(422);

      const id = (res.body as Size).id;
      await call('patch', `/settings/piece-sizes/${id}`, owner(), {
        isActive: false,
      }).expect(200);
      const active = (
        await call('get', '/settings/piece-sizes', owner()).expect(200)
      ).body as Size[];
      expect(active.map((s) => s.id)).not.toContain(id);
    });

    it('should let only people with settings.view change them, and everyone read', async () => {
      await call('get', '/settings/piece-sizes', viewer.token).expect(200);
      await call('get', '/settings/materials', munshi.token).expect(200);
      await call('post', '/settings/piece-sizes', manager.token, {
        sootTypeId: '00000000-0000-4000-8000-000000000000',
        label: '9x9',
      }).expect(403);
      await call('post', '/settings/materials', viewer.token, {
        name: 'Nope',
      }).expect(403);
    });

    it('should add a material from Settings', async () => {
      const res = await call('post', '/settings/materials', owner(), {
        name: 'Settings Stone',
      }).expect(201);
      expect(res.body).toMatchObject({
        name: 'Settings Stone',
        isActive: true,
      });
    });
  });

  describe('opening stock', () => {
    it('should add stock at once for the owner and show it with names', async () => {
      const e = await opening(piece(), 40);

      expect(e).toMatchObject({
        entryNo: 'SE-001',
        type: 'opening',
        status: 'approved',
        direction: 1,
        qty: 40,
        inches: 0,
        factoryName: 'Main Factory',
        toFactoryId: null,
        item: {
          itemType: 'piece',
          material: 'Ziarat White',
          factoryId: f1,
          soot: '14',
          size: '12x24',
          finish: 'unpolished',
        },
      });
      expect(e.createdBy).not.toBe('');
      expect(e.approvedBy).not.toBeNull();

      const row = (await rowOf(piece()))!;
      expect(row).toMatchObject({
        qty: 40,
        inches: 0,
        materialName: 'Ziarat White',
        factoryName: 'Main Factory',
        sootTypeName: '14 soot',
        sootSizeName: '12x24',
        widthInches: 12,
        lengthInches: 24,
        minQty: null,
        low: false,
      });
    });

    it('should let only the owner enter opening stock', async () => {
      for (const t of [manager, munshi, viewer]) {
        const res = await entry(t.token, { type: 'opening' });
        expect([403]).toContain(res.status);
      }
      const res = await entry(manager.token, { type: 'opening' }).expect(403);
      expect(codeOf(res)).toBe('OPENING_OWNER_ONLY');
    });

    it('should record the movement in the stock history with a running balance', async () => {
      const item = piece({ size: '12x12' });
      await opening(item, 30);
      await entry(owner(), {
        item,
        direction: -1,
        reason: 'broken',
        qty: 4,
        date: '2026-10-10',
      }).expect(201);

      const row = (await rowOf(item))!;
      const res = await call(
        'get',
        `/stock/history?type=piece&material=${row.materialId}&factory=${f1}&soot=${row.sootTypeId}&size=${row.sootSizeId}&finish=unpolished`,
        owner(),
      ).expect(200);
      const body = res.body as {
        total: number;
        onHand: { qty: number };
        rows: History[];
      };

      expect(body.total).toBe(2);
      expect(body.onHand.qty).toBe(26);
      expect(body.rows.map((r) => [r.qty, r.balanceQty])).toEqual([
        [30, 30],
        [-4, 26],
      ]);
      expect(body.rows[0]).toMatchObject({
        sourceType: 'stock_entry',
        inches: 0,
      });
      expect(body.rows[0].note).toMatch(/^SE-\d{3}/);
    });

    it('should number entries one after another per company', async () => {
      const list = await entries();
      const numbers = list.map((e) => Number(e.entryNo.slice(3)));
      expect(new Set(numbers).size).toBe(numbers.length);

      const results = await Promise.all(
        [1, 2, 3].map(() =>
          entry(owner(), { item: slab({ material: 'Concurrent' }), qty: 1 }),
        ),
      );
      for (const r of results) expect(r.status).toBe(201);
      const seqs = results.map((r) =>
        Number((r.body as Entry).entryNo.slice(3)),
      );
      expect(new Set(seqs).size).toBe(3);
      expect(Math.max(...seqs) - Math.min(...seqs)).toBe(2);
    });
  });

  describe('adjustments', () => {
    it('should add and remove stock with a reason', async () => {
      const item = piece({ size: '12x37' });
      await opening(item, 20);

      await entry(owner(), {
        item,
        direction: 1,
        reason: 'mismatch',
        qty: 5,
      }).expect(201);
      expect(await qtyOf(item)).toBe(25);

      const down = await entry(owner(), {
        item,
        direction: -1,
        reason: 'broken',
        note: '2 cracked while loading',
        qty: 2,
      }).expect(201);
      expect(down.body).toMatchObject({
        direction: -1,
        reason: 'broken',
        note: '2 cracked while loading',
        status: 'approved',
      });
      expect(await qtyOf(item)).toBe(23);
    });

    it('should need a reason, and a note for "other"', async () => {
      await entry(owner(), { reason: undefined }).expect(422);
      await entry(owner(), { reason: 'other' }).expect(422);
      await entry(owner(), { reason: 'other', note: '  ' }).expect(422);
      await entry(owner(), {
        reason: 'other',
        note: 'Found in the yard',
      }).expect(201);
    });

    it('should refuse to remove more than is on hand', async () => {
      const item = piece({ size: '12x43' });
      await opening(item, 3);

      const res = await entry(owner(), {
        item,
        direction: -1,
        reason: 'broken',
        qty: 4,
      }).expect(409);
      expect(codeOf(res)).toBe('INSUFFICIENT_STOCK');
      expect((res.body as { available: number }).available).toBe(3);
      expect(await qtyOf(item)).toBe(3);
    });

    it('should refuse bad numbers and dates', async () => {
      await entry(owner(), { qty: 0 }).expect(422);
      await entry(owner(), { qty: 1.5 }).expect(422);
      await entry(owner(), { date: '2099-01-01' }).expect(422);
      await entry(owner(), { date: '2026-13-45' }).expect(422);
      await entry(owner(), { type: 'barter' }).expect(422);
      await entry(owner(), { direction: 0 }).expect(422);
    });
  });

  describe('counters and slabs', () => {
    it('should count a counter in pieces and total inches', async () => {
      const item = counter();
      await opening(item, 4, 96);

      const row = (await rowOf(item))!;
      expect(row).toMatchObject({
        qty: 4,
        inches: 96,
        counterWidthName: '2 inch',
        widthInches: 2,
        lengthInches: null,
        sootTypeName: null,
        finish: 'polished',
      });
      expect(row.item).toMatchObject({ itemType: 'counter', width: 2 });
    });

    it('should need inches for a counter and refuse them for anything else', async () => {
      await entry(owner(), { type: 'opening', item: counter(), qty: 2 }).expect(
        422,
      );
      await entry(owner(), {
        type: 'opening',
        item: piece(),
        qty: 2,
        inches: 10,
      }).expect(422);
      await entry(owner(), {
        type: 'opening',
        item: slab(),
        qty: 2,
        inches: 10,
      }).expect(422);
    });

    it('should refuse to remove more inches than are on hand', async () => {
      const item = counter({ finish: 'unpolished' });
      await opening(item, 5, 50);

      const res = await entry(owner(), {
        item,
        direction: -1,
        reason: 'broken',
        qty: 1,
        inches: 60,
      }).expect(409);
      expect(codeOf(res)).toBe('INSUFFICIENT_INCHES');

      await entry(owner(), {
        item,
        direction: -1,
        reason: 'broken',
        qty: 1,
        inches: 10,
      }).expect(201);
      const row = (await rowOf(item))!;
      expect([row.qty, row.inches]).toEqual([4, 40]);
    });

    it('should count a slab by material and factory only', async () => {
      const item = slab({ material: 'Slab Stone' });
      await opening(item, 12);

      const row = (await rowOf(item))!;
      expect(row).toMatchObject({
        qty: 12,
        sootTypeId: null,
        sootSizeId: null,
        counterWidthId: null,
        finish: null,
      });
    });

    it('should refuse a width, soot or size that does not exist', async () => {
      await entry(owner(), {
        type: 'opening',
        item: counter({ width: 7 }),
        qty: 1,
        inches: 5,
      }).expect(422);
      await entry(owner(), {
        type: 'opening',
        item: piece({ soot: '99' }),
        qty: 1,
      }).expect(422);
      await entry(owner(), {
        type: 'opening',
        item: piece({ size: '12-24' }),
        qty: 1,
      }).expect(422);
      await entry(owner(), {
        type: 'opening',
        item: piece({ soot: undefined }),
        qty: 1,
      }).expect(422);
      await entry(owner(), {
        type: 'opening',
        item: piece({ finish: undefined }),
        qty: 1,
      }).expect(422);
    });
  });

  describe('materials and sizes made on first use', () => {
    it('should add a new material the first time, and reuse it ignoring case', async () => {
      await opening(piece({ material: 'Brand New Stone' }), 5);
      await opening(piece({ material: 'brand new stone' }), 7);

      const materials = (
        await call('get', '/settings/materials', owner()).expect(200)
      ).body as Named[];
      expect(
        materials.filter((m) => m.name.toLowerCase() === 'brand new stone'),
      ).toHaveLength(1);

      expect(await qtyOf(piece({ material: 'Brand New Stone' }))).toBe(12);
    });

    it('should add a new piece size the first time', async () => {
      await opening(piece({ size: '9x9' }), 3);

      const sizes = (
        await call('get', '/settings/piece-sizes', owner()).expect(200)
      ).body as Size[];
      expect(
        sizes.filter((s) => s.label === '9x9' && s.sootTypeName === '14 soot'),
      ).toHaveLength(1);
    });

    it('should add one material when two people add it at once', async () => {
      await Promise.all(
        [1, 2, 3].map(() =>
          entry(owner(), {
            type: 'opening',
            item: slab({ material: 'Racing Stone' }),
            qty: 1,
          }).expect(201),
        ),
      );
      const materials = (
        await call('get', '/settings/materials', owner()).expect(200)
      ).body as Named[];
      expect(materials.filter((m) => m.name === 'Racing Stone')).toHaveLength(
        1,
      );
      expect(await qtyOf(slab({ material: 'Racing Stone' }))).toBe(3);
    });
  });

  describe('transfers', () => {
    it('should move stock between two own factories', async () => {
      const item = piece({ size: '12x49' });
      await opening(item, 50);

      const res = await entry(owner(), {
        type: 'transfer',
        item,
        qty: 20,
        toFactoryId: f2,
      }).expect(201);
      expect(res.body).toMatchObject({
        type: 'transfer',
        status: 'approved',
        toFactoryId: f2,
        toFactoryName: 'North Yard',
      });

      expect(await qtyOf(item)).toBe(30);
      expect(await qtyOf({ ...item, factoryId: f2 })).toBe(20);
    });

    it('should refuse the same factory, a cutting factory and too much', async () => {
      const item = piece({ size: '12x55' });
      await opening(item, 10);

      await entry(owner(), {
        type: 'transfer',
        item,
        qty: 1,
        toFactoryId: f1,
      }).expect(422);
      await entry(owner(), { type: 'transfer', item, qty: 1 }).expect(422);
      await entry(owner(), {
        type: 'transfer',
        item,
        qty: 1,
        toFactoryId: cuttingFactory,
      }).expect(422);

      const tooMuch = await entry(owner(), {
        type: 'transfer',
        item,
        qty: 11,
        toFactoryId: f2,
      }).expect(409);
      expect(codeOf(tooMuch)).toBe('INSUFFICIENT_STOCK');
      expect(await qtyOf(item)).toBe(10);
      expect(await qtyOf({ ...item, factoryId: f2 })).toBe(0);
    });

    it('should move a counter with its inches', async () => {
      const item = counter({ finish: 'polished', material: 'Transfer Stone' });
      await opening(item, 6, 120);
      await entry(owner(), {
        type: 'transfer',
        item,
        qty: 2,
        inches: 40,
        toFactoryId: f2,
      }).expect(201);

      const here = (await rowOf(item))!;
      const there = (await rowOf({ ...item, factoryId: f2 }))!;
      expect([here.qty, here.inches]).toEqual([4, 80]);
      expect([there.qty, there.inches]).toEqual([2, 40]);
    });
  });

  describe("a munshi's entry while approval is on", () => {
    it('should wait: no effect on stock', async () => {
      const item = piece({ size: '10x12' });
      await opening(item, 8);

      const e = (
        await entry(munshi.token, {
          item,
          direction: -1,
          reason: 'broken',
          qty: 3,
        }).expect(201)
      ).body as Entry;

      expect(e).toMatchObject({ status: 'pending', approvedBy: null });
      expect(await qtyOf(item)).toBe(8);
      expect((await entries('?status=pending')).map((x) => x.id)).toContain(
        e.id,
      );
    });

    it('should not let the munshi approve or reject', async () => {
      const e = (await entry(munshi.token).expect(201)).body as Entry;
      await call('post', `/stock-entries/${e.id}/approve`, munshi.token).expect(
        403,
      );
      await call('post', `/stock-entries/${e.id}/reject`, munshi.token, {
        reason: 'no',
      }).expect(403);
    });

    it('should change stock when a manager approves, once', async () => {
      const item = piece({ size: '6x12' });
      await opening(item, 8);
      const e = (
        await entry(munshi.token, {
          item,
          direction: -1,
          reason: 'broken',
          qty: 3,
        }).expect(201)
      ).body as Entry;

      const res = await call(
        'post',
        `/stock-entries/${e.id}/approve`,
        manager.token,
      ).expect(200);
      expect(res.body).toMatchObject({ status: 'approved' });
      expect((res.body as Entry).approvedBy).not.toBeNull();
      expect(await qtyOf(item)).toBe(5);

      const again = await call(
        'post',
        `/stock-entries/${e.id}/approve`,
        owner(),
      ).expect(409);
      expect(codeOf(again)).toBe('ALREADY_DECIDED');
    });

    it('should keep the reason when rejected and leave stock alone', async () => {
      const item = piece({ size: '4x12' });
      await opening(item, 8);
      const e = (
        await entry(munshi.token, {
          item,
          direction: -1,
          reason: 'broken',
          qty: 3,
        }).expect(201)
      ).body as Entry;

      await call('post', `/stock-entries/${e.id}/reject`, owner(), {
        reason: ' ',
      }).expect(422);
      const res = await call('post', `/stock-entries/${e.id}/reject`, owner(), {
        reason: 'Recount done already',
      }).expect(200);
      expect(res.body).toMatchObject({
        status: 'rejected',
        rejectReason: 'Recount done already',
      });
      expect(await qtyOf(item)).toBe(8);
      await call('post', `/stock-entries/${e.id}/approve`, owner()).expect(409);
    });

    it('should check the stock again at approval', async () => {
      const item = piece({ size: '6x24', soot: '4' });
      await opening(item, 5);

      const pending = (
        await entry(munshi.token, {
          item,
          direction: -1,
          reason: 'broken',
          qty: 4,
        }).expect(201)
      ).body as Entry;

      // someone else removes most of it meanwhile
      await entry(owner(), {
        item,
        direction: -1,
        reason: 'broken',
        qty: 3,
      }).expect(201);

      const res = await call(
        'post',
        `/stock-entries/${pending.id}/approve`,
        owner(),
      ).expect(409);
      expect(codeOf(res)).toBe('INSUFFICIENT_STOCK');
      // it stays pending and stock is untouched
      expect(await qtyOf(item)).toBe(2);
      expect((await entries()).find((x) => x.id === pending.id)!.status).toBe(
        'pending',
      );
    });

    it('should take effect at once when approval is switched off', async () => {
      await setApproval(false);
      const e = (await entry(munshi.token).expect(201)).body as Entry;
      expect(e.status).toBe('approved');
      await setApproval(true);
    });

    it('should refuse a removal the munshi cannot cover, even while it would wait', async () => {
      const item = piece({ size: '12x12', material: 'Nothing Here' });
      const res = await entry(munshi.token, {
        item,
        direction: -1,
        reason: 'broken',
        qty: 1,
      }).expect(409);
      expect(codeOf(res)).toBe('INSUFFICIENT_STOCK');
    });
  });

  describe('the running-low level', () => {
    it('should flag an item below its level and clear it again', async () => {
      const item = piece({ material: 'Alert Stone' });
      await opening(item, 30);

      const set = await call('put', '/stock/alerts', owner(), {
        item,
        minQty: 50,
      }).expect(200);
      expect(set.body).toEqual({ minQty: 50 });

      const row = (await rowOf(item))!;
      expect(row).toMatchObject({ minQty: 50, low: true });

      const low = await stock('?lowOnly=true&limit=200');
      expect(low.rows.map((r) => r.materialName)).toContain('Alert Stone');
      expect(low.rows.every((r) => r.low)).toBe(true);
      expect(low.total).toBe(low.rows.length);

      await call('put', '/stock/alerts', owner(), { item, minQty: 10 }).expect(
        200,
      );
      expect(await rowOf(item)).toMatchObject({ minQty: 10, low: false });
      expect(
        (await stock('?lowOnly=true&limit=200')).rows.map(
          (r) => r.materialName,
        ),
      ).not.toContain('Alert Stone');

      const removed = await call('put', '/stock/alerts', owner(), {
        item,
        minQty: 0,
      }).expect(200);
      expect(removed.body).toEqual({ minQty: null });
      expect(await rowOf(item)).toMatchObject({ minQty: null, low: false });
    });

    it('should let only people who enter stock set it', async () => {
      await call('put', '/stock/alerts', viewer.token, {
        item: piece(),
        minQty: 5,
      }).expect(403);
      await call('put', '/stock/alerts', manager.token, {
        item: piece(),
        minQty: 5,
      }).expect(200);
      await call('put', '/stock/alerts', owner(), {
        item: piece(),
        minQty: 0,
      }).expect(200);
    });
  });

  describe('looking at stock', () => {
    it('should filter by type, factory, material and finish', async () => {
      const slabs = await stock('?type=slab&limit=200');
      expect(slabs.rows.length).toBeGreaterThan(0);
      expect(slabs.rows.every((r) => r.itemType === 'slab')).toBe(true);

      const atF2 = await stock(`?factory=${f2}&limit=200`);
      expect(atF2.rows.every((r) => r.factoryId === f2)).toBe(true);

      const one = (await rowOf(piece({ material: 'Brand New Stone' })))!;
      const byMaterial = await stock(`?material=${one.materialId}&limit=200`);
      expect(
        byMaterial.rows.every((r) => r.materialId === one.materialId),
      ).toBe(true);

      const polished = await stock('?finish=polished&limit=200');
      expect(polished.rows.every((r) => r.finish === 'polished')).toBe(true);
    });

    it('should page the list and report the total', async () => {
      const all = await stock('?limit=200');
      expect(all.total).toBe(all.rows.length);
      expect(all.total).toBeGreaterThan(3);

      const first = await stock('?limit=2&page=1');
      const second = await stock('?limit=2&page=2');
      expect(first.total).toBe(all.total);
      expect(first.rows).toHaveLength(2);
      expect(second.rows.map((r) => r.materialId + r.sootSizeId)).not.toEqual(
        first.rows.map((r) => r.materialId + r.sootSizeId),
      );
    });

    it('should leave out items with nothing on hand', async () => {
      const item = piece({ material: 'Used Up' });
      await opening(item, 2);
      await entry(owner(), {
        item,
        direction: -1,
        reason: 'broken',
        qty: 2,
      }).expect(201);
      expect(await rowOf(item)).toBeUndefined();
    });

    it('should list entries, waiting ones first, and filter them', async () => {
      const pending = await entries('?status=pending');
      expect(pending.every((e) => e.status === 'pending')).toBe(true);

      const all = await entries();
      const firstDone = all.findIndex((e) => e.status !== 'pending');
      expect(all.slice(firstDone).every((e) => e.status !== 'pending')).toBe(
        true,
      );

      const transfers = await entries('?type=transfer');
      expect(transfers.length).toBeGreaterThan(0);
      expect(transfers.every((e) => e.type === 'transfer')).toBe(true);

      const e = all[0];
      const one = await call('get', `/stock-entries/${e.id}`, owner()).expect(
        200,
      );
      expect((one.body as Entry).entryNo).toBe(e.entryNo);
      await call('get', '/stock-entries/not-a-uuid', owner()).expect(422);
      await call('get', '/stock-entries?status=sideways', owner()).expect(422);
      await call('get', '/stock?type=sideways', owner()).expect(422);
    });

    it('should ask for the whole item when reading history', async () => {
      await call('get', '/stock/history', owner()).expect(422);
    });
  });

  describe('who may do what', () => {
    it('should let a viewer look but not enter or decide', async () => {
      await stock('', viewer.token);
      await entries('', viewer.token);
      const e = (await entries())[0];
      await call('get', `/stock-entries/${e.id}`, viewer.token).expect(200);

      await entry(viewer.token).expect(403);
      await call('post', `/stock-entries/${e.id}/approve`, viewer.token).expect(
        403,
      );
    });

    it('should follow a custom role: entering waits, approving decides', async () => {
      await call('post', '/company/roles', owner(), {
        name: 'Yard clerk',
        permissions: ['dashboard.view', 'inventory.view', 'purchasing.create'],
      }).expect(201);
      await call('post', '/company/roles', owner(), {
        name: 'Yard lead',
        permissions: [
          'dashboard.view',
          'inventory.view',
          'purchasing.create',
          'purchasing.approve',
        ],
      }).expect(201);
      const clerk = await h.addMember(A, 'yard-clerk', 'ClerkInv');
      const lead = await h.addMember(A, 'yard-lead', 'LeadInv');

      const waiting = (await entry(clerk.token).expect(201)).body as Entry;
      expect(waiting.status).toBe('pending');
      await call(
        'post',
        `/stock-entries/${waiting.id}/approve`,
        clerk.token,
      ).expect(403);

      const auto = (await entry(lead.token).expect(201)).body as Entry;
      expect(auto.status).toBe('approved');
      await call(
        'post',
        `/stock-entries/${waiting.id}/approve`,
        lead.token,
      ).expect(200);
    });

    it('should not let a role without inventory.view read', async () => {
      await call('post', '/company/roles', owner(), {
        name: 'No stock',
        permissions: ['dashboard.view'],
      }).expect(201);
      const none = await h.addMember(A, 'no-stock', 'NoneInv');
      await call('get', '/stock', none.token).expect(403);
      await call('get', '/stock-entries', none.token).expect(403);
      await call('get', '/stock/history', none.token).expect(403);
    });
  });

  describe('keeping companies apart', () => {
    it("should not show, open or decide another company's stock and entries", async () => {
      const item = piece({ material: 'Only A' });
      const e = await opening(item, 9);

      expect((await stock('?limit=200', B.ownerToken)).total).toBe(0);
      expect((await entries('', B.ownerToken)).map((x) => x.id)).not.toContain(
        e.id,
      );
      await call('get', `/stock-entries/${e.id}`, B.ownerToken).expect(404);
      await call('post', `/stock-entries/${e.id}/approve`, B.ownerToken).expect(
        404,
      );
      await call('post', `/stock-entries/${e.id}/reject`, B.ownerToken, {
        reason: 'x',
      }).expect(404);
    });

    it("should refuse another company's factory", async () => {
      await entry(B.ownerToken, { type: 'opening', item: piece() }).expect(422);
    });

    it('should number entries and keep materials per company', async () => {
      const bFactory = await newFactory('B Main', 'own', B.ownerToken);
      const res = await call('post', '/stock-entries', B.ownerToken, {
        type: 'opening',
        date: '2026-10-09',
        item: slab({ factoryId: bFactory, material: 'Only B Stone' }),
        qty: 2,
      }).expect(201);
      expect((res.body as Entry).entryNo).toBe('SE-001');

      const aMaterials = (
        await call('get', '/settings/materials', owner()).expect(200)
      ).body as Named[];
      expect(aMaterials.map((m) => m.name)).not.toContain('Only B Stone');
    });
  });
});
