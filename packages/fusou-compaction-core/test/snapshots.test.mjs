import test from 'node:test';
import assert from 'node:assert/strict';
import * as node_zlib from 'node:zlib';
import * as node_util from 'node:util';
import { buildOverviewSnapshot, buildDropsSnapshot, compressBrotli, normalizeBattleResult } from '../dist/snapshots.js';

const brotliDecompressAsync = node_util.promisify(node_zlib.brotliDecompress);

test('buildOverviewSnapshot joins battles and cells correctly with UUID links', () => {
  const sorties = [
    {
      env_uuid: '0192e100-0000-7000-8000-000000000001',
      period_tag: '2026-10',
      table_version: 'v1.0',
      timestamp: 1700000000000,
      cells: [
        // cells without direct battles link (relies on sortie.cells[0] for maparea_id/mapinfo_no)
        { cell_index: [1, 2], maparea_id: 5, mapinfo_no: 4 },
      ],
      battles: [
        // battle has battle_result UUID string (standard Avro relation)
        { uuid: 'battle-1', cell_id: 2, battle_result: 'result-uuid-1', f_formation: 1, air_superiority: 1 },
      ],
      battleResults: [
        { uuid: 'result-uuid-1', win_rank: 'S', drop_ship_id: 101, mvp_ship_indexes: [0] },
      ],
      enemyDecks: [{ uuid: 'deck-1', name: '深海護衛空母群' }],
      enemyShips: [{ uuid: 'ship-1', mst_ship_id: 1501 }],
    },
    {
      // Non-combat sortie (e.g. 1-6 resource run)
      env_uuid: '0192e100-0000-7000-8000-000000000002',
      period_tag: '2026-10',
      timestamp: 1699999999000,
      cells: [
        { battles: null, maparea_id: 1, mapinfo_no: 6, event_id: 1 },
      ],
      battles: [],
      battleResults: [],
    }
  ];

  const overview = buildOverviewSnapshot(sorties, {
    maxBattles: 10,
    existingEnemyDecks: [{ uuid: 'deck-hist', name: '歴代敵艦隊' }],
    existingEnemyShips: [{ uuid: 'ship-hist', mst_ship_id: 1502 }],
  });
  assert.equal(overview.success, true);
  assert.equal(overview.period_tag, '2026-10');
  assert.equal(overview.battles.length, 1);
  assert.equal(overview.battles[0].env_uuid, '0192e100-0000-7000-8000-000000000001');
  // maparea_id & mapinfo_no inherited from firstCell!
  assert.equal(overview.battles[0].maparea_id, 5);
  assert.equal(overview.battles[0].mapinfo_no, 4);
  assert.equal(overview.battles[0].f_formation, 1);
  // battle_result linked via result-uuid-1 correctly!
  assert.ok(overview.battles[0].battle_result);
  assert.equal(overview.battles[0].battle_result.win_rank, 'S');
  assert.deepEqual(overview.battles[0].battle_result.mvp_ship_indexes, [0]);
  assert.equal(overview.battles[0].battle_result.drop_ship_id, 101);

  // Cells for sortie 1 are included
  assert.equal(overview.cells.length, 1);
  assert.equal(overview.cells[0].env_uuid, '0192e100-0000-7000-8000-000000000001');

  // Enemy decks and ships are included
  assert.equal(overview.enemy_decks.length, 2);
  assert.equal(overview.enemy_decks[0].uuid, 'deck-1');
  assert.equal(overview.enemy_decks[1].uuid, 'deck-hist');
  assert.equal(overview.enemy_ships.length, 2);
  assert.equal(overview.enemy_ships[0].uuid, 'ship-1');
  assert.equal(overview.enemy_ships[1].uuid, 'ship-hist');
});

test('buildOverviewSnapshot preserves cell_id and timestamp without being overwritten by null in battle', () => {
  const sorties = [
    {
      env_uuid: '0192e100-0000-7000-8000-000000000003',
      period_tag: '2026-10',
      timestamp: 1700000000000,
      cells: [
        { battles: 'battle-null-ts', maparea_id: 2, mapinfo_no: 3, cell_id: 7 },
      ],
      battles: [
        // Battle has cell_id: null and timestamp: null, but midnight_timestamp is present
        { uuid: 'battle-null-ts', cell_id: null, timestamp: null, midnight_timestamp: 1700000005000 },
      ],
      battleResults: [
        { uuid: 'battle-null-ts', win_rank: 'A' },
      ],
    },
  ];

  const overview = buildOverviewSnapshot(sorties);
  assert.equal(overview.battles.length, 1);
  // cell_id must not be null!
  assert.equal(overview.battles[0].cell_id, 7);
  // timestamp must not be null!
  assert.equal(overview.battles[0].timestamp, 1700000005000);
});

test('compressBrotli compresses and can be decompressed losslessly', async () => {
  const payload = { test: 'fusou-compaction', timestamp: 12345678 };
  const json = JSON.stringify(payload);
  const compressed = await compressBrotli(json);
  assert.ok(compressed.length > 0);

  const decompressed = await brotliDecompressAsync(Buffer.from(compressed));
  const parsed = JSON.parse(decompressed.toString('utf8'));
  assert.deepEqual(parsed, payload);
});

test("normalizeBattleResult normalizes api_mvp to 0-based mvp_ship_indexes", () => {
  const res = normalizeBattleResult({ win_rank: "S", api_mvp: 1, drop_ship_id: 101 });
  assert.equal(res.win_rank, "S");
  assert.deepEqual(res.mvp_ship_indexes, [0]);
});

test("buildOverviewSnapshot resolves cell and battleResult with array battles and index alignment", () => {
  const sorties = [
    {
      env_uuid: "0192e100-0000-7000-8000-000000000004",
      period_tag: "2026-10",
      timestamp: 1700000000000,
      cells: [
        {
          battles: ["battle-in-array"],
          battle_index: [0, 1],
          cell_index: [4, 8],
          maparea_id: 3,
          mapinfo_no: 2,
        },
      ],
      battles: [
        // Battle without cell_id and without battle_result UUID link (resolved by battle_index: 0)
        { uuid: "battle-in-array", index: 0 },
      ],
      battleResults: [
        // Battle result without matching UUID, but index: 0
        { uuid: "different-result-uuid", index: 0, win_rank: "S", drop_ship_id: 456 },
      ],
    },
  ];

  const overview = buildOverviewSnapshot(sorties);
  assert.equal(overview.battles.length, 1);
  assert.equal(overview.battles[0].cell_id, 4); // derived from cell_index[0] via battle_index[0]
  assert.equal(overview.battles[0].maparea_id, 3);
  assert.equal(overview.battles[0].mapinfo_no, 2);
  assert.ok(overview.battles[0].battle_result);
  assert.equal(overview.battles[0].battle_result.win_rank, "S");
  assert.equal(overview.battles[0].battle_result.drop_ship_id, 456);
});

test("buildOverviewSnapshot normalizes second timestamp to ms, attaches enemy_summary, and filters non-combat cells", () => {
  const sorties = [
    {
      env_uuid: "0192e100-0000-7000-8000-000000000005",
      period_tag: "2026-10",
      timestamp: 1700000000, // seconds
      cells: [
        { cell_id: 10, maparea_id: 1, mapinfo_no: 1 },
      ],
      battles: [
        // battle with second timestamp and e_deck_id
        { uuid: "battle-s", cell_id: 10, timestamp: 1700000000, e_deck_id: "deck-s" },
        // battle without cell_id (should be filtered out of overview)
        { uuid: "battle-no-cell", cell_id: null },
      ],
      battleResults: [],
      enemyDecks: [{ uuid: "deck-s", name: "深海棲艦主力部隊" }],
    },
  ];

  const overview = buildOverviewSnapshot(sorties);
  assert.equal(overview.battles.length, 1);
  assert.equal(overview.battles[0].timestamp, 1700000000000); // normalized to ms!
  assert.equal(overview.battles[0].cell_id, 10);
  assert.equal(overview.battles[0].enemy_summary, "深海棲艦主力部隊");
});
