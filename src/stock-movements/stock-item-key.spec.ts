import { keyConditions, normalizeItemKey } from './stock-item-key';
import { StockItemKey } from './stock.types';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FACTORY = id(1);
const MATERIAL = id(2);
const SOOT = id(3);
const SIZE = id(4);
const WIDTH = id(5);

const slab: StockItemKey = {
  factoryId: FACTORY,
  itemType: 'slab',
  materialId: MATERIAL,
};
const piece: StockItemKey = {
  ...slab,
  itemType: 'piece',
  sootTypeId: SOOT,
  sootSizeId: SIZE,
  finish: 'polished',
};
const counter: StockItemKey = {
  ...slab,
  itemType: 'counter',
  counterWidthId: WIDTH,
  finish: 'unpolished',
};

const errorsOf = (key: StockItemKey): Record<string, string> => {
  try {
    normalizeItemKey(key);
  } catch (e) {
    return (e as { response: { errors: Record<string, string> } }).response
      .errors;
  }
  throw new Error('expected the key to be refused');
};

describe('normalizeItemKey', () => {
  it('should accept a slab with only material and factory', () => {
    expect(normalizeItemKey(slab)).toEqual({
      ...slab,
      sootTypeId: null,
      sootSizeId: null,
      counterWidthId: null,
      finish: null,
    });
  });

  it('should accept a piece (soot + size + finish) and a counter (width + finish)', () => {
    expect(normalizeItemKey(piece).finish).toBe('polished');
    expect(normalizeItemKey(counter).counterWidthId).toBe(WIDTH);
  });

  it('should treat undefined and null parts the same', () => {
    expect(
      normalizeItemKey({ ...slab, finish: null, sootTypeId: undefined }),
    ).toEqual(normalizeItemKey(slab));
  });

  it('should require soot, size and finish for a piece', () => {
    expect(errorsOf({ ...piece, sootTypeId: null })).toEqual({
      sootTypeId: 'required',
    });
    expect(errorsOf({ ...piece, sootSizeId: undefined })).toEqual({
      sootSizeId: 'required',
    });
    expect(errorsOf({ ...piece, finish: null })).toEqual({
      finish: 'required',
    });
  });

  it('should require width and finish for a counter', () => {
    expect(errorsOf({ ...counter, counterWidthId: null })).toEqual({
      counterWidthId: 'required',
    });
    expect(errorsOf({ ...counter, finish: null })).toEqual({
      finish: 'required',
    });
  });

  it('should refuse parts that do not belong to the item type', () => {
    expect(errorsOf({ ...piece, counterWidthId: WIDTH })).toEqual({
      counterWidthId: 'notAllowedForItemType',
    });
    expect(errorsOf({ ...counter, sootTypeId: SOOT })).toEqual({
      sootTypeId: 'notAllowedForItemType',
    });
    expect(errorsOf({ ...slab, finish: 'polished' })).toEqual({
      finish: 'notAllowedForItemType',
    });
  });

  it('should refuse bad ids, finish values and item types', () => {
    expect(errorsOf({ ...slab, factoryId: 'nope' })).toEqual({
      factoryId: 'invalidId',
    });
    expect(errorsOf({ ...piece, finish: 'shiny' as never })).toEqual({
      finish: 'required',
    });
    expect(errorsOf({ ...slab, itemType: 'brick' as never })).toHaveProperty(
      'itemType',
      'invalid',
    );
  });
});

describe('keyConditions', () => {
  it('should use = for set parts and IS NULL for the rest, numbered from startAt', () => {
    const { sql, params } = keyConditions(normalizeItemKey(slab), 2);
    expect(sql).toBe(
      '"factoryId" = $2 AND "itemType" = $3 AND "materialId" = $4 AND ' +
        '"sootTypeId" IS NULL AND "sootSizeId" IS NULL AND ' +
        '"counterWidthId" IS NULL AND "finish" IS NULL',
    );
    expect(params).toEqual([FACTORY, 'slab', MATERIAL]);
  });

  it('should prefix columns with the alias', () => {
    expect(keyConditions(normalizeItemKey(piece), 1, 'm').sql).toContain(
      'm."sootTypeId" = $4',
    );
  });

  it('should give different pieces different conditions (no accidental sharing)', () => {
    const a = keyConditions(normalizeItemKey(piece), 1);
    const b = keyConditions(
      normalizeItemKey({ ...piece, finish: 'unpolished' }),
      1,
    );
    expect(a.params).not.toEqual(b.params);
  });
});
