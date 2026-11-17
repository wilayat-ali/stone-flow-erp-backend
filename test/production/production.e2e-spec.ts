// End-to-end tests for Workers and Production: sending a truck to a machine,
// finishing it (the thekadar's pay or the cutting factory's charge), counting
// its output, the steps after cutting with stock and per-sq.ft pay, and
// reversing a step. They boot the whole app in-process, use the database from
// .env, create everything through the real API with unique "e2e-<run>" data,
// and delete it all afterwards.
//
//   npm run test:e2e -- production
import { Harness, Member, Workspace } from '../utils/harness';

jest.setTimeout(240000);

type Item = {
  itemType: string;
  factoryId: string;
  material: string;
  soot?: string;
  size?: string;
  width?: number;
  finish?: string;
};
type Line = {
  direction: 'in' | 'out';
  item: Item;
  qty: number;
  inches?: number;
};
type Entry = {
  id: string;
  entryNo: string;
  date: string;
  type: string;
  purchaseId: string | null;
  workerId: string | null;
  workerName: string | null;
  workerRate: number;
  workerAmount: number;
  wasteSqft: number;
  status: string;
  lines: (Line & { inches: number })[];
  createdBy: string;
};
type Truck = {
  id: string;
  status: string;
  mark: string | null;
  tons: number;
  machineId: string | null;
  machineName: string | null;
  thekadarId: string | null;
  thekadarName: string | null;
  cutStart: string | null;
  cutEnd: string | null;
  cutRatePerTon: number | null;
};
type Finish = {
  purchase: Truck;
  paid: { to: string; amount: number; kind: string };
};
type Worker = {
  id: string;
  name: string;
  payType: string;
  rate: number;
  factoryId: string;
  isActive: boolean;
  earned: number;
  paid: number;
  balance: number;
  openingBalance: number;
};
type Khata = {
  type: string;
  kind: string;
  amount: number;
  balance: number;
  job?: string;
  note?: string;
};
type StockRow = {
  itemType: string;
  factoryId: string;
  materialName: string;
  sootSizeName: string | null;
  widthInches: number | null;
  finish: string | null;
  qty: number;
  inches: number;
};

const codeOf = (res: { body: unknown }) => (res.body as { code?: string }).code;

describe('Production (e2e)', () => {
  let h: Harness;
  let A: Workspace;
  let B: Workspace;
  let manager: Member;
  let munshi: Member;
  let viewer: Member;

  let f1: string; // own factory
  let f2: string; // another own factory
  let cuttingFactory: string;
  let supplierId: string;
  let cuttingSupplierId: string;
  let machineId: string;
  let otherMachineId: string;

  const call = (...args: Parameters<Harness['call']>) => h.call(...args);
  const owner = () => A.ownerToken;
  let purchi = 9000;

  const piece = (size: string, over: Partial<Item> = {}): Item => ({
    itemType: 'piece',
    factoryId: f1,
    material: 'Ziarat White',
    soot: '14',
    size,
    finish: 'unpolished',
    ...over,
  });
  const counter = (width: number, over: Partial<Item> = {}): Item => ({
    itemType: 'counter',
    factoryId: f1,
    material: 'Ziarat White',
    width,
    finish: 'unpolished',
    ...over,
  });

  const newFactory = async (name: string, kind = 'own', extra = {}) =>
    (
      await call('post', '/settings/factories', owner(), {
        name,
        kind,
        ...extra,
      }).expect(201)
    ).body.id as string;

  // An approved truck waiting in the yard.
  const truck = async (over: Record<string, unknown> = {}) =>
    (
      await call('post', '/purchases', owner(), {
        date: '2026-10-08',
        supplierId,
        material: 'Ziarat White (rough)',
        purchiNo: String(++purchi),
        truckNo: 'TKR-1',
        tons: 20,
        ratePerTon: 6000,
        discount: 0,
        stones: 3,
        factoryId: f1,
        note: '',
        ...over,
      }).expect(201)
    ).body as Truck;

  const send = (
    token: string,
    id: string,
    over: Record<string, unknown> = {},
  ) =>
    call('post', `/production/trucks/${id}/send`, token, {
      machineId,
      thekadarName: 'Rashid Khan',
      date: '2026-10-09',
      ...over,
    });
  const finish = (
    token: string,
    id: string,
    over: Record<string, unknown> = {},
  ) =>
    call('post', `/production/trucks/${id}/finish`, token, {
      date: '2026-10-12',
      ratePerTon: 1100,
      ...over,
    });
  const cutTruck = async (over: Record<string, unknown> = {}) => {
    const t = await truck(over);
    await send(owner(), t.id).expect(200);
    await finish(owner(), t.id).expect(200);
    return t;
  };

  const post = (token: string, body: Record<string, unknown>) =>
    call('post', '/production/entries', token, {
      date: '2026-10-13',
      factoryId: f1,
      material: 'Ziarat White',
      note: '',
      ...body,
    });
  const count = (token: string, purchaseId: string, lines: Line[]) =>
    post(token, { type: 'cut', purchaseId, machineType: 'vertical', lines });

  const stock = async () =>
    (await call('get', '/stock?limit=200', owner()).expect(200)).body
      .rows as StockRow[];
  const qtyOf = async (item: Item) =>
    (await stock()).find(
      (r) =>
        r.itemType === item.itemType &&
        r.factoryId === item.factoryId &&
        r.materialName === item.material &&
        (item.itemType !== 'piece' || r.sootSizeName === item.size) &&
        (item.itemType !== 'counter' || r.widthInches === item.width) &&
        (r.finish ?? undefined) === item.finish,
    )?.qty ?? 0;
  const inchesOf = async (item: Item) =>
    (await stock()).find(
      (r) =>
        r.itemType === 'counter' &&
        r.widthInches === item.width &&
        r.finish === item.finish &&
        r.factoryId === item.factoryId,
    )?.inches ?? 0;
  const worker = async (id: string) =>
    (await call('get', `/workers/${id}`, owner()).expect(200)).body as Worker;
  const khata = async (id: string) =>
    (await call('get', `/workers/${id}/khata`, owner()).expect(200))
      .body as Khata[];
  const newWorker = async (over: Record<string, unknown> = {}) =>
    (
      await call('post', '/workers', owner(), {
        name: `Polisher ${++purchi}`,
        factoryId: f1,
        payType: 'sqft',
        rate: 0,
        defaultJob: 'Polisher',
        joinedOn: '2026-09-01',
        ...over,
      }).expect(201)
    ).body as Worker;
  const supplierBalance = async (id: string) =>
    (await call('get', `/suppliers/${id}`, owner()).expect(200)).body
      .balance as number;

  beforeAll(async () => {
    h = await Harness.start();
    A = await h.createCompany('prod-a');
    B = await h.createCompany('prod-b');
    manager = await h.addMember(A, 'manager', 'MgrProd');
    munshi = await h.addMember(A, 'munshi', 'MunshiProd');
    viewer = await h.addMember(A, 'viewer', 'ViewerProd');

    f1 = await newFactory('Main Factory');
    f2 = await newFactory('North Yard');
    cuttingFactory = await newFactory('Khan Cutting', 'cutting', {
      ratePerTon: 900,
    });
    supplierId = (
      await call('post', '/suppliers', owner(), {
        type: 'mine_owner',
        name: 'Haji Gul',
        phone: '0333-1000001',
        city: 'Ziarat',
        openingDate: '2026-09-01',
      }).expect(201)
    ).body.id as string;
    cuttingSupplierId = (
      await call('post', '/suppliers', owner(), {
        type: 'cutting_factory',
        name: 'Khan Cutting',
        phone: '0333-1000002',
        city: 'Hub',
        cuttingRatePerTon: 900,
        openingDate: '2026-09-01',
      }).expect(201)
    ).body.id as string;
    machineId = (
      await call('post', '/settings/machines', owner(), {
        name: 'Vertical Cutter 1',
        type: 'vertical',
        factoryId: f1,
        dayThekadar: 'Rashid Khan',
      }).expect(201)
    ).body.id as string;
    otherMachineId = (
      await call('post', '/settings/machines', owner(), {
        name: 'North Cutter',
        type: 'vertical',
        factoryId: f2,
        dayThekadar: 'Aslam Baig',
      }).expect(201)
    ).body.id as string;
  });

  afterAll(async () => {
    await h.stop();
  });

  describe('workers', () => {
    it('should add a worker and show their balance with the opening balance', async () => {
      const w = await newWorker({ openingBalance: 4000 });
      expect(w.payType).toBe('sqft');
      const got = await worker(w.id);
      expect(got.balance).toBe(4000);
      expect((await khata(w.id))[0]).toMatchObject({
        type: 'opening',
        kind: 'charge',
        amount: 4000,
        balance: 4000,
      });
    });

    it('should refuse a second worker with the same name, in any case', async () => {
      const w = await newWorker();
      const res = await call('post', '/workers', owner(), {
        name: w.name.toUpperCase(),
        factoryId: f1,
        payType: 'ton',
        rate: 1000,
        joinedOn: '2026-09-01',
      }).expect(409);
      expect(codeOf(res)).toBe('DUPLICATE_NAME');
    });

    it('should let the owner edit and deactivate a worker, and keep the name', async () => {
      const w = await newWorker();
      const res = await call('patch', `/workers/${w.id}`, owner(), {
        rate: 9,
        isActive: false,
      }).expect(200);
      expect(res.body).toMatchObject({
        rate: 9,
        isActive: false,
        name: w.name,
      });
    });

    it('should keep workers and their pay behind expenses permissions', async () => {
      await call('get', '/workers', viewer.token).expect(200);
      await call('post', '/workers', munshi.token, {
        name: 'Nope',
        factoryId: f1,
        payType: 'day',
        rate: 800,
        joinedOn: '2026-09-01',
      }).expect(403);
    });

    it('should not show another company a worker', async () => {
      const w = await newWorker();
      await call('get', `/workers/${w.id}`, B.ownerToken).expect(404);
    });
  });

  describe('cutting a truck', () => {
    it('should send an approved truck to a machine and add the thekadar', async () => {
      const t = await truck();
      const res = await send(owner(), t.id).expect(200);
      const body = res.body as Truck;
      expect(body).toMatchObject({
        status: 'cutting',
        machineId,
        machineName: 'Vertical Cutter 1',
        thekadarName: 'Rashid Khan',
        cutStart: '2026-10-09',
      });
      const workers = (
        await call('get', '/workers?q=rashid', owner()).expect(200)
      ).body as Worker[];
      expect(workers).toHaveLength(1);
      expect(workers[0]).toMatchObject({ payType: 'ton', rate: 1100 });
    });

    it('should reuse the same thekadar by name and not add another', async () => {
      const t = await truck();
      await send(owner(), t.id, { thekadarName: 'rashid khan' }).expect(200);
      const workers = (
        await call('get', '/workers?q=rashid', owner()).expect(200)
      ).body as Worker[];
      expect(workers).toHaveLength(1);
    });

    it('should refuse a truck that is not waiting', async () => {
      const t = await truck();
      await send(owner(), t.id).expect(200);
      const again = await send(owner(), t.id).expect(409);
      expect(codeOf(again)).toBe('NOT_WAITING');
    });

    it('should refuse a pending truck', async () => {
      await call('patch', '/company/settings', owner(), {
        approvalRequired: true,
      }).expect(200);
      const pending = (
        await call('post', '/purchases', munshi.token, {
          date: '2026-10-08',
          supplierId,
          material: 'Ziarat White (rough)',
          purchiNo: String(++purchi),
          truckNo: 'TKR-P',
          tons: 10,
          ratePerTon: 6000,
          discount: 0,
          stones: 3,
          factoryId: f1,
          note: '',
        }).expect(201)
      ).body as Truck;
      expect(pending.status).toBe('pending');
      const res = await send(owner(), pending.id).expect(409);
      expect(codeOf(res)).toBe('NOT_WAITING');
      await call('patch', '/company/settings', owner(), {
        approvalRequired: false,
      }).expect(200);
    });

    it('should refuse a machine of another factory, and a date before the truck or in the future', async () => {
      const t = await truck();
      const wrong = await send(owner(), t.id, {
        machineId: otherMachineId,
      }).expect(409);
      expect(codeOf(wrong)).toBe('MACHINE_OTHER_FACTORY');
      const early = await send(owner(), t.id, { date: '2026-10-01' }).expect(
        409,
      );
      expect(codeOf(early)).toBe('DATE_BEFORE_START');
      const future = await send(owner(), t.id, { date: '2999-01-01' }).expect(
        409,
      );
      expect(codeOf(future)).toBe('DATE_IN_FUTURE');
      expect(
        (
          (await call('get', `/purchases/${t.id}`, owner()).expect(200))
            .body as Truck
        ).status,
      ).toBe('in_stock');
    });

    it('should finish a truck and pay the thekadar tons x rate once', async () => {
      const t = await truck({ tons: 21.4 });
      await send(owner(), t.id, { thekadarName: 'Cut Thekadar' }).expect(200);
      const res = await finish(owner(), t.id, { ratePerTon: 1100 }).expect(200);
      const body = res.body as Finish;
      expect(body.paid).toEqual({
        to: 'Cut Thekadar',
        amount: 23540,
        kind: 'thekadar',
      });
      expect(body.purchase).toMatchObject({
        status: 'cut',
        cutEnd: '2026-10-12',
        cutRatePerTon: 1100,
      });

      const workers = (
        await call('get', '/workers?q=cut thekadar', owner()).expect(200)
      ).body as Worker[];
      expect(workers[0].balance).toBe(23540);
      const rows = await khata(workers[0].id);
      expect(rows[0]).toMatchObject({
        type: 'work',
        kind: 'charge',
        amount: 23540,
        job: 'Vertical Cutter 1 cutting',
      });

      const again = await finish(owner(), t.id).expect(409);
      expect(codeOf(again)).toBe('NOT_CUTTING');
      expect((await worker(workers[0].id)).balance).toBe(23540);
    });

    it('should refuse finishing without a rate, or before it started', async () => {
      const t = await truck();
      const early = await finish(owner(), t.id).expect(409);
      expect(codeOf(early)).toBe('NOT_CUTTING');
      await send(owner(), t.id).expect(200);
      const noRate = await finish(owner(), t.id, { ratePerTon: 0 }).expect(409);
      expect(codeOf(noRate)).toBe('RATE_REQUIRED');
      const before = await finish(owner(), t.id, { date: '2026-10-05' }).expect(
        409,
      );
      expect(codeOf(before)).toBe('DATE_BEFORE_START');
    });

    it("should start a truck at another cutting factory and charge that factory's supplier khata", async () => {
      const before = await supplierBalance(cuttingSupplierId);
      const t = await truck({ factoryId: cuttingFactory, tons: 10 });
      const started = await call(
        'post',
        `/production/trucks/${t.id}/start`,
        owner(),
        { date: '2026-10-09' },
      ).expect(200);
      expect((started.body as Truck).status).toBe('cutting');
      expect((started.body as Truck).machineId).toBeNull();

      const res = await finish(owner(), t.id, { ratePerTon: undefined }).expect(
        200,
      );
      expect((res.body as Finish).paid).toEqual({
        to: 'Khan Cutting',
        amount: 9000,
        kind: 'cutting_factory',
      });
      expect((res.body as Finish).purchase.cutRatePerTon).toBe(900);
      expect(await supplierBalance(cuttingSupplierId)).toBe(before + 9000);
    });

    it('should refuse starting at an own factory, and sending to a machine at another factory', async () => {
      const own = await truck();
      const res = await call(
        'post',
        `/production/trucks/${own.id}/start`,
        owner(),
        { date: '2026-10-09' },
      ).expect(409);
      expect(codeOf(res)).toBe('NOT_OTHER_FACTORY');
    });

    it('should refuse finishing a truck at a cutting factory with no supplier for it', async () => {
      const lonely = await newFactory('Lonely Cutting', 'cutting', {
        ratePerTon: 800,
      });
      const t = await truck({ factoryId: lonely });
      await call('post', `/production/trucks/${t.id}/start`, owner(), {
        date: '2026-10-09',
      }).expect(200);
      const res = await finish(owner(), t.id).expect(409);
      expect(codeOf(res)).toBe('NO_CUTTING_SUPPLIER');
      expect(
        (
          (await call('get', `/purchases/${t.id}`, owner()).expect(200))
            .body as Truck
        ).status,
      ).toBe('cutting');
    });

    it('should not allow cancelling a truck once cutting has started', async () => {
      const t = await truck();
      await send(owner(), t.id).expect(200);
      const res = await call('post', `/purchases/${t.id}/cancel`, owner(), {
        reason: 'oops',
      }).expect(409);
      expect(codeOf(res)).toBe('CANCEL_AFTER_CUTTING');
    });

    it('should let a munshi move trucks but not a viewer, and not show other companies', async () => {
      const t = await truck();
      await send(viewer.token, t.id).expect(403);
      await send(B.ownerToken, t.id).expect(404);
      await send(munshi.token, t.id).expect(200);
    });
  });

  describe('counting and the steps after cutting', () => {
    it('should count a cut truck, put the pieces in stock, and count it only once', async () => {
      const t = await cutTruck();
      const before = await qtyOf(piece('12x24'));
      const lines: Line[] = [
        { direction: 'out', item: piece('12x24'), qty: 100 },
        { direction: 'out', item: piece('12x12'), qty: 50 },
      ];
      const res = await count(owner(), t.id, lines).expect(201);
      const entry = res.body as Entry;
      expect(entry).toMatchObject({
        type: 'cut',
        purchaseId: t.id,
        status: 'posted',
      });
      expect(entry.entryNo).toMatch(/^PE-\d{4}$/);
      expect(entry.lines).toHaveLength(2);
      expect(await qtyOf(piece('12x24'))).toBe(before + 100);

      const again = await count(owner(), t.id, lines).expect(409);
      expect(codeOf(again)).toBe('ALREADY_COUNTED');
    });

    it('should refuse counting a truck that is not cut yet', async () => {
      const t = await truck();
      const res = await count(owner(), t.id, [
        { direction: 'out', item: piece('12x24'), qty: 5 },
      ]).expect(409);
      expect(codeOf(res)).toBe('TRUCK_NOT_CUT');
    });

    it('should refuse an entry with no output, or a step with no input', async () => {
      const none = await post(owner(), {
        type: 'polish',
        lines: [{ direction: 'in', item: piece('12x24'), qty: 1 }],
      }).expect(409);
      expect(codeOf(none)).toBe('NO_OUTPUT');
      const noInput = await post(owner(), {
        type: 'polish',
        lines: [
          {
            direction: 'out',
            item: piece('12x24', { finish: 'polished' }),
            qty: 1,
          },
        ],
      }).expect(409);
      expect(codeOf(noInput)).toBe('NO_INPUT');
    });

    it('should polish pieces: inputs out, outputs in, and the worker earns sq.ft x the rate card', async () => {
      const t = await cutTruck();
      await count(owner(), t.id, [
        { direction: 'out', item: piece('12x24'), qty: 100 },
      ]).expect(201);
      const w = await newWorker({ rate: 0 });
      const rawBefore = await qtyOf(piece('12x24'));
      const polishedBefore = await qtyOf(
        piece('12x24', { finish: 'polished' }),
      );

      const res = await post(owner(), {
        type: 'polish',
        workerId: w.id,
        lines: [
          { direction: 'in', item: piece('12x24'), qty: 40 },
          {
            direction: 'out',
            item: piece('12x24', { finish: 'polished' }),
            qty: 40,
          },
        ],
      }).expect(201);
      const entry = res.body as Entry;
      // 40 pieces of 12x24 = 80 sq.ft at the rate card's Polisher rate of 10.
      expect(entry).toMatchObject({
        workerId: w.id,
        workerRate: 10,
        workerAmount: 800,
        status: 'posted',
      });
      expect(await qtyOf(piece('12x24'))).toBe(rawBefore - 40);
      expect(await qtyOf(piece('12x24', { finish: 'polished' }))).toBe(
        polishedBefore + 40,
      );
      expect((await worker(w.id)).balance).toBe(800);
      expect((await khata(w.id))[0]).toMatchObject({
        type: 'work',
        job: 'Polisher',
        amount: 800,
      });
    });

    it("should pay a worker's own rate before the rate card", async () => {
      const t = await cutTruck();
      await count(owner(), t.id, [
        { direction: 'out', item: piece('12x24'), qty: 20 },
      ]).expect(201);
      const w = await newWorker({ rate: 9 });
      const res = await post(owner(), {
        type: 'polish',
        workerId: w.id,
        lines: [
          { direction: 'in', item: piece('12x24'), qty: 10 },
          {
            direction: 'out',
            item: piece('12x24', { finish: 'polished' }),
            qty: 10,
          },
        ],
      }).expect(201);
      expect(res.body).toMatchObject({ workerRate: 9, workerAmount: 180 });
    });

    it('should refuse a step that takes more than is in stock, and change nothing', async () => {
      const w = await newWorker();
      const have = await qtyOf(piece('12x24'));
      const res = await post(owner(), {
        type: 'polish',
        workerId: w.id,
        lines: [
          { direction: 'in', item: piece('12x24'), qty: have + 1 },
          {
            direction: 'out',
            item: piece('12x24', { finish: 'polished' }),
            qty: have + 1,
          },
        ],
      }).expect(409);
      expect(codeOf(res)).toBe('INSUFFICIENT_STOCK');
      expect((res.body as { available: number }).available).toBe(have);
      expect(await qtyOf(piece('12x24'))).toBe(have);
      expect((await worker(w.id)).balance).toBe(0);
    });

    it('should total two lines of the same item before checking stock', async () => {
      const have = await qtyOf(piece('12x24'));
      const half = Math.floor(have / 2) + 1;
      const res = await post(owner(), {
        type: 'polish',
        lines: [
          { direction: 'in', item: piece('12x24'), qty: half },
          { direction: 'in', item: piece('12x24'), qty: half },
          {
            direction: 'out',
            item: piece('12x24', { finish: 'polished' }),
            qty: 1,
          },
        ],
      }).expect(409);
      expect(codeOf(res)).toBe('INSUFFICIENT_STOCK');
    });

    it('should resize and record the waste, and refuse output bigger than the input', async () => {
      const t = await cutTruck();
      await count(owner(), t.id, [
        { direction: 'out', item: piece('12x24'), qty: 30 },
      ]).expect(201);
      const ok = await post(owner(), {
        type: 'resize',
        lines: [
          { direction: 'in', item: piece('12x24'), qty: 10 },
          { direction: 'out', item: piece('12x12'), qty: 18 },
        ],
      }).expect(201);
      // 10 x 2 sq.ft in, 18 x 1 sq.ft out: 2 sq.ft of waste.
      expect((ok.body as Entry).wasteSqft).toBe(2);
      const more = await post(owner(), {
        type: 'resize',
        lines: [
          { direction: 'in', item: piece('12x24'), qty: 1 },
          { direction: 'out', item: piece('12x12'), qty: 3 },
        ],
      }).expect(409);
      expect(codeOf(more)).toBe('OUTPUT_MORE_THAN_INPUT');
    });

    it('should track counters in pieces and inches', async () => {
      const t = await cutTruck();
      await count(owner(), t.id, [
        { direction: 'out', item: piece('12x24'), qty: 10 },
      ]).expect(201);
      const noInches = await post(owner(), {
        type: 'counter',
        lines: [
          { direction: 'in', item: piece('12x24'), qty: 2 },
          { direction: 'out', item: counter(2), qty: 3 },
        ],
      }).expect(422);
      expect(JSON.stringify(noInches.body)).toContain('inches');

      await post(owner(), {
        type: 'counter',
        lines: [
          { direction: 'in', item: piece('12x24'), qty: 2 },
          { direction: 'out', item: counter(2), qty: 3, inches: 144 },
        ],
      }).expect(201);
      expect(await qtyOf(counter(2))).toBeGreaterThanOrEqual(3);
      expect(await inchesOf(counter(2))).toBeGreaterThanOrEqual(144);
    });

    it('should refuse a future date, a worker who is not paid per sq.ft, and a factory that is not ours', async () => {
      const t = await cutTruck();
      const lines: Line[] = [
        { direction: 'out', item: piece('12x24'), qty: 4 },
      ];
      const future = await count(owner(), t.id, lines).then(async () =>
        post(owner(), {
          type: 'cut',
          purchaseId: t.id,
          date: '2999-01-01',
          lines,
        }),
      );
      expect(future.status).toBe(409);
      expect(codeOf(future)).toBe('DATE_IN_FUTURE');

      const thekadar = (
        await call('get', '/workers?q=rashid', owner()).expect(200)
      ).body[0] as Worker;
      const wrong = await post(owner(), {
        type: 'polish',
        workerId: thekadar.id,
        lines: [
          { direction: 'in', item: piece('12x24'), qty: 1 },
          {
            direction: 'out',
            item: piece('12x24', { finish: 'polished' }),
            qty: 1,
          },
        ],
      }).expect(422);
      expect(JSON.stringify(wrong.body)).toContain('workerId');

      const badFactory = await post(owner(), {
        type: 'polish',
        factoryId: B.id,
        lines: [
          { direction: 'in', item: piece('12x24'), qty: 1 },
          {
            direction: 'out',
            item: piece('12x24', { finish: 'polished' }),
            qty: 1,
          },
        ],
      }).expect(422);
      expect(JSON.stringify(badFactory.body)).toContain('factoryId');
    });

    it('should list steps newest first with filters, and show who posted them', async () => {
      const all = (
        await call('get', '/production/entries', owner()).expect(200)
      ).body as Entry[];
      expect(all.length).toBeGreaterThan(3);
      expect(all[0].createdBy).toBeTruthy();
      const dates = all.map((e) => e.date);
      expect([...dates].sort().reverse()).toEqual(dates);
      const polish = (
        await call('get', '/production/entries?type=polish', owner()).expect(
          200,
        )
      ).body as Entry[];
      expect(polish.every((e) => e.type === 'polish')).toBe(true);
      const none = (
        await call(
          'get',
          '/production/entries?from=2999-01-01',
          owner(),
        ).expect(200)
      ).body as Entry[];
      expect(none).toEqual([]);
    });

    it('should list the workers paid per sq.ft for the picker', async () => {
      const list = (
        await call('get', '/production/workers', viewer.token).expect(200)
      ).body as { id: string; name: string }[];
      expect(list.length).toBeGreaterThan(0);
      const ton = (await call('get', '/workers?q=rashid', owner()).expect(200))
        .body[0] as Worker;
      expect(list.find((w) => w.id === ton.id)).toBeUndefined();
    });

    it('should let a munshi post a step but a viewer not, and not show other companies', async () => {
      const t = await cutTruck();
      const lines: Line[] = [
        { direction: 'out', item: piece('12x24'), qty: 6 },
      ];
      await count(viewer.token, t.id, lines).expect(403);
      await count(B.ownerToken, t.id, lines).expect(422);
      await count(munshi.token, t.id, lines).expect(201);
    });
  });

  describe('reversing a step', () => {
    it('should put stock back and take the worker pay back, once', async () => {
      const t = await cutTruck();
      await count(owner(), t.id, [
        { direction: 'out', item: piece('12x24'), qty: 50 },
      ]).expect(201);
      const w = await newWorker({ rate: 0 });
      const rawBefore = await qtyOf(piece('12x24'));
      const polishedBefore = await qtyOf(
        piece('12x24', { finish: 'polished' }),
      );
      const step = (
        await post(owner(), {
          type: 'polish',
          workerId: w.id,
          lines: [
            { direction: 'in', item: piece('12x24'), qty: 10 },
            {
              direction: 'out',
              item: piece('12x24', { finish: 'polished' }),
              qty: 10,
            },
          ],
        }).expect(201)
      ).body as Entry;
      expect((await worker(w.id)).balance).toBe(200);

      const res = await call(
        'post',
        `/production/entries/${step.id}/reverse`,
        manager.token,
      ).expect(403);
      expect(res.status).toBe(403);
      const done = await call(
        'post',
        `/production/entries/${step.id}/reverse`,
        owner(),
      ).expect(200);
      expect((done.body as Entry).status).toBe('reversed');
      expect(await qtyOf(piece('12x24'))).toBe(rawBefore);
      expect(await qtyOf(piece('12x24', { finish: 'polished' }))).toBe(
        polishedBefore,
      );
      expect((await worker(w.id)).balance).toBe(0);
      const rows = await khata(w.id);
      expect(rows.map((r) => [r.kind, r.amount])).toEqual([
        ['charge', 200],
        ['credit', 200],
      ]);

      const twice = await call(
        'post',
        `/production/entries/${step.id}/reverse`,
        owner(),
      ).expect(409);
      expect(codeOf(twice)).toBe('ALREADY_REVERSED');
    });

    it('should refuse reversing a step whose output was already used', async () => {
      const t = await cutTruck();
      await count(owner(), t.id, [
        { direction: 'out', item: piece('12x24'), qty: 20 },
      ]).expect(201);
      const polish = (
        await post(owner(), {
          type: 'polish',
          lines: [
            { direction: 'in', item: piece('12x24'), qty: 20 },
            {
              direction: 'out',
              item: piece('12x24', { finish: 'polished' }),
              qty: 20,
            },
          ],
        }).expect(201)
      ).body as Entry;
      // Use the polished pieces up, so taking the polish back would leave them below zero.
      const polishedNow = await qtyOf(piece('12x24', { finish: 'polished' }));
      await post(owner(), {
        type: 'resize',
        lines: [
          {
            direction: 'in',
            item: piece('12x24', { finish: 'polished' }),
            qty: polishedNow,
          },
          {
            direction: 'out',
            item: piece('12x12', { finish: 'polished' }),
            qty: polishedNow * 2,
          },
        ],
      }).expect(201);

      const res = await call(
        'post',
        `/production/entries/${polish.id}/reverse`,
        owner(),
      ).expect(409);
      expect(codeOf(res)).toBe('REVERSE_NEGATIVE');
      expect(
        (
          (
            await call(
              'get',
              `/production/entries/${polish.id}`,
              owner(),
            ).expect(200)
          ).body as Entry
        ).status,
      ).toBe('posted');
    });

    it('should make a reversed count available to count again', async () => {
      const t = await cutTruck();
      const lines: Line[] = [
        { direction: 'out', item: piece('12x24'), qty: 7 },
      ];
      const first = (await count(owner(), t.id, lines).expect(201))
        .body as Entry;
      await call(
        'post',
        `/production/entries/${first.id}/reverse`,
        owner(),
      ).expect(200);
      await count(owner(), t.id, lines).expect(201);
    });
  });
});
