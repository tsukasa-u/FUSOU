import { createSignal, onCleanup, onMount, For } from "solid-js";
import { CustomTitlebar } from "../components/ui/titlebar";
import type { AppTheme } from "../utility/theme";
import {
  APP_THEME_STORAGE_KEY,
  applyAppTheme,
  normalizeAppTheme,
  subscribeAppTheme,
  toggleAppTheme,
} from "../utility/theme";
import {
  AlertMessage,
  ComponentColorBar,
  ComponentColorBarLabel,
  ComponentShipModal,
  ComponentEquipmentModal,
  ComponentEquipmentMstModal,
  ComponentShipMaskedModal,
  EmptySlot,
  EmptyValue,
  IconCautionFill,
  IconKira,
  ShipIcon,
  EquipmentIcon,
  MaterialIcon,
  FleetNumberIcon,
  KiraIcon,
  PlaneProficiencyIcon,
  CautionFillIcon,
  ErrorIcon,
} from "ui";
import { AirStateComponent } from "../components/battles/shared/air_state";
import { FormationComponent } from "../components/battles/shared/formation";
import { SpriteMotionCounts } from "../components/battles/shared/sprite_motion_counts";
import { DamageCommonComponent } from "../components/battles/dmg";
import IconShield from "../icons/shield";
import IconChevronRightS from "../icons/chevron_right_s";
import "../global.css";
import "../css/divider.css";
import "../css/back_slash.css";
import type {
  MstShip,
  MstSlotItem,
  MstSlotItems,
} from "@ipc-bindings/get_data";
import type { Ship } from "@ipc-bindings/port";
import type { SlotItem, SlotItems } from "@ipc-bindings/require_info";

// Real Mock Data for Live Components Specimen
const mockMstSlotItemsDict: Record<number, MstSlotItem> = {
  303: {
    id: 303,
    sortno: 303,
    name: "Bofors 15.2cm連装砲 Model 1930",
    type: [1, 1, 2, 2, 0],
    taik: 0,
    souk: 0,
    houg: 5,
    raig: 0,
    soku: 0,
    baku: 0,
    tyku: 4,
    tais: 0,
    atap: 0,
    houm: 3,
    raim: 0,
    houk: 1,
    raik: 0,
    bakk: 0,
    saku: 0,
    sakb: 0,
    luck: 0,
    leng: 2,
    rare: 3,
    taibaku: 0,
    geigeki: 0,
    broken: [0, 2, 3, 1],
    usebull: "0",
    version: null,
    cost: null,
    distance: null,
  },
  110: {
    id: 110,
    sortno: 110,
    name: "零式水上偵察機11型乙(熟練)",
    type: [1, 7, 10, 10, 0],
    taik: 0,
    souk: 0,
    houg: 1,
    raig: 0,
    soku: 0,
    baku: 2,
    tyku: 1,
    tais: 7,
    atap: 0,
    houm: 2,
    raim: 0,
    houk: 2,
    raik: 0,
    bakk: 0,
    saku: 8,
    sakb: 0,
    luck: 0,
    leng: 2,
    rare: 4,
    taibaku: 0,
    geigeki: 0,
    broken: [1, 1, 2, 3],
    usebull: "0",
    version: null,
    cost: null,
    distance: 6,
  },
  384: {
    id: 384,
    sortno: 384,
    name: "甲標的 丙型",
    type: [1, 3, 5, 5, 0],
    taik: 0,
    souk: 0,
    houg: 0,
    raig: 17,
    soku: 0,
    baku: 0,
    tyku: 0,
    tais: 0,
    atap: 0,
    houm: 0,
    raim: 0,
    houk: 1,
    raik: 0,
    bakk: 0,
    saku: 0,
    sakb: 0,
    luck: 0,
    leng: 1,
    rare: 3,
    taibaku: 0,
    geigeki: 0,
    broken: [1, 3, 2, 0],
    usebull: "0",
    version: null,
    cost: null,
    distance: null,
  },
  129: {
    id: 129,
    sortno: 129,
    name: "熟練見張員",
    type: [1, 9, 32, 32, 0],
    taik: 0,
    souk: 0,
    houg: 0,
    raig: 0,
    soku: 0,
    baku: 0,
    tyku: 0,
    tais: 2,
    atap: 0,
    houm: 2,
    raim: 0,
    houk: 2,
    raik: 0,
    bakk: 0,
    saku: 2,
    sakb: 0,
    luck: 2,
    leng: 1,
    rare: 3,
    taibaku: 0,
    geigeki: 0,
    broken: [0, 1, 0, 0],
    usebull: "0",
    version: null,
    cost: null,
    distance: null,
  },
  505: {
    id: 505,
    sortno: 505,
    name: "16inch連装砲",
    type: [1, 1, 3, 3, 0],
    taik: 0,
    souk: 0,
    houg: 20,
    raig: 0,
    soku: 0,
    baku: 0,
    tyku: 4,
    tais: 0,
    atap: 0,
    houm: 4,
    raim: 0,
    houk: 0,
    raik: 0,
    bakk: 0,
    saku: 0,
    sakb: 0,
    luck: 0,
    leng: 3,
    rare: 2,
    taibaku: 0,
    geigeki: 0,
    broken: [0, 0, 0, 0],
    usebull: "0",
    version: null,
    cost: null,
    distance: null,
  },
  506: {
    id: 506,
    sortno: 506,
    name: "水上偵察機",
    type: [1, 7, 10, 10, 0],
    taik: 0,
    souk: 0,
    houg: 0,
    raig: 0,
    soku: 0,
    baku: 1,
    tyku: 1,
    tais: 2,
    atap: 0,
    houm: 1,
    raim: 0,
    houk: 0,
    raik: 0,
    bakk: 0,
    saku: 5,
    sakb: 0,
    luck: 0,
    leng: 2,
    rare: 1,
    taibaku: 0,
    geigeki: 0,
    broken: [0, 0, 0, 0],
    usebull: "0",
    version: null,
    cost: null,
    distance: null,
  },
  507: {
    id: 507,
    sortno: 507,
    name: "対空電探",
    type: [1, 8, 11, 11, 0],
    taik: 0,
    souk: 0,
    houg: 0,
    raig: 0,
    soku: 0,
    baku: 0,
    tyku: 5,
    tais: 0,
    atap: 0,
    houm: 2,
    raim: 0,
    houk: 0,
    raik: 0,
    bakk: 0,
    saku: 5,
    sakb: 0,
    luck: 0,
    leng: 2,
    rare: 2,
    taibaku: 0,
    geigeki: 0,
    broken: [0, 0, 0, 0],
    usebull: "0",
    version: null,
    cost: null,
    distance: null,
  },
  701: {
    id: 701,
    sortno: 701,
    name: "一式陸攻 二二型甲",
    type: [1, 38, 37, 37, 0],
    taik: 0,
    souk: 0,
    houg: 0,
    raig: 11,
    soku: 0,
    baku: 12,
    tyku: 4,
    tais: 2,
    atap: 0,
    houm: 1,
    raim: 0,
    houk: 0,
    raik: 0,
    bakk: 0,
    saku: 5,
    sakb: 0,
    luck: 0,
    leng: 1,
    rare: 4,
    taibaku: 1,
    geigeki: 0,
    broken: [2, 3, 4, 3],
    usebull: "0",
    version: null,
    cost: null,
    distance: 9,
  },
  702: {
    id: 702,
    sortno: 702,
    name: "銀河",
    type: [1, 38, 37, 37, 0],
    taik: 0,
    souk: 0,
    houg: 0,
    raig: 14,
    soku: 0,
    baku: 14,
    tyku: 3,
    tais: 3,
    atap: 0,
    houm: 2,
    raim: 0,
    houk: 1,
    raik: 0,
    bakk: 0,
    saku: 4,
    sakb: 0,
    luck: 0,
    leng: 1,
    rare: 5,
    taibaku: 1,
    geigeki: 0,
    broken: [3, 4, 5, 4],
    usebull: "0",
    version: null,
    cost: null,
    distance: 8,
  },
  703: {
    id: 703,
    sortno: 703,
    name: "紫電改(三四三空) 戦闘301",
    type: [1, 39, 38, 38, 0],
    taik: 0,
    souk: 0,
    houg: 0,
    raig: 0,
    soku: 0,
    baku: 0,
    tyku: 11,
    tais: 0,
    atap: 0,
    houm: 3,
    raim: 0,
    houk: 3,
    raik: 0,
    bakk: 0,
    saku: 2,
    sakb: 0,
    luck: 0,
    leng: 1,
    rare: 5,
    taibaku: 3,
    geigeki: 2,
    broken: [1, 2, 3, 2],
    usebull: "0",
    version: null,
    cost: null,
    distance: 4,
  },
  704: {
    id: 704,
    sortno: 704,
    name: "二式陸上偵察機(熟練)",
    type: [1, 38, 37, 37, 0],
    taik: 0,
    souk: 0,
    houg: 0,
    raig: 0,
    soku: 0,
    baku: 1,
    tyku: 2,
    tais: 3,
    atap: 0,
    houm: 2,
    raim: 0,
    houk: 2,
    raik: 0,
    bakk: 0,
    saku: 9,
    sakb: 0,
    luck: 0,
    leng: 1,
    rare: 4,
    taibaku: 0,
    geigeki: 0,
    broken: [1, 2, 2, 2],
    usebull: "0",
    version: null,
    cost: null,
    distance: 8,
  },
};

const mockSlotItemsDict: Record<number, SlotItem> = {
  7355: { id: 7355, slotitem_id: 303, locked: 1, level: 6, alv: null },
  7571: { id: 7571, slotitem_id: 303, locked: 1, level: 6, alv: null },
  8735: { id: 8735, slotitem_id: 110, locked: 1, level: 10, alv: 7 },
  3006: { id: 3006, slotitem_id: 384, locked: 1, level: 0, alv: null },
  6865: { id: 6865, slotitem_id: 129, locked: 1, level: 4, alv: null },
  9001: { id: 9001, slotitem_id: 701, locked: 1, level: 0, alv: 7 },
  9002: { id: 9002, slotitem_id: 702, locked: 1, level: 0, alv: 7 },
  9003: { id: 9003, slotitem_id: 703, locked: 1, level: 0, alv: 7 },
  9004: { id: 9004, slotitem_id: 704, locked: 1, level: 0, alv: 5 },
};

const mockYahagiMstShip: MstShip = {
  id: 668,
  sortno: 468,
  sort_id: 11037,
  name: "矢矧改二乙",
  yomi: "やはぎ",
  stype: 3,
  ctype: 41,
  afterlv: 90,
  aftershipid: "663",
  taik: [53, 68],
  souk: [32, 74],
  houg: [30, 81],
  raig: [24, 88],
  tyku: [36, 88],
  luck: [17, 89],
  soku: 10,
  leng: 2,
  slot_num: 4,
  maxeq: [1, 1, 2, 2, 0],
  buildtime: 60,
  broken: [4, 8, 16, 4],
  powup: [2, 2, 2, 3],
  backs: 8,
  getmes: "<br>",
  afterfuel: 480,
  afterbull: 880,
  fuel_max: 45,
  bull_max: 50,
  voicef: 7,
  tais: [],
};

const mockYahagiShip: Ship = {
  id: 4299,
  ship_id: 668,
  lv: 132,
  exp: [1999074, 25926, 69],
  nowhp: 55,
  maxhp: 60,
  soku: 10,
  leng: 2,
  slot: [7355, 7571, 8735, 3006, -1],
  onslot: [1, 1, 2, 2, 0],
  slot_ex: 6865,
  fuel: 45,
  bull: 50,
  slotnum: 4,
  cond: 75,
  karyoku: [95, 81],
  raisou: [102, 88],
  taiku: [107, 88],
  soukou: [76, 74],
  kaihi: [112, 86],
  taisen: [96, 80],
  sakuteki: [84, 60],
  lucky: [22, 89],
  sally_area: 0,
  sortie_tag_id: null,
  sp_effect_items: {
    items: {
      2: {
        kind: 2,
        houg: 2,
        kaih: 2,
        raig: null,
        souk: null,
      },
    },
  },
};

const mockFletcherMstShip: MstShip = {
  id: 692,
  sortno: 492,
  sort_id: 11092,
  name: "Fletcher Kai Mod.2",
  yomi: "フレッチャー",
  stype: 2,
  ctype: 91,
  afterlv: 88,
  aftershipid: null,
  taik: [37, 44],
  souk: [16, 55],
  houg: [18, 59],
  raig: [28, 76],
  tyku: [42, 92],
  luck: [25, 99],
  soku: 10,
  leng: 1,
  slot_num: 3,
  maxeq: [0, 0, 0, 0, 0],
  buildtime: 24,
  broken: [1, 2, 4, 1],
  powup: [1, 1, 2, 2],
  backs: 7,
  getmes: "<br>",
  afterfuel: null,
  afterbull: null,
  fuel_max: 15,
  bull_max: 20,
  voicef: 7,
  tais: [],
};

const mockFletcherShip: Ship = {
  id: 4100,
  ship_id: 692,
  lv: 99,
  exp: [1000000, 0, 100],
  nowhp: 37,
  maxhp: 37,
  soku: 10,
  leng: 1,
  slot: [7355, 7571, 3006, -1, -1],
  onslot: [0, 0, 0, 0, 0],
  slot_ex: 6865,
  fuel: 15,
  bull: 20,
  slotnum: 3,
  cond: 53,
  karyoku: [59, 59],
  raisou: [76, 76],
  taiku: [92, 92],
  soukou: [55, 55],
  kaihi: [94, 94],
  taisen: [90, 90],
  sakuteki: [52, 52],
  lucky: [25, 99],
  sally_area: 0,
  sortie_tag_id: null,
  sp_effect_items: null,
};

const mockDamagedMstShip: MstShip = {
  id: 144,
  sortno: 144,
  sort_id: 10144,
  name: "夕立改二",
  yomi: "ゆうだち",
  stype: 2,
  ctype: 23,
  afterlv: 55,
  aftershipid: null,
  taik: [31, 36],
  souk: [14, 52],
  houg: [20, 73],
  raig: [30, 93],
  tyku: [16, 59],
  luck: [20, 79],
  soku: 10,
  leng: 1,
  slot_num: 3,
  maxeq: [0, 0, 0, 0, 0],
  buildtime: 20,
  broken: [1, 2, 4, 1],
  powup: [1, 2, 1, 1],
  backs: 6,
  getmes: "<br>",
  afterfuel: null,
  afterbull: null,
  fuel_max: 15,
  bull_max: 20,
  voicef: 7,
  tais: [],
};

const mockDamagedShip: Ship = {
  id: 4050,
  ship_id: 144,
  lv: 98,
  exp: [980000, 20000, 98],
  nowhp: 7,
  maxhp: 36,
  soku: 10,
  leng: 1,
  slot: [7355, 7571, -1, -1, -1],
  onslot: [0, 0, 0, 0, 0],
  slot_ex: 0,
  fuel: 4,
  bull: 6,
  slotnum: 3,
  cond: 28,
  karyoku: [73, 73],
  raisou: [93, 93],
  taiku: [59, 59],
  soukou: [52, 52],
  kaihi: [89, 89],
  taisen: [68, 68],
  sakuteki: [49, 49],
  lucky: [20, 79],
  sally_area: 0,
  sortie_tag_id: null,
  sp_effect_items: null,
};

const mockEnemyRuMstShip: MstShip = {
  id: 1555,
  sortno: 555,
  sort_id: 1555,
  name: "戦艦ル級改 flag ship",
  yomi: "せんかんるきゅうかい",
  stype: 8,
  ctype: 1,
  afterlv: null,
  aftershipid: null,
  taik: [130, 130],
  souk: [130, 130],
  houg: [118, 118],
  raig: [0, 0],
  tyku: [88, 88],
  luck: [50, 50],
  soku: 10,
  leng: 3,
  slot_num: 4,
  maxeq: [0, 0, 0, 0, 0],
  buildtime: 0,
  broken: [0, 0, 0, 0],
  powup: [0, 0, 0, 0],
  backs: 6,
  getmes: null,
  afterfuel: null,
  afterbull: null,
  fuel_max: 100,
  bull_max: 120,
  voicef: 0,
  tais: [],
};

const mockEnemyWoMstShip: MstShip = {
  id: 1566,
  sortno: 566,
  sort_id: 1566,
  name: "空母ヲ級改 flag ship",
  yomi: "くうぼをきゅうかい",
  stype: 11,
  ctype: 1,
  afterlv: null,
  aftershipid: null,
  taik: [96, 96],
  souk: [80, 80],
  houg: [0, 0],
  raig: [0, 0],
  tyku: [96, 96],
  luck: [40, 40],
  soku: 10,
  leng: 2,
  slot_num: 4,
  maxeq: [32, 32, 32, 0, 0],
  buildtime: 0,
  broken: [0, 0, 0, 0],
  powup: [0, 0, 0, 0],
  backs: 6,
  getmes: null,
  afterfuel: null,
  afterbull: null,
  fuel_max: 80,
  bull_max: 90,
  voicef: 0,
  tais: [],
};

const mockEnemyIClassMstShip: MstShip = {
  id: 1501,
  sortno: 501,
  sort_id: 1501,
  name: "駆逐イ級 elite",
  yomi: "くちくいきゅう",
  stype: 2,
  ctype: 1,
  afterlv: null,
  aftershipid: null,
  taik: [38, 38],
  souk: [32, 32],
  houg: [48, 48],
  raig: [72, 72],
  tyku: [30, 30],
  luck: [20, 20],
  soku: 10,
  leng: 1,
  slot_num: 3,
  maxeq: [0, 0, 0, 0, 0],
  buildtime: 0,
  broken: [0, 0, 0, 0],
  powup: [0, 0, 0, 0],
  backs: 3,
  getmes: null,
  afterfuel: null,
  afterbull: null,
  fuel_max: 15,
  bull_max: 20,
  voicef: 0,
  tais: [],
};

const mockSlotItems: SlotItems = { slot_items: mockSlotItemsDict };
const mockMstSlotItems: MstSlotItems = { mst_slot_items: mockMstSlotItemsDict };

export default function DesignSystemPage() {
  const [currentTheme, setCurrentTheme] = createSignal<AppTheme>("dark");
  const [demoMaximized, setDemoMaximized] = createSignal<boolean>(false);
  const [demoVolume, setDemoVolume] = createSignal<number>(75);
  const [demoMuted, setDemoMuted] = createSignal<boolean>(false);

  onMount(() => {
    const saved = localStorage.getItem(APP_THEME_STORAGE_KEY);
    const initial = saved ? normalizeAppTheme(saved) : "dark";
    applyAppTheme(initial);
    setCurrentTheme(initial);
    onCleanup(subscribeAppTheme(setCurrentTheme));
  });

  const toggleTheme = () => {
    setCurrentTheme(toggleAppTheme());
  };

  return (
    <div class="min-h-full bg-base-200 text-base-content p-4 sm:p-6 pb-20">
      {/* Header */}
      <div class="max-w-6xl mx-auto space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-base-300 pb-4">
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span class="badge badge-primary badge-sm font-mono uppercase tracking-wider">
                FUSOU-APP
              </span>
              <span class="text-xs text-base-content/60 font-mono">
                DESIGN.md Spec
              </span>
            </div>
            <h1 class="text-2xl sm:text-3xl font-bold tracking-tight">
              FUSOU-APP Design System &amp; Component Catalog
            </h1>
            <p class="text-sm text-base-content/60 mt-0.5">
              Tauri デスクトップ環境に特化した UI
              コンポーネントおよびデザイントークンの公式生体カタログ
            </p>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <a href="/app" class="btn btn-sm btn-ghost gap-1.5">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              アプリに戻る
            </a>
            <button
              type="button"
              onClick={toggleTheme}
              class="btn btn-sm btn-primary gap-1.5"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
              </svg>
              テーマ切替 ({currentTheme() === "dark" ? "Dark" : "Light"})
            </button>
          </div>
        </div>

        {/* Quick Navigation */}
        <nav
          id="quick-jump"
          aria-label="Design system sections"
          class="bg-base-100 rounded-box border border-base-300 p-4"
        >
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-semibold uppercase tracking-wider text-base-content/60">
              Quick Navigation
            </span>
            <span class="text-xs text-base-content/50 font-mono">
              13 Sections
            </span>
          </div>
          <div class="flex flex-wrap gap-2 text-xs">
            <a href="#section-colors" class="btn btn-xs btn-outline rounded-md">
              01 Colors &amp; Tokens
            </a>
            <a
              href="#section-typography"
              class="btn btn-xs btn-outline rounded-md"
            >
              02 Typography
            </a>
            <a
              href="#section-titlebar"
              class="btn btn-xs btn-outline rounded-md"
            >
              03 Frameless Titlebar
            </a>
            <a
              href="#section-buttons"
              class="btn btn-xs btn-outline rounded-md"
            >
              04 Buttons &amp; Tools
            </a>
            <a href="#section-cards" class="btn btn-xs btn-outline rounded-md">
              05 Cards &amp; Surfaces
            </a>
            <a href="#section-forms" class="btn btn-xs btn-outline rounded-md">
              06 Form &amp; Controls
            </a>
            <a href="#section-alerts" class="btn btn-xs btn-outline rounded-md">
              07 Status Alerts
            </a>
            <a
              href="#section-primitives"
              class="btn btn-xs btn-outline rounded-md"
            >
              08 UI Primitives &amp; Icons
            </a>
            <a href="#section-modals" class="btn btn-xs btn-outline rounded-md">
              09 Ship &amp; Equipment Modals
            </a>
            <a href="#section-deck" class="btn btn-xs btn-outline rounded-md">
              10 Fleet &amp; Deck Layout
            </a>
            <a
              href="#section-battles"
              class="btn btn-xs btn-outline rounded-md"
            >
              11 Combat &amp; Summary
            </a>
            <a
              href="#section-base-ops"
              class="btn btn-xs btn-outline rounded-md"
            >
              12 LBAS, Materials, Items &amp; Quests
            </a>
            <a
              href="#section-catalog"
              class="btn btn-xs btn-outline rounded-md"
            >
              13 Component Inventory
            </a>
          </div>
        </nav>

        {/* 01 / COLOR PALETTE */}
        <section id="section-colors" class="space-y-4 pt-2">
          <div class="border-b border-base-300 pb-2">
            <h2 class="text-xl font-bold tracking-tight">
              01 / Color Palette &amp; Theme Tokens
            </h2>
            <p class="text-xs text-base-content/60 mt-0.5">
              <code>src/global.css</code> の DaisyUI 5 OKLCH
              トークンおよびタイトルバー・動作ステータスカラー。
            </p>
          </div>

          <div class="space-y-4">
            <div>
              <h3 class="text-sm font-semibold mb-2">
                DaisyUI Theme Semantic Tokens (<code>src/global.css</code>)
              </h3>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div class="bg-base-100 rounded-box border border-base-300 p-3">
                  <div class="h-10 rounded-md mb-2 border border-base-300 bg-primary" />
                  <div class="font-semibold text-xs">Primary</div>
                  <div class="text-[11px] font-mono text-base-content/60">
                    oklch(87% 0.15 154.449)
                  </div>
                  <div class="text-[10px] text-base-content/50 mt-0.5">
                    Primary CTA &amp; active toggles
                  </div>
                </div>
                <div class="bg-base-100 rounded-box border border-base-300 p-3">
                  <div class="h-10 rounded-md mb-2 border border-base-300 bg-accent" />
                  <div class="font-semibold text-xs">Accent</div>
                  <div class="text-[11px] font-mono text-base-content/60">
                    oklch(86% 0.127 207.078)
                  </div>
                  <div class="text-[10px] text-base-content/50 mt-0.5">
                    Equipment improvement (+n) &amp; stats
                  </div>
                </div>
                <div class="bg-base-100 rounded-box border border-base-300 p-3">
                  <div class="h-10 rounded-md mb-2 border border-base-300 bg-warning" />
                  <div class="font-semibold text-xs">Warning</div>
                  <div class="text-[11px] font-mono text-base-content/60">
                    oklch(70% 0.213 47.604)
                  </div>
                  <div class="text-[10px] text-base-content/50 mt-0.5">
                    Log WARN badges &amp; alerts
                  </div>
                </div>
                <div class="bg-base-100 rounded-box border border-base-300 p-3">
                  <div class="h-10 rounded-md mb-2 border border-base-300 bg-error" />
                  <div class="font-semibold text-xs">Error</div>
                  <div class="text-[11px] font-mono text-base-content/60">
                    oklch(63% 0.237 25.331)
                  </div>
                  <div class="text-[10px] text-base-content/50 mt-0.5">
                    Errors, alert-error &amp; close button hover
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 class="text-sm font-semibold mb-2">
                Window Surfaces, Titlebar &amp; ColorBar Scale
              </h3>
              <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                <div class="bg-base-100 rounded-box border border-base-300 p-2.5">
                  <div class="h-7 rounded mb-1.5 border border-base-300 bg-base-100" />
                  <div class="font-semibold truncate">base-100/200</div>
                  <div class="font-mono text-[10px] text-base-content/60">
                    Dark: 21.6% OKLCH
                  </div>
                </div>
                <div class="bg-base-100 rounded-box border border-base-300 p-2.5">
                  <div class="h-7 rounded mb-1.5 border border-base-300 bg-base-300" />
                  <div class="font-semibold truncate">base-300</div>
                  <div class="font-mono text-[10px] text-base-content/60">
                    Dark: 27% OKLCH
                  </div>
                </div>
                <div class="bg-base-100 rounded-box border border-base-300 p-2.5">
                  <div
                    class="h-7 rounded mb-1.5 border border-white/10"
                    style={{ "background-color": "#1d1c1c" }}
                  />
                  <div class="font-semibold truncate">Popover BG</div>
                  <div class="font-mono text-[10px] text-base-content/60">
                    #1d1c1c
                  </div>
                </div>
                <div class="bg-base-100 rounded-box border border-base-300 p-2.5">
                  <div
                    class="h-7 rounded mb-1.5 border border-white/10"
                    style={{ "background-color": "#27272a" }}
                  />
                  <div class="font-semibold truncate">Titlebar</div>
                  <div class="font-mono text-[10px] text-base-content/60">
                    #27272a
                  </div>
                </div>
                <div class="bg-base-100 rounded-box border border-base-300 p-2.5">
                  <div
                    class="h-7 rounded mb-1.5 border border-white/10"
                    style={{ "background-color": "#96C54E" }}
                  />
                  <div class="font-semibold truncate">Logo Green</div>
                  <div class="font-mono text-[10px] text-base-content/60">
                    #B5D95A / #96C54E / #76B142
                  </div>
                </div>
                <div class="bg-base-100 rounded-box border border-base-300 p-2.5">
                  <div class="text-[10px] space-y-0.5">
                    <div class="text-green-500">text-green-500</div>
                    <div class="text-lime-500">text-lime-500</div>
                    <div class="text-yellow-500">text-yellow-500</div>
                    <div class="text-orange-500">text-orange-500</div>
                    <div class="text-red-500">text-red-500</div>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 class="text-sm font-semibold mb-2">
                Live DaisyUI CSS Tokens
              </h3>
              <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 text-xs">
                <div class="bg-base-100 rounded-box border border-base-300 p-2.5 flex items-center gap-2">
                  <div class="w-6 h-6 rounded bg-base-100 border border-base-300 shrink-0" />
                  <div class="min-w-0">
                    <div class="font-medium truncate">base-100</div>
                    <div class="text-[10px] text-base-content/50">Surface</div>
                  </div>
                </div>
                <div class="bg-base-100 rounded-box border border-base-300 p-2.5 flex items-center gap-2">
                  <div class="w-6 h-6 rounded bg-base-200 border border-base-300 shrink-0" />
                  <div class="min-w-0">
                    <div class="font-medium truncate">base-200</div>
                    <div class="text-[10px] text-base-content/50">Canvas</div>
                  </div>
                </div>
                <div class="bg-base-100 rounded-box border border-base-300 p-2.5 flex items-center gap-2">
                  <div class="w-6 h-6 rounded bg-base-300 shrink-0" />
                  <div class="min-w-0">
                    <div class="font-medium truncate">base-300</div>
                    <div class="text-[10px] text-base-content/50">Border</div>
                  </div>
                </div>
                <div class="bg-base-100 rounded-box border border-base-300 p-2.5 flex items-center gap-2">
                  <div class="w-6 h-6 rounded bg-primary text-primary-content flex items-center justify-center font-bold text-[10px] shrink-0">
                    P
                  </div>
                  <div class="min-w-0">
                    <div class="font-medium truncate">primary</div>
                    <div class="text-[10px] text-base-content/50">CTA</div>
                  </div>
                </div>
                <div class="bg-base-100 rounded-box border border-base-300 p-2.5 flex items-center gap-2">
                  <div class="w-6 h-6 rounded bg-info text-info-content flex items-center justify-center font-bold text-[10px] shrink-0">
                    I
                  </div>
                  <div class="min-w-0">
                    <div class="font-medium truncate">info</div>
                    <div class="text-[10px] text-base-content/50">Data</div>
                  </div>
                </div>
                <div class="bg-base-100 rounded-box border border-base-300 p-2.5 flex items-center gap-2">
                  <div class="w-6 h-6 rounded bg-error text-error-content flex items-center justify-center font-bold text-[10px] shrink-0">
                    ✕
                  </div>
                  <div class="min-w-0">
                    <div class="font-medium truncate">error</div>
                    <div class="text-[10px] text-base-content/50">Critical</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 02 / TYPOGRAPHY */}
        <section id="section-typography" class="space-y-4 pt-2">
          <div class="border-b border-base-300 pb-2">
            <h2 class="text-xl font-bold tracking-tight">
              02 / Typography Hierarchy
            </h2>
            <p class="text-xs text-base-content/60 mt-0.5">
              通常テーブル・一覧はデフォルト Sans、戦術 SVG バッジのみ Roboto
              Mono、一部ページのみ font-mono を使用。
            </p>
          </div>

          <div class="bg-base-100 rounded-box border border-base-300 p-5 space-y-4">
            <div class="border-b border-base-300/60 pb-3">
              <div class="flex items-center justify-between text-xs text-base-content/50 mb-1">
                <span>
                  Unified Page Heading (text-2xl font-semibold — Settings,
                  Uploads, Policy, Start, Update, Debug)
                </span>
                <span>見出し</span>
              </div>
              <h2 class="text-2xl font-semibold">Settings / 通信保全基準</h2>
              <p class="text-xs text-base-content/60 mt-1">
                Communication Integrity Policy
              </p>
            </div>

            <div class="border-b border-base-300/60 pb-3">
              <div class="flex items-center justify-between text-xs text-base-content/50 mb-1">
                <span>
                  Deck / Battle / Quest List Item (text-xs / tabular-nums for
                  telemetry)
                </span>
                <span>一覧データ</span>
              </div>
              <div class="text-xs text-base-content mt-1 flex items-center gap-4">
                <span>矢矧改二乙</span>
                <span class="tabular-nums">55/60</span>
                <span class="badge badge-md border-base-300 w-9 tabular-nums">
                  75
                </span>
                <span class="text-sm tabular-nums">130</span>
              </div>
            </div>

            <div>
              <div class="flex items-center justify-between text-xs text-base-content/50 mb-1">
                <span>
                  Explicit Monospace Scopes (Roboto Mono SVG icons, titlebar
                  tabular-nums, ErrorFallback)
                </span>
                <span>等幅スコープ</span>
              </div>
              <div class="flex flex-wrap items-center gap-4 text-xs">
                <span class="badge badge-outline tabular-nums">
                  Volume: 80%
                </span>
                <span class="badge badge-outline font-mono">
                  ErrorFallback.tsx / data_collection_status.tsx
                </span>
                <span
                  style={{
                    "font-family": '"Roboto Mono", monospace',
                    "font-weight": 500,
                  }}
                >
                  CL / DD / PA (SVG icons)
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* 03 / FRAMELESS TITLEBAR */}
        <section id="section-titlebar" class="space-y-4 pt-2">
          <div class="border-b border-base-300 pb-2">
            <h2 class="text-xl font-bold tracking-tight">
              03 / Frameless Window &amp; Custom Titlebar
            </h2>
            <p class="text-xs text-base-content/60 mt-0.5">
              Tauri v2
              によるネイティブフレームレスウィンドウ構造とカスタムタイトルバーの実装サンプル。
            </p>
          </div>

          <div class="bg-base-100 rounded-box border border-base-300 p-5 space-y-4">
            <div class="flex items-center justify-between">
              <div class="text-xs font-semibold">
                インタラクティブ・タイトルバー実体プレビュー:
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-base-content/60">
                  外枠角丸シミュレーション:
                </span>
                <button
                  type="button"
                  class="btn btn-xs btn-outline"
                  onClick={() => setDemoMaximized(!demoMaximized())}
                >
                  {demoMaximized()
                    ? "最大化状態 (角丸0px)"
                    : "通常状態 (角丸10px)"}
                </button>
              </div>
            </div>

            {/* Titlebar Container Simulation */}
            <div
              class={`border border-base-300 overflow-hidden shadow-lg transition-all ${
                demoMaximized() ? "rounded-none" : "rounded-t-[10px]"
              }`}
            >
              <CustomTitlebar
                isMaximized={demoMaximized()}
                onMaximizeChange={(max) => setDemoMaximized(max)}
              />
              <div class="p-4 bg-base-100 text-xs text-base-content/70">
                ↑ 上記タイトルバーは本物の <code>&lt;CustomTitlebar /&gt;</code>{" "}
                コンポーネントです。
                スクリーンショットボタン、外部リロードボタン、音量調整ポップオーバー、テーマ切り替えボタン、ウィンドウ最小化・最大化・閉じるボタンが配置されています。
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs pt-2">
              <div class="p-3 bg-base-200/50 rounded-lg border border-base-300/60">
                <div class="font-semibold mb-1">1. ルート外枠 (#root)</div>
                <p class="text-base-content/70">
                  通常表示時は <code>border-radius: 10px</code>、最大化時は{" "}
                  <code>is-maximized</code> が付与され <code>0px</code>{" "}
                  にフラット化されます。
                </p>
              </div>
              <div class="p-3 bg-base-200/50 rounded-lg border border-base-300/60">
                <div class="font-semibold mb-1">
                  2. ツールボタン (.fusou-tool-btn)
                </div>
                <p class="text-base-content/70">
                  高さ 24px、角丸
                  4px。キャプチャ中やリロード中にはアニメーションフィードバック（回転・縮小）が提供されます。
                </p>
              </div>
              <div class="p-3 bg-base-200/50 rounded-lg border border-base-300/60">
                <div class="font-semibold mb-1">3. 音量制御ポップオーバー</div>
                <p class="text-base-content/70">
                  <code>.fusou-custom-range</code> と{" "}
                  <code>.fusou-custom-mute-btn</code>{" "}
                  による精密なサウンドスライダーとミュート切り替え。
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 04 / BUTTONS */}
        <section id="section-buttons" class="space-y-4 pt-2">
          <div class="border-b border-base-300 pb-2">
            <h2 class="text-xl font-bold tracking-tight">
              04 / Buttons &amp; Tool Controls
            </h2>
            <p class="text-xs text-base-content/60 mt-0.5">
              明確なアクション意図と優先度に応じた統一ボタンクラス群。
            </p>
          </div>

          <div class="bg-base-100 rounded-box border border-base-300 p-5 space-y-4">
            <div>
              <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/60 mb-2">
                Action Variants
              </h3>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="btn btn-primary border-primary-content btn-sm"
                >
                  Primary Action
                </button>
                <button
                  type="button"
                  class="btn btn-secondary border-secondary-content btn-sm"
                >
                  Secondary Action
                </button>
                <button type="button" class="btn btn-outline btn-sm">
                  Outline Action
                </button>
                <button type="button" class="btn btn-ghost btn-sm">
                  Ghost Action
                </button>
                <button type="button" class="btn btn-error btn-outline btn-sm">
                  Destructive Action
                </button>
              </div>
            </div>

            <div>
              <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/60 mb-2">
                Sizes (lg, md, sm, xs)
              </h3>
              <div class="flex flex-wrap items-center gap-2">
                <button type="button" class="btn btn-primary btn-lg">
                  Large (lg)
                </button>
                <button type="button" class="btn btn-primary btn-md">
                  Default (md)
                </button>
                <button type="button" class="btn btn-primary btn-sm">
                  Small (sm, 標準)
                </button>
                <button type="button" class="btn btn-primary btn-xs">
                  Mini (xs, 高密度)
                </button>
              </div>
            </div>

            <div>
              <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/60 mb-2">
                Titlebar Tool Buttons (.fusou-tool-btn)
              </h3>
              <div class="p-3 bg-[#27272a] rounded-lg inline-flex items-center gap-2">
                <button
                  type="button"
                  class="fusou-tool-btn"
                  title="Normal tool button"
                >
                  <svg
                    class="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                    />
                  </svg>
                  <span>Screenshot</span>
                </button>
                <button
                  type="button"
                  class="fusou-tool-btn fusou-active"
                  title="Active tool button"
                >
                  <svg
                    class="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  <span>Reload (Active)</span>
                </button>
              </div>
            </div>

            <div>
              <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/60 mb-2">
                States &amp; Spinners
              </h3>
              <div class="flex flex-wrap items-center gap-2">
                <button type="button" class="btn btn-primary btn-sm" disabled>
                  Disabled State
                </button>
                <button type="button" class="btn btn-primary btn-sm gap-2">
                  <span class="loading loading-spinner loading-xs" />
                  同期中...
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 05 / CARDS & SURFACES */}
        <section id="section-cards" class="space-y-4 pt-2">
          <div class="border-b border-base-300 pb-2">
            <h2 class="text-xl font-bold tracking-tight">
              05 / Cards, Surfaces &amp; Collapsible Menus
            </h2>
            <p class="text-xs text-base-content/60 mt-0.5">
              枠線コントラストで階層を表現するカード設計と、FUSOU-APP
              標準の折りたたみセクション。
            </p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="bg-base-100 rounded-lg border border-base-300 p-4 flex flex-col justify-between">
              <div>
                <span class="badge badge-neutral badge-xs mb-2">Standard</span>
                <h3 class="font-bold text-sm mb-1">Standard Card</h3>
                <p class="text-xs text-base-content/70">
                  通常のデータ表示パネル、艦隊編成スロット、設定グループ枠に使用。
                </p>
              </div>
              <div class="text-[10px] font-mono text-base-content/50 border-t border-base-300/60 pt-2 mt-3">
                border: 1px solid base-300
              </div>
            </div>

            <div class="bg-base-100 rounded-lg border border-primary/40 p-4 flex flex-col justify-between shadow-xs">
              <div>
                <span class="badge badge-primary badge-xs mb-2">Accent</span>
                <h3 class="font-bold text-sm mb-1">Accent Card</h3>
                <p class="text-xs text-base-content/70">
                  出撃中艦隊、注目イベント、重要アラートのハイライトに使用。
                </p>
              </div>
              <div class="text-[10px] font-mono text-base-content/50 border-t border-base-300/60 pt-2 mt-3">
                border: 1px solid primary/40
              </div>
            </div>

            <div class="bg-base-100 rounded-lg border border-base-300 p-4 flex flex-col justify-between">
              <div>
                <span class="badge badge-info badge-xs mb-2">Collapsible</span>
                <h3 class="font-bold text-sm mb-1">
                  &lt;details open&gt; Menu
                </h3>
                <div class="menu menu-xs bg-base-200/50 rounded-box p-1 mt-1">
                  <li>
                    <details open>
                      <summary class="font-medium text-[11px]">
                        第1艦隊 (6隻)
                      </summary>
                      <ul class="pl-0">
                        <li class="text-[10px] py-0.5 px-2">
                          1. 大和改二 (Lv.99)
                        </li>
                        <li class="text-[10px] py-0.5 px-2">
                          2. 武蔵改二 (Lv.99)
                        </li>
                      </ul>
                    </details>
                  </li>
                </div>
              </div>
              <div class="text-[10px] font-mono text-base-content/50 border-t border-base-300/60 pt-2 mt-3">
                details &gt; summary &gt; ul
              </div>
            </div>
          </div>
        </section>

        {/* 06 / FORM & AUDIO CONTROLS */}
        <section id="section-forms" class="space-y-4 pt-2">
          <div class="border-b border-base-300 pb-2">
            <h2 class="text-xl font-bold tracking-tight">
              06 / Form Elements &amp; Audio Popover
            </h2>
            <p class="text-xs text-base-content/60 mt-0.5">
              フォーカス時の二重枠線を排した一重アクセントカラー枠線（
              <code>var(--color-primary)</code>
              ）の入力フォーム部品と、カスタム音量スライダー。
            </p>
          </div>

          <div class="bg-base-100 rounded-box border border-base-300 p-5 space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label class="block text-xs font-semibold mb-1">
                  Search Input (input-sm)
                </label>
                <input
                  type="text"
                  placeholder="艦名・IDで絞り込み..."
                  class="input input-bordered input-sm w-full text-xs"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1">
                  Select Filter (select-sm)
                </label>
                <select class="select select-bordered select-sm w-full text-xs">
                  <option selected>全海域 (1-1 〜 7-5)</option>
                  <option>南西諸島海域 (2-X)</option>
                  <option>北方海域 (3-X)</option>
                  <option>西方海域 (4-X)</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1 text-error">
                  Input with Error State
                </label>
                <input
                  type="text"
                  value="invalid_api_port"
                  class="input input-bordered input-error input-sm w-full text-xs"
                />
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-base-300/60">
              <div>
                <div class="text-xs font-semibold mb-2">
                  Checkboxes &amp; Toggles
                </div>
                <div class="space-y-2">
                  <label class="flex items-center gap-2 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked
                      class="checkbox checkbox-primary checkbox-xs"
                    />
                    <span>リアルタイム通信解析を有効化</span>
                  </label>
                  <label class="flex items-center gap-2 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked
                      class="toggle toggle-primary toggle-xs"
                    />
                    <span>大破進撃警告通知</span>
                  </label>
                </div>
              </div>

              <div>
                <div class="text-xs font-semibold mb-2">
                  Audio Volume Controls Preview
                </div>
                <div class="p-3 bg-[#1d1c1c] rounded-lg border border-[#27272a] text-[#f1f5f9] max-w-xs space-y-2">
                  <div class="flex items-center justify-between text-xs font-semibold">
                    <span>Sound Volume</span>
                    <span class="text-[10px] font-mono text-base-content/70">
                      {demoMuted() ? "Muted" : `${demoVolume()}%`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={demoVolume()}
                    onInput={(e) => {
                      const v = Number(e.currentTarget.value);
                      setDemoVolume(v);
                      if (v === 0) setDemoMuted(true);
                      else setDemoMuted(false);
                    }}
                    class="fusou-custom-range"
                  />
                  <button
                    type="button"
                    onClick={() => setDemoMuted(!demoMuted())}
                    class={`fusou-custom-mute-btn ${demoMuted() ? "is-muted" : ""}`}
                  >
                    {demoMuted() ? "Unmute" : "Mute Audio"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 07 / ALERTS & BADGES */}
        <section id="section-alerts" class="space-y-4 pt-2">
          <div class="border-b border-base-300 pb-2">
            <h2 class="text-xl font-bold tracking-tight">
              07 / Status Alerts &amp; Badges
            </h2>
            <p class="text-xs text-base-content/60 mt-0.5">
              FUSOU-WEB
              準拠のソフトティント統一アラート（AlertMessage）・戦績バッジ・ログレベルバッジ。
            </p>
          </div>

          <div class="space-y-3">
            <AlertMessage type="info" title="情報">
              新しいマスターデータ（Ver 2026.11）を正常に読み込みました。
            </AlertMessage>
            <AlertMessage type="success" title="成功">
              編成シミュレーション計算完了。制空値 432 (優勢確定)。
            </AlertMessage>
            <AlertMessage type="warning" title="警告">
              第2艦隊 3番艦の疲労度低下（Cond 28）。休養を推奨します。
            </AlertMessage>
            <AlertMessage type="error" title="危険">
              大破進撃警告！ 旗艦・随伴艦に大破艦が存在します。
            </AlertMessage>
          </div>

          <div class="bg-base-100 rounded-box border border-base-300 p-5 space-y-4">
            <div>
              <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/60 mb-2">
                Status Badges
              </h3>
              <div class="flex flex-wrap items-center gap-2">
                <span class="badge badge-primary">Primary</span>
                <span class="badge badge-secondary">Secondary</span>
                <span class="badge badge-info">Info</span>
                <span class="badge badge-success">Success</span>
                <span class="badge badge-warning">Warning</span>
                <span class="badge badge-error">Critical</span>
                <span class="badge badge-outline">Outline</span>
                <span class="badge badge-ghost">Ghost</span>
              </div>
            </div>

            <div>
              <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/60 mb-2">
                Victory Rank Badges
              </h3>
              <div class="flex flex-wrap items-center gap-2 font-mono font-bold">
                <span class="badge badge-success badge-sm">S 勝利</span>
                <span class="badge badge-info badge-sm">A 勝利</span>
                <span class="badge badge-warning badge-sm">B 戦術的勝利</span>
                <span class="badge badge-error badge-sm">C 敗北</span>
                <span class="badge badge-error badge-sm">D 敗北</span>
                <span class="badge badge-error badge-sm">E 敗北</span>
              </div>
            </div>

            <div>
              <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/60 mb-2">
                Log Viewer Level Badges
              </h3>
              <div class="flex flex-wrap items-center gap-2 text-[10px] font-medium">
                <span class="px-2 py-0.5 rounded-md bg-base-300 text-base-content/80">
                  TRACE
                </span>
                <span class="px-2 py-0.5 rounded-md bg-info/20 text-info">
                  DEBUG
                </span>
                <span class="px-2 py-0.5 rounded-md bg-success/20 text-success">
                  INFO
                </span>
                <span class="px-2 py-0.5 rounded-md bg-warning/20 text-warning">
                  WARN
                </span>
                <span class="px-2 py-0.5 rounded-md bg-error/20 text-error">
                  ERROR
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* 08 / UI PRIMITIVES & ICONS */}
        <section id="section-primitives" class="space-y-4 pt-2">
          <div class="border-b border-base-300 pb-2">
            <h2 class="text-xl font-bold tracking-tight">
              08 / UI Primitives &amp; Icons
            </h2>
            <p class="text-xs text-base-content/60 mt-0.5">
              ゲージメーター（ColorBar）およびドメインアイコンコンポーネント。
            </p>
          </div>

          <div class="bg-base-100 rounded-box border border-base-300 p-5 space-y-6">
            <div>
              <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/60 mb-3">
                HP Color Bars (&lt;ComponentColorBar /&gt;)
              </h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
                <div>
                  <div class="text-[11px] mb-1 text-base-content/70">
                    100% (Green / 無傷)
                  </div>
                  <ComponentColorBar v_now={100} v_max={100} size="sm" />
                </div>
                <div>
                  <div class="text-[11px] mb-1 text-base-content/70">
                    80% (Lime / 小破未満)
                  </div>
                  <ComponentColorBar v_now={80} v_max={100} size="sm" />
                </div>
                <div>
                  <div class="text-[11px] mb-1 text-base-content/70">
                    60% (Yellow / 小破)
                  </div>
                  <ComponentColorBar v_now={60} v_max={100} size="sm" />
                </div>
                <div>
                  <div class="text-[11px] mb-1 text-base-content/70">
                    35% (Orange / 中破)
                  </div>
                  <ComponentColorBar v_now={35} v_max={100} size="sm" />
                </div>
                <div class="sm:col-span-2">
                  <div class="text-[11px] mb-1 text-error font-medium">
                    15% (Red / 大破・警戒)
                  </div>
                  <ComponentColorBar v_now={15} v_max={100} size="sm" />
                </div>
              </div>
            </div>

            <div>
              <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/60 mb-3">
                HP &amp; EXP Meter with Labels (&lt;ComponentColorBarLabel
                /&gt;)
              </h3>
              <div class="max-w-md space-y-3">
                <div>
                  <div class="text-[11px] text-base-content/70 mb-1">
                    HP Gauge:
                  </div>
                  <ComponentColorBarLabel v_now={78} v_max={88} size="sm" />
                </div>
                <div>
                  <div class="text-[11px] text-base-content/70 mb-1">
                    EXP Progress:
                  </div>
                  <ComponentColorBarLabel v_now={42} v_max={100} size="sm" />
                </div>
              </div>
            </div>

            <div>
              {/* 08-A: ShipType Badges */}
              <div class="space-y-3 pt-2">
                <div class="flex items-center justify-between border-b border-base-300 pb-1.5">
                  <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                    艦種識別バッジ (&lt;ShipIcon /&gt; / viewBox: 199x151)
                  </h3>
                  <span class="text-[11px] text-base-content/50 font-mono">
                    stype: 1..21 / colors: normal, elite, flagship
                  </span>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3 text-xs">
                  <For
                    each={[
                      { stype: 1, name: "海防艦 (DE)" },
                      { stype: 2, name: "駆逐艦 (DD)" },
                      { stype: 3, name: "軽巡洋艦 (CL)" },
                      { stype: 4, name: "重雷装巡 (CLT)" },
                      { stype: 5, name: "重巡洋艦 (CA)" },
                      { stype: 6, name: "航空巡洋 (CAV)" },
                      { stype: 7, name: "軽空母 (CVL)" },
                      { stype: 8, name: "戦艦 (BB)" },
                      { stype: 10, name: "航空戦艦 (BBV)" },
                      { stype: 11, name: "正規空母 (CV)" },
                      { stype: 13, name: "潜水艦 (SS)" },
                      { stype: 14, name: "潜水空母 (SSV)" },
                      { stype: 15, name: "補給艦 (AO)" },
                      { stype: 16, name: "水上機母艦 (AV)" },
                      { stype: 17, name: "揚陸艦 (LHA)" },
                      { stype: 18, name: "装甲空母 (CVB)" },
                      { stype: 19, name: "工作艦 (AR)" },
                      { stype: 20, name: "潜水母艦 (AS)" },
                      { stype: 21, name: "練習巡洋 (CT)" },
                    ]}
                  >
                    {(item) => (
                      <div class="p-2.5 bg-base-200/50 rounded-lg border border-base-300 flex flex-col items-center gap-1.5 text-center">
                        <ShipIcon ship_stype={item.stype} size="sm" />
                        <span class="text-[11px] font-medium leading-tight">
                          {item.name}
                        </span>
                      </div>
                    )}
                  </For>
                </div>
                <div class="p-3 bg-base-200/30 rounded-lg border border-base-300">
                  <div class="text-[11px] text-base-content/60 mb-2 font-semibold">
                    敵艦・エリート・フラグシップ等級表示 (color prop):
                  </div>
                  <div class="flex flex-wrap items-center gap-4">
                    <div class="flex items-center gap-2">
                      <ShipIcon ship_stype={2} color="" size="sm" />
                      <span class="text-xs">通常等級 (Normal / #CCCCCC)</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <ShipIcon ship_stype={2} color="elite" size="sm" />
                      <span class="text-xs text-orange-500 font-semibold">
                        エリート (Elite / #FF4500)
                      </span>
                    </div>
                    <div class="flex items-center gap-2">
                      <ShipIcon ship_stype={2} color="flagship" size="sm" />
                      <span class="text-xs text-yellow-500 font-semibold">
                        フラグシップ (Flagship / #FFD700)
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 08-B: Equipment Badges */}
              <div class="space-y-3 pt-2">
                <div class="flex items-center justify-between border-b border-base-300 pb-1.5">
                  <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                    装備種別バッジ (&lt;EquipmentIcon /&gt; / viewBox: 151x151)
                  </h3>
                  <span class="text-[11px] text-base-content/50 font-mono">
                    category_number &amp; icon_number
                  </span>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 text-xs">
                  <For
                    each={[
                      { cat: 1, icon: 1, name: "主砲 (PA)" },
                      { cat: 2, icon: 4, name: "副砲 (SA)" },
                      { cat: 3, icon: 5, name: "魚雷 (TO)" },
                      { cat: 5, icon: 6, name: "艦戦 (CA / 緑)" },
                      { cat: 5, icon: 7, name: "艦爆 (CA / 赤)" },
                      { cat: 5, icon: 8, name: "艦攻 (CA / 青)" },
                      { cat: 6, icon: 15, name: "対空機銃 (AA)" },
                      { cat: 7, icon: 10, name: "水上偵察 (RE)" },
                      { cat: 8, icon: 11, name: "電探 (RA)" },
                      { cat: 10, icon: 18, name: "ソナー (SO)" },
                      { cat: 14, icon: 20, name: "上陸用舟艇 (LC)" },
                      { cat: 17, icon: 23, name: "追加装甲 (EA)" },
                      { cat: 25, icon: 13, name: "徹甲弾 (AP)" },
                      { cat: 28, icon: 12, name: "対空強化弾 (AA)" },
                      { cat: 30, icon: 14, name: "ダメコン (DC)" },
                      { cat: 38, icon: 37, name: "陸上攻撃機 (LA)" },
                      { cat: 39, icon: 38, name: "局地戦闘機 (IN)" },
                      { cat: 40, icon: 39, name: "噴式爆撃機 (JB)" },
                    ]}
                  >
                    {(item) => (
                      <div class="p-2.5 bg-base-200/50 rounded-lg border border-base-300 flex flex-col items-center gap-1.5 text-center">
                        <EquipmentIcon
                          category_number={item.cat}
                          icon_number={item.icon}
                          size="sm"
                        />
                        <span class="text-[11px] font-medium leading-tight">
                          {item.name}
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </div>

              {/* 08-C: Material & Item Badges */}
              <div class="space-y-3 pt-2">
                <div class="flex items-center justify-between border-b border-base-300 pb-1.5">
                  <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                    資材・アイテムバッジ (&lt;MaterialIcon /&gt; / viewBox:
                    151x151)
                  </h3>
                  <span class="text-[11px] text-base-content/50 font-mono">
                    item_number: 1..79 (A0, B0, C0, D0, A3, B3, C3, C1...)
                  </span>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 text-xs">
                  <For
                    each={[
                      { id: 31, name: "燃料 (A0)" },
                      { id: 32, name: "弾薬 (B0)" },
                      { id: 33, name: "鋼材 (C0)" },
                      { id: 34, name: "ボーキ (D0)" },
                      { id: 1, name: "高速修復材 (A3)" },
                      { id: 2, name: "高速建造材 (B3)" },
                      { id: 3, name: "開発資材 (C3)" },
                      { id: 4, name: "改修資材 (C1)" },
                      { id: 44, name: "家具コイン (E0)" },
                      { id: 50, name: "応急修理要員 (E3)" },
                      { id: 51, name: "応急修理女神 (F3)" },
                      { id: 54, name: "給糧艦「間宮」 (D2)" },
                      { id: 57, name: "勲章 (B1)" },
                      { id: 61, name: "甲種勲章 (G1)" },
                      { id: 65, name: "試製カタパルト (B4)" },
                      { id: 66, name: "戦闘糧食 (E4)" },
                    ]}
                  >
                    {(item) => (
                      <div class="p-2.5 bg-base-200/50 rounded-lg border border-base-300 flex flex-col items-center gap-1.5 text-center">
                        <MaterialIcon item_number={item.id} size="sm" />
                        <span class="text-[11px] font-medium leading-tight">
                          {item.name}
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </div>

              {/* 08-D: Fleet Numbers, Kira, Proficiency & Status Alerts */}
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                <div class="space-y-3">
                  <div class="flex items-center justify-between border-b border-base-300 pb-1.5">
                    <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                      艦隊番号バッジ (&lt;FleetNumberIcon /&gt;)
                    </h3>
                    <span class="text-[11px] text-base-content/50 font-mono">
                      味方(#2D9C45) / 敵(#FF100C) • 2桁等幅数値表示
                    </span>
                  </div>
                  <div class="space-y-3 text-xs">
                    {/* 単艦隊 11-16 */}
                    <div>
                      <span class="text-[10px] text-base-content/60 font-semibold block mb-1">
                        味方第1艦隊 (11〜16: 艦隊1 ＋ 艦番1..6)
                      </span>
                      <div class="flex flex-wrap items-center gap-1.5">
                        <For each={[1, 2, 3, 4, 5, 6]}>
                          {(ship) => (
                            <div class="flex items-center gap-1 p-1.5 bg-base-200/50 rounded border border-base-300">
                              <FleetNumberIcon
                                e_flag={0}
                                fleet_number={1}
                                ship_number={ship}
                                size="xs"
                              />
                              <span class="text-[11px] font-mono">
                                {ship === 1 ? "旗艦" : `${ship}番艦`}
                              </span>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>

                    {/* 連合艦隊 第二艦隊 21-26 */}
                    <div>
                      <span class="text-[10px] text-base-content/60 font-semibold block mb-1">
                        連合艦隊 第二艦隊 (21〜26: combined_flag, ship_number:
                        7..12)
                      </span>
                      <div class="flex flex-wrap items-center gap-1.5">
                        <For each={[7, 8, 9, 10, 11, 12]}>
                          {(ship) => (
                            <div class="flex items-center gap-1 p-1.5 bg-base-200/50 rounded border border-base-300">
                              <FleetNumberIcon
                                e_flag={0}
                                fleet_number={1}
                                ship_number={ship}
                                combined_flag={true}
                                size="xs"
                              />
                              <span class="text-[11px] font-mono">
                                {ship === 7 ? "随伴旗艦" : `${ship - 6}番艦`}
                              </span>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>

                    {/* 敵艦隊 11-16 */}
                    <div>
                      <span class="text-[10px] text-error font-semibold block mb-1">
                        敵艦隊 (e_flag=1: 赤色下線・ハッチング)
                      </span>
                      <div class="flex flex-wrap items-center gap-1.5">
                        <For each={[1, 2, 3, 4, 5, 6]}>
                          {(ship) => (
                            <div class="flex items-center gap-1 p-1.5 bg-base-200/50 rounded border border-base-300">
                              <FleetNumberIcon
                                e_flag={1}
                                fleet_number={1}
                                ship_number={ship}
                                size="xs"
                              />
                              <span class="text-[11px] font-mono text-error">
                                {ship === 1 ? "敵旗艦" : `敵${ship}`}
                              </span>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="space-y-3">
                  <div class="flex items-center justify-between border-b border-base-300 pb-1.5">
                    <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                      キラ付け状態 (&lt;KiraIcon /&gt;)
                    </h3>
                    <span class="text-[11px] text-base-content/50 font-mono">
                      kira_type: 1, 2, 3
                    </span>
                  </div>
                  <div class="flex flex-wrap items-center gap-4">
                    <div class="flex items-center gap-2 p-2 bg-base-200/50 rounded border border-base-300">
                      <KiraIcon kira_type={1} size="sm" />
                      <span class="text-xs font-medium">1重キラ (単発)</span>
                    </div>
                    <div class="flex items-center gap-2 p-2 bg-base-200/50 rounded border border-base-300">
                      <KiraIcon kira_type={2} size="sm" />
                      <span class="text-xs font-medium">2重キラ (連鎖)</span>
                    </div>
                    <div class="flex items-center gap-2 p-2 bg-base-200/50 rounded border border-base-300">
                      <KiraIcon kira_type={3} size="sm" />
                      <span class="text-xs font-medium text-yellow-500 font-bold">
                        3重キラ (戦意高揚 MAX)
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 08-E: Plane Proficiency & Warning Badges */}
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                <div class="space-y-3">
                  <div class="flex items-center justify-between border-b border-base-300 pb-1.5">
                    <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                      艦載機熟練度 (&lt;PlaneProficiencyIcon /&gt;)
                    </h3>
                    <span class="text-[11px] text-base-content/50 font-mono">
                      level: 1..7 (青スラッシュ / 金シェブロン)
                    </span>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <For each={[1, 2, 3, 4, 5, 6, 7]}>
                      {(lvl) => (
                        <div class="p-2 bg-base-200/50 rounded border border-base-300 flex items-center gap-1.5">
                          <PlaneProficiencyIcon level={lvl} size="xs" />
                          <span class="text-xs font-mono font-semibold">
                            Lv.{lvl}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </div>

                <div class="space-y-3">
                  <div class="flex items-center justify-between border-b border-base-300 pb-1.5">
                    <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                      注意・エラー表示 (&lt;CautionFillIcon /&gt;, &lt;ErrorIcon
                      /&gt;)
                    </h3>
                    <span class="text-[11px] text-base-content/50 font-mono">
                      levels: low, middle, high
                    </span>
                  </div>
                  <div class="flex flex-wrap items-center gap-3">
                    <div class="flex items-center gap-1.5 p-2 bg-base-200/50 rounded border border-base-300">
                      <CautionFillIcon level="low" size="xs" />
                      <span class="text-xs">Caution (Low)</span>
                    </div>
                    <div class="flex items-center gap-1.5 p-2 bg-base-200/50 rounded border border-base-300">
                      <CautionFillIcon level="middle" size="xs" />
                      <span class="text-xs text-orange-500 font-medium">
                        Caution (Mid)
                      </span>
                    </div>
                    <div class="flex items-center gap-1.5 p-2 bg-base-200/50 rounded border border-base-300">
                      <CautionFillIcon level="high" size="xs" />
                      <span class="text-xs text-red-500 font-bold">
                        Caution (High)
                      </span>
                    </div>
                    <div class="flex items-center gap-1.5 p-2 bg-base-200/50 rounded border border-base-300">
                      <ErrorIcon size="xs" />
                      <span class="text-xs text-error font-bold">
                        ErrorIcon
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 08-F: Icon Size Scale */}
              <div class="space-y-2 pt-2 border-t border-base-300/40">
                <div class="text-xs font-semibold uppercase tracking-wider text-base-content/60">
                  サイズスケール共通プロパティ (size prop)
                </div>
                <div class="flex flex-wrap items-end gap-6 p-4 bg-base-200/30 rounded-lg border border-base-300">
                  <div class="flex flex-col items-center gap-1">
                    <ShipIcon ship_stype={8} size="xs" />
                    <span class="text-[10px] font-mono text-base-content/60">
                      xs (24px)
                    </span>
                  </div>
                  <div class="flex flex-col items-center gap-1">
                    <ShipIcon ship_stype={8} size="sm" />
                    <span class="text-[10px] font-mono text-base-content/60">
                      sm (27px)
                    </span>
                  </div>
                  <div class="flex flex-col items-center gap-1">
                    <ShipIcon ship_stype={8} size="md" />
                    <span class="text-[10px] font-mono text-base-content/60">
                      md (30px)
                    </span>
                  </div>
                  <div class="flex flex-col items-center gap-1">
                    <ShipIcon ship_stype={8} size="lg" />
                    <span class="text-[10px] font-mono text-base-content/60">
                      lg (35px)
                    </span>
                  </div>
                  <div class="flex flex-col items-center gap-1">
                    <ShipIcon ship_stype={8} size="xl" />
                    <span class="text-[10px] font-mono text-base-content/60">
                      xl (44px)
                    </span>
                  </div>
                </div>
              </div>

              {/* 08-G: Unified Empty / None Placeholders */}
              <div class="space-y-3 pt-2 border-t border-base-300/40">
                <div class="flex items-center justify-between">
                  <div class="text-xs font-semibold uppercase tracking-wider text-base-content/60">
                    Empty / None 共通プレースホルダー (&lt;EmptyValue /&gt;
                    &amp; &lt;EmptySlot /&gt;)
                  </div>
                  <span class="text-[11px] text-base-content/50 font-mono">
                    src/components/ui/components/empty/empty.tsx
                  </span>
                </div>
                <p class="text-xs text-base-content/60">
                  未ドロップ・非発動・欠損値を{" "}
                  <code class="font-mono">EmptySlot</code>（破線空枠 SVG
                  ＋固定幅ラベル）と <code class="font-mono">EmptyValue</code>
                  （共通 <code class="font-mono">—</code>{" "}
                  表示・固定幅確保）へ統一し、表示有無による横ズレを防ぎます。
                </p>
                <div class="flex flex-wrap items-center gap-6 p-4 bg-base-200/30 rounded-lg border border-base-300 text-xs">
                  <div class="flex items-center gap-2">
                    <span class="text-base-content/60">EmptyValue:</span>
                    <EmptyValue size="xs" widthClass="w-12" />
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-base-content/60">Empty Equip:</span>
                    <EmptySlot kind="equip" size="xs" />
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-base-content/60">Empty Ship (Drop):</span>
                    <div class="w-28 shrink-0 flex items-center">
                      <EmptySlot
                        kind="ship"
                        size="xs"
                        showLabel={true}
                        labelWidthClass="flex-1"
                        widthClass="w-full"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 09 / SHIP & EQUIPMENT SLOT MODALS */}
        <section id="section-modals" class="space-y-4 pt-2">
          <div class="border-b border-base-300 pb-2">
            <h2 class="text-xl font-bold tracking-tight">
              09 / Ship &amp; Equipment Slot Modals
            </h2>
            <p class="text-xs text-base-content/60 mt-0.5">
              実戦で利用される艦船・装備・深海敵艦の生体モーダルおよびダイアログ展開仕様。
            </p>
          </div>

          <div class="bg-base-100 rounded-box border border-base-300 p-5 space-y-6">
            {/* 09-A: Ship Modals */}
            <div class="space-y-3">
              <div class="flex items-center justify-between border-b border-base-300 pb-1.5">
                <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                  艦船スロットモーダル (&lt;ComponentShipModal /&gt; /
                  クリックで艦船諸元表を展開)
                </h3>
                <span class="text-[11px] text-base-content/50 font-mono">
                  &lt;dialog class="modal"&gt; • ComponentShipTable
                </span>
              </div>
              <p class="text-xs text-base-content/60">
                クリックするとネイティブ
                HTMLDialogElement（モーダル）が開き、装備スロット（S1〜S5＋SE）と耐久・火力・装甲・雷装等の12諸元パラメータを表示します。
              </p>
              <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <div class="p-3 bg-base-200/50 rounded-lg border border-base-300">
                  <span class="text-[10px] text-base-content/50 block mb-1">
                    軽巡洋艦（矢矧改二乙 Lv.132・4スロット＋補強増設）:
                  </span>
                  <div class="w-full py-1">
                    <ComponentShipModal
                      size="sm"
                      name_flag={true}
                      ship={mockYahagiShip}
                      mst_ship={mockYahagiMstShip}
                      slot_items={mockSlotItems}
                      mst_slot_items={mockMstSlotItems}
                    />
                  </div>
                </div>

                <div class="p-3 bg-base-200/50 rounded-lg border border-base-300">
                  <span class="text-[10px] text-base-content/50 block mb-1">
                    駆逐艦（Fletcher Kai Mod.2 Lv.99・3スロット＋補強増設）:
                  </span>
                  <div class="w-full py-1">
                    <ComponentShipModal
                      size="sm"
                      name_flag={true}
                      ship={mockFletcherShip}
                      mst_ship={mockFletcherMstShip}
                      slot_items={mockSlotItems}
                      mst_slot_items={mockMstSlotItems}
                    />
                  </div>
                </div>

                <div class="p-3 bg-base-200/50 rounded-lg border border-base-300">
                  <span class="text-[10px] text-base-content/50 block mb-1">
                    空きスロット（empty_flag: true）:
                  </span>
                  <div class="w-full py-1">
                    <ComponentShipModal size="sm" empty_flag={true} />
                  </div>
                </div>
              </div>
            </div>

            {/* 09-B: Equipment Modals */}
            <div class="space-y-3 pt-2">
              <div class="flex items-center justify-between border-b border-base-300 pb-1.5">
                <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                  装備スロットモーダル (&lt;ComponentEquipmentModal /&gt; /
                  クリックで装備諸元表を展開)
                </h3>
                <span class="text-[11px] text-base-content/50 font-mono">
                  &lt;dialog class="modal"&gt; • ComponentEquipmentTable
                </span>
              </div>
              <p class="text-xs text-base-content/60">
                改修値（★+n）、機数（onslot）、艦載機熟練度（IconPlaneProficiency
                Lv.1〜7）をバッジインジケーターとして統合表示。クリックで装備詳細が開きます。
              </p>
              <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div class="p-3 bg-base-200/50 rounded-lg border border-base-300">
                  <span class="text-[10px] text-base-content/50 block mb-1">
                    主砲・改修★+6（Bofors 15.2cm連装砲）:
                  </span>
                  <div class="py-1">
                    <ComponentEquipmentModal
                      size="xs"
                      name_flag={true}
                      slot_item={mockSlotItemsDict[7355]}
                      mst_slot_item={mockMstSlotItemsDict[303]}
                    />
                  </div>
                </div>

                <div class="p-3 bg-base-200/50 rounded-lg border border-base-300">
                  <span class="text-[10px] text-base-content/50 block mb-1">
                    水上偵察機・熟練Lv.7★max（零式水偵11型乙）:
                  </span>
                  <div class="py-1">
                    <ComponentEquipmentModal
                      size="xs"
                      name_flag={true}
                      attr_onslot={2}
                      slot_item={mockSlotItemsDict[8735]}
                      mst_slot_item={mockMstSlotItemsDict[110]}
                    />
                  </div>
                </div>

                <div class="p-3 bg-base-200/50 rounded-lg border border-base-300">
                  <span class="text-[10px] text-base-content/50 block mb-1">
                    特殊兵装（甲標的 丙型）:
                  </span>
                  <div class="py-1">
                    <ComponentEquipmentModal
                      size="xs"
                      name_flag={true}
                      slot_item={mockSlotItemsDict[3006]}
                      mst_slot_item={mockMstSlotItemsDict[384]}
                    />
                  </div>
                </div>

                <div class="p-3 bg-base-200/50 rounded-lg border border-base-300">
                  <span class="text-[10px] text-base-content/50 block mb-1">
                    補強増設スロット（ex_flag: true・熟練見張員★+4）:
                  </span>
                  <div class="py-1">
                    <ComponentEquipmentModal
                      size="xs"
                      name_flag={true}
                      ex_flag={true}
                      slot_item={mockSlotItemsDict[6865]}
                      mst_slot_item={mockMstSlotItemsDict[129]}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 09-C: Masked Ship Modals (Enemy / Abyssal) */}
            <div class="space-y-3 pt-2">
              <div class="flex items-center justify-between border-b border-base-300 pb-1.5">
                <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                  敵艦・深海棲艦マスクモーダル (&lt;ComponentShipMaskedModal
                  /&gt;)
                </h3>
                <span class="text-[11px] text-base-content/50 font-mono">
                  ComponentShipMaskedTable • 非公開諸元（回避・索敵等）は
                  unknown マスク
                </span>
              </div>
              <p class="text-xs text-base-content/60">
                戦闘で交戦する敵艦および友軍艦隊の艦船。耐久・火力・装甲・雷装・対空のみ実数値が表示され、回避・速力・運などは「unknown」として秘匿されます。
              </p>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div class="p-3 bg-base-200/50 rounded-lg border border-base-300">
                  <span class="text-[10px] text-yellow-500 font-semibold block mb-1">
                    深海戦艦（戦艦ル級改 flag ship・耐久130・金色下線）:
                  </span>
                  <div class="w-full py-1">
                    <ComponentShipMaskedModal
                      size="sm"
                      name_flag={true}
                      color="flagship"
                      ship_max_hp={130}
                      ship_param={[118, 0, 88, 130]}
                      ship_slot={[505, 505, 506, 507, 0]}
                      mst_ship={mockEnemyRuMstShip}
                      mst_slot_items={mockMstSlotItems}
                    />
                  </div>
                </div>

                <div class="p-3 bg-base-200/50 rounded-lg border border-base-300">
                  <span class="text-[10px] text-orange-500 font-semibold block mb-1">
                    深海駆逐艦（駆逐イ級 elite・耐久38・橙色下線）:
                  </span>
                  <div class="w-full py-1">
                    <ComponentShipMaskedModal
                      size="sm"
                      name_flag={true}
                      color="elite"
                      ship_max_hp={38}
                      ship_param={[48, 72, 30, 32]}
                      ship_slot={[501, 514, 0, 0, 0]}
                      mst_ship={mockEnemyIClassMstShip}
                      mst_slot_items={mockMstSlotItems}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 10 / FLEET & DECK LAYOUT */}
        <section id="section-deck" class="space-y-4 pt-2">
          <div class="border-b border-base-300 pb-2">
            <h2 class="text-xl font-bold tracking-tight">
              10 / Fleet &amp; Deck Layout (&lt;DeckComponent /&gt;)
            </h2>
            <p class="text-xs text-base-content/60 mt-0.5">
              実際の母港・編成画面における11カラム構成の艦隊スロットテーブル生体仕様。
            </p>
          </div>

          <div class="bg-base-100 rounded-box border border-base-300 p-5 space-y-4">
            <p class="text-xs text-base-content/60">
              各艦列は
              <code class="font-mono bg-base-300 px-1 rounded">
                [艦船モーダル] | [Condバッジ＋キラ/疲労アイコン] |
                [HPゲージ＋ラベル] | [燃料・弾薬バー] | [5連装装備スロット] |
                [補強増設]
              </code>{" "}
              の順に横並び配置され、未開放スロットは 45°
              のハッチングパターンで表現されます。
            </p>

            {/* Live DeckComponent Table Specimen */}
            <div class="border border-base-300 rounded-box overflow-x-auto bg-base-100">
              <ul class="menu menu-xs bg-base-100 w-full pl-0 flex pt-0">
                <li>
                  <details open>
                    <summary class="flex">
                      <div class="w-20 flex-none">Fleet 1</div>
                      <div class="w-4 flex-none -mx-4">
                        <IconChevronRightS class="h-4 w-4" />
                      </div>
                      <div class="pl-4">第一艦隊</div>
                      <span class="flex-auto" />
                    </summary>
                    <ul class="pl-0">
                      {/* Row 1: Yahagi Kai Ni B (Healthy, Sparkling, 4 Slots + SE) */}
                      <li class="h-auto">
                        <a class="justify-start gap-x-0 gap-y-1 flex flex-wrap">
                          <div class="justify-start gap-0 flex">
                            <div class="pl-2 pr-0.5 truncate flex-1 min-w-12 content-center">
                              <div class="w-[106px] h-max">
                                <ComponentShipModal
                                  size="xs"
                                  name_flag={true}
                                  ship={mockYahagiShip}
                                  mst_ship={mockYahagiMstShip}
                                  slot_items={mockSlotItems}
                                  mst_slot_items={mockMstSlotItems}
                                />
                              </div>
                            </div>
                            <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                            <div class="flex-none">
                              <div class="flex justify-center w-8 indicator">
                                <div class="indicator-item indicator-top indicator-end">
                                  <div class="size-4">
                                    <IconKira size="full" kira_type={3} />
                                  </div>
                                </div>
                                <div class="badge badge-md border-base-300 w-9">
                                  75
                                </div>
                              </div>
                            </div>
                            <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                            <div class="indicator">
                              <div class="indicator-item indicator-top indicator-end space-x-2" />
                              <div class="w-16 text-xs">
                                <ComponentColorBarLabel
                                  v_now={55}
                                  v_max={60}
                                  size="xs"
                                />
                              </div>
                            </div>
                            <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                            <div class="indicator">
                              <div class="flex-none my-auto">
                                <div class="indicator-item indicator-top indicator-end space-x-2" />
                                <div class="grid w-8 place-content-center space-y-1">
                                  <div class="w-8 text-xs">
                                    <ComponentColorBar
                                      v_now={45}
                                      v_max={45}
                                      size="xs"
                                    />
                                  </div>
                                  <div class="w-8 text-xs">
                                    <ComponentColorBar
                                      v_now={50}
                                      v_max={50}
                                      size="xs"
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div class="divider divider-horizontal mr-0 ml-0" />
                            <div class="w-[4px]" />
                            <div class="grid grid-cols-5 gap-2 content-center w-60">
                              <div class="text-base flex justify-center">
                                <ComponentEquipmentModal
                                  size="xs"
                                  name_flag={false}
                                  slot_item={mockSlotItemsDict[7355]}
                                  mst_slot_item={mockMstSlotItemsDict[303]}
                                />
                              </div>
                              <div class="text-base flex justify-center">
                                <ComponentEquipmentModal
                                  size="xs"
                                  name_flag={false}
                                  slot_item={mockSlotItemsDict[7571]}
                                  mst_slot_item={mockMstSlotItemsDict[303]}
                                />
                              </div>
                              <div class="text-base flex justify-center">
                                <ComponentEquipmentModal
                                  size="xs"
                                  name_flag={false}
                                  attr_onslot={2}
                                  slot_item={mockSlotItemsDict[8735]}
                                  mst_slot_item={mockMstSlotItemsDict[110]}
                                />
                              </div>
                              <div class="text-base flex justify-center">
                                <ComponentEquipmentModal
                                  size="xs"
                                  name_flag={false}
                                  slot_item={mockSlotItemsDict[3006]}
                                  mst_slot_item={mockMstSlotItemsDict[384]}
                                />
                              </div>
                              <div class="rounded back_slash_color bg-[size:16px_16px] bg-top-left bg-[image:repeating-linear-gradient(45deg,currentColor_0,currentColor_0.5px,transparent_0,transparent_50%)]" />
                            </div>
                            <div class="divider divider-horizontal mr-0 ml-0" />
                            <div class="content-center">
                              <div class="text-base flex justify-center w-8">
                                <ComponentEquipmentModal
                                  size="xs"
                                  name_flag={false}
                                  ex_flag={true}
                                  slot_item={mockSlotItemsDict[6865]}
                                  mst_slot_item={mockMstSlotItemsDict[129]}
                                />
                              </div>
                            </div>
                          </div>
                        </a>
                      </li>

                      {/* Row 2: Fletcher Kai Mod.2 (100% Healthy, 1-Layer Kira, 3 Slots + 2 Locked) */}
                      <li class="h-auto">
                        <a class="justify-start gap-x-0 gap-y-1 flex flex-wrap">
                          <div class="justify-start gap-0 flex">
                            <div class="pl-2 pr-0.5 truncate flex-1 min-w-12 content-center">
                              <div class="w-[106px] h-max">
                                <ComponentShipModal
                                  size="xs"
                                  name_flag={true}
                                  ship={mockFletcherShip}
                                  mst_ship={mockFletcherMstShip}
                                  slot_items={mockSlotItems}
                                  mst_slot_items={mockMstSlotItems}
                                />
                              </div>
                            </div>
                            <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                            <div class="flex-none">
                              <div class="flex justify-center w-8 indicator">
                                <div class="indicator-item indicator-top indicator-end">
                                  <div class="size-4">
                                    <IconKira size="full" kira_type={1} />
                                  </div>
                                </div>
                                <div class="badge badge-md border-base-300 w-9">
                                  53
                                </div>
                              </div>
                            </div>
                            <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                            <div class="indicator">
                              <div class="indicator-item indicator-top indicator-end space-x-2" />
                              <div class="w-16 text-xs">
                                <ComponentColorBarLabel
                                  v_now={37}
                                  v_max={37}
                                  size="xs"
                                />
                              </div>
                            </div>
                            <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                            <div class="indicator">
                              <div class="flex-none my-auto">
                                <div class="indicator-item indicator-top indicator-end space-x-2" />
                                <div class="grid w-8 place-content-center space-y-1">
                                  <div class="w-8 text-xs">
                                    <ComponentColorBar
                                      v_now={15}
                                      v_max={15}
                                      size="xs"
                                    />
                                  </div>
                                  <div class="w-8 text-xs">
                                    <ComponentColorBar
                                      v_now={20}
                                      v_max={20}
                                      size="xs"
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div class="divider divider-horizontal mr-0 ml-0" />
                            <div class="w-[4px]" />
                            <div class="grid grid-cols-5 gap-2 content-center w-60">
                              <div class="text-base flex justify-center">
                                <ComponentEquipmentModal
                                  size="xs"
                                  name_flag={false}
                                  slot_item={mockSlotItemsDict[7355]}
                                  mst_slot_item={mockMstSlotItemsDict[303]}
                                />
                              </div>
                              <div class="text-base flex justify-center">
                                <ComponentEquipmentModal
                                  size="xs"
                                  name_flag={false}
                                  slot_item={mockSlotItemsDict[7571]}
                                  mst_slot_item={mockMstSlotItemsDict[303]}
                                />
                              </div>
                              <div class="text-base flex justify-center">
                                <ComponentEquipmentModal
                                  size="xs"
                                  name_flag={false}
                                  slot_item={mockSlotItemsDict[3006]}
                                  mst_slot_item={mockMstSlotItemsDict[384]}
                                />
                              </div>
                              <div class="rounded h-6 back_slash_color bg-[size:16px_16px] bg-top-left bg-[image:repeating-linear-gradient(45deg,currentColor_0,currentColor_0.5px,transparent_0,transparent_50%)]" />
                              <div class="rounded back_slash_color bg-[size:16px_16px] bg-top-left bg-[image:repeating-linear-gradient(45deg,currentColor_0,currentColor_0.5px,transparent_0,transparent_50%)]" />
                            </div>
                            <div class="divider divider-horizontal mr-0 ml-0" />
                            <div class="content-center">
                              <div class="text-base flex justify-center w-8">
                                <ComponentEquipmentModal
                                  size="xs"
                                  name_flag={false}
                                  ex_flag={true}
                                  slot_item={mockSlotItemsDict[6865]}
                                  mst_slot_item={mockMstSlotItemsDict[129]}
                                />
                              </div>
                            </div>
                          </div>
                        </a>
                      </li>

                      {/* Row 3: Damaged Ship (Cond Middle Alert, Red HP, Resupply Warning) */}
                      <li class="h-auto">
                        <a class="justify-start gap-x-0 gap-y-1 flex flex-wrap">
                          <div class="justify-start gap-0 flex">
                            <div class="pl-2 pr-0.5 truncate flex-1 min-w-12 content-center">
                              <div class="w-[106px] h-max">
                                <ComponentShipModal
                                  size="xs"
                                  name_flag={true}
                                  ship={mockDamagedShip}
                                  mst_ship={mockDamagedMstShip}
                                  slot_items={mockSlotItems}
                                  mst_slot_items={mockMstSlotItems}
                                />
                              </div>
                            </div>
                            <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                            <div class="flex-none">
                              <div class="flex justify-center w-8 indicator">
                                <div class="indicator-item indicator-top indicator-end">
                                  <div class="size-4">
                                    <IconCautionFill
                                      level="middle"
                                      size="full"
                                    />
                                  </div>
                                </div>
                                <div class="badge badge-md border-base-300 w-9">
                                  28
                                </div>
                              </div>
                            </div>
                            <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                            <div class="indicator">
                              <div class="indicator-item indicator-top indicator-end space-x-2">
                                <div class="size-4">
                                  <IconCautionFill level="high" size="full" />
                                </div>
                              </div>
                              <div class="w-16 text-xs">
                                <ComponentColorBarLabel
                                  v_now={7}
                                  v_max={36}
                                  size="xs"
                                />
                              </div>
                            </div>
                            <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                            <div class="indicator">
                              <div class="flex-none my-auto">
                                <div class="indicator-item indicator-top indicator-end space-x-2">
                                  <div class="size-4">
                                    <IconCautionFill
                                      level="middle"
                                      size="full"
                                    />
                                  </div>
                                </div>
                                <div class="grid w-8 place-content-center space-y-1">
                                  <div class="w-8 text-xs">
                                    <ComponentColorBar
                                      v_now={4}
                                      v_max={15}
                                      size="xs"
                                    />
                                  </div>
                                  <div class="w-8 text-xs">
                                    <ComponentColorBar
                                      v_now={6}
                                      v_max={20}
                                      size="xs"
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div class="divider divider-horizontal mr-0 ml-0" />
                            <div class="w-[4px]" />
                            <div class="grid grid-cols-5 gap-2 content-center w-60">
                              <div class="text-base flex justify-center">
                                <ComponentEquipmentModal
                                  size="xs"
                                  name_flag={false}
                                  slot_item={mockSlotItemsDict[7355]}
                                  mst_slot_item={mockMstSlotItemsDict[303]}
                                />
                              </div>
                              <div class="text-base flex justify-center">
                                <ComponentEquipmentModal
                                  size="xs"
                                  name_flag={false}
                                  slot_item={mockSlotItemsDict[7571]}
                                  mst_slot_item={mockMstSlotItemsDict[303]}
                                />
                              </div>
                              <div class="text-base flex justify-center">
                                <ComponentEquipmentModal
                                  size="xs"
                                  empty_flag={true}
                                />
                              </div>
                              <div class="rounded back_slash_color bg-[size:16px_16px] bg-top-left bg-[image:repeating-linear-gradient(45deg,currentColor_0,currentColor_0.5px,transparent_0,transparent_50%)]" />
                              <div class="rounded back_slash_color bg-[size:16px_16px] bg-top-left bg-[image:repeating-linear-gradient(45deg,currentColor_0,currentColor_0.5px,transparent_0,transparent_50%)]" />
                            </div>
                            <div class="divider divider-horizontal mr-0 ml-0" />
                            <div class="content-center back_slash_color bg-[size:16px_16px] bg-top-left bg-[image:repeating-linear-gradient(45deg,currentColor_0,currentColor_0.5px,transparent_0,transparent_50%)]">
                              <div class="text-base flex justify-center w-8" />
                            </div>
                          </div>
                        </a>
                      </li>
                    </ul>
                  </details>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* 11 / COMBAT SYSTEMS & BATTLE SUMMARY */}
        <section id="section-battles" class="space-y-4 pt-2">
          <div class="border-b border-base-300 pb-2">
            <h2 class="text-xl font-bold tracking-tight">
              11 / Combat Systems &amp; Battle Summary
            </h2>
            <p class="text-xs text-base-content/60 mt-0.5">
              戦闘結果サマリー、陣形判定、航空戦ヘッダーおよびダメージ計算の生体仕様。
            </p>
          </div>

          <div class="bg-base-100 rounded-box border border-base-300 p-5 space-y-6">
            {/* Part 1: Battle Summary Six-Column Table */}
            <div class="space-y-3">
              <div class="flex items-center justify-between border-b border-base-300 pb-1.5">
                <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                  戦闘結果サマリー生体表示 (&lt;BattleSummaryComponent /&gt;)
                </h3>
                <span class="text-[11px] text-base-content/50 font-mono">
                  &lt;table class="table table-xs"&gt; • 6カラム (Own Main / HP
                  / Damage / Enemy Main / HP / Damage)
                </span>
              </div>
              <p class="text-xs text-base-content/60">
                戦闘終了後に味方・敵艦の被ダメージおよび残存HPを一覧する統合6列テーブル。味方は
                ComponentShipModal、敵側は ComponentShipMaskedModal
                で描画され、艦隊番号バッジ（IconFleetNumber）が各列先頭に付与されます。
              </p>

              <div class="border border-base-300 rounded-box overflow-x-auto bg-base-100">
                <ul class="menu menu-xs bg-base-100 w-full pl-0 flex pt-0">
                  <li>
                    <details open={true}>
                      <summary class="flex">
                        Battles
                        <IconChevronRightS class="h-4 w-4" />
                        <div>Map : 5-5</div>
                        <span class="flex-auto" />
                      </summary>
                      <ul class="pl-0">
                        <div class="flex flex-row pl-2 items-center">
                          <div class="h-4 mt-px pt-px text-xs">cells</div>
                          <IconChevronRightS class="h-4 w-4 m-1" />
                          <button class="btn btn-xs btn-square">A</button>
                          <div class="divider divider-horizontal mr-0 ml-0" />
                          <button class="btn btn-xs btn-square">E</button>
                          <div class="divider divider-horizontal mr-0 ml-0" />
                          <button class="btn btn-xs btn-square btn-active">
                            G
                          </button>
                        </div>
                        <div class="flex flex-nowrap text-xs py-0.5 pl-2">
                          Search : <span class="w-1" />
                          <div class="text-lime-500">
                            Enemy in sight; Accuracy &amp; Evacuation Up
                          </div>
                        </div>
                        <div class="flex flex-nowrap text-xs py-0.5 pl-2 items-center">
                          <FormationComponent formation={[1, 1]} />
                          <div class="divider divider-horizontal mr-0 ml-0" />
                          <div class="inline-flex items-center shrink-0">
                            <span>Form :</span>
                            <span class="w-1" />
                            <div class="w-48 shrink-0 flex items-center truncate">
                              <div class="text-lime-500 truncate">
                                Crossing the T (Advantage)
                              </div>
                            </div>
                          </div>
                        </div>
                        <div class="flex flex-nowrap text-xs py-0.5 pl-2 items-center">
                          <div class="inline-flex items-center shrink-0">
                            <span>Smoke Type :</span>
                            <span class="w-1" />
                            <div class="w-14 shrink-0 flex items-center justify-center">
                              <EmptyValue widthClass="w-full" align="center" />
                            </div>
                          </div>
                          <div class="divider divider-horizontal mr-0 ml-0" />
                          <div class="inline-flex items-center shrink-0">
                            <span>Combat Ration :</span>
                            <span class="w-1" />
                            <div class="w-14 shrink-0 flex items-center justify-center">
                              <EmptySlot
                                kind="equip"
                                size="xs"
                                label="No combat ration"
                              />
                            </div>
                          </div>
                          <div class="divider divider-horizontal mr-0 ml-0" />
                          <div class="inline-flex items-center shrink-0">
                            <span>Balloon :</span>
                            <span class="w-1" />
                            <div class="w-14 shrink-0 flex items-center justify-center">
                              <span class="text-lime-500">launched</span>
                            </div>
                          </div>
                        </div>
                      </ul>
                      <ul class="pl-0">
                        <li>
                          <details open={true}>
                            <summary>Summary</summary>
                            <ul class="pl-0">
                              <table class="table table-xs">
                                <thead>
                                  <tr>
                                    <th class="w-2/10">Own Main</th>
                                    <th class="w-2/10">HP</th>
                                    <th class="w-1/10">Damage</th>
                                    <th class="w-2/10">Enemy Main</th>
                                    <th class="w-2/10">HP</th>
                                    <th class="w-1/10">Damage</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr class="rounded">
                                    <td>
                                      <div class="flex flex-nowrap items-center">
                                        <FleetNumberIcon
                                          e_flag={0}
                                          fleet_number={1}
                                          ship_number={1}
                                          combined_flag={false}
                                          size="xs"
                                        />
                                        <ComponentShipModal
                                          size="xs"
                                          name_flag={true}
                                          ship={mockYahagiShip}
                                          mst_ship={mockYahagiMstShip}
                                          slot_items={mockSlotItems}
                                          mst_slot_items={mockMstSlotItems}
                                        />
                                      </div>
                                    </td>
                                    <td>
                                      <div class="flex-none">
                                        <ComponentColorBarLabel
                                          size="xs"
                                          v_now={55}
                                          v_max={60}
                                        />
                                      </div>
                                    </td>
                                    <td class="my-auto text-sm">0</td>
                                    <td>
                                      <div class="flex flex-nowrap items-center">
                                        <FleetNumberIcon
                                          e_flag={1}
                                          fleet_number={1}
                                          ship_number={1}
                                          combined_flag={false}
                                          size="xs"
                                        />
                                        <ComponentShipMaskedModal
                                          size="xs"
                                          name_flag={true}
                                          color="flagship"
                                          ship_max_hp={130}
                                          ship_param={[118, 0, 88, 130]}
                                          ship_slot={[505, 505, 506, 507, 0]}
                                          mst_ship={mockEnemyRuMstShip}
                                          mst_slot_items={mockMstSlotItems}
                                        />
                                      </div>
                                    </td>
                                    <td>
                                      <div class="flex-none">
                                        <ComponentColorBarLabel
                                          size="xs"
                                          v_now={0}
                                          v_max={130}
                                        />
                                      </div>
                                    </td>
                                    <td class="my-auto text-sm">130</td>
                                  </tr>

                                  <tr class="rounded">
                                    <td>
                                      <div class="flex flex-nowrap items-center">
                                        <FleetNumberIcon
                                          e_flag={0}
                                          fleet_number={1}
                                          ship_number={2}
                                          combined_flag={false}
                                          size="xs"
                                        />
                                        <ComponentShipModal
                                          size="xs"
                                          name_flag={true}
                                          ship={mockFletcherShip}
                                          mst_ship={mockFletcherMstShip}
                                          slot_items={mockSlotItems}
                                          mst_slot_items={mockMstSlotItems}
                                        />
                                      </div>
                                    </td>
                                    <td>
                                      <div class="flex-none">
                                        <ComponentColorBarLabel
                                          size="xs"
                                          v_now={37}
                                          v_max={37}
                                        />
                                      </div>
                                    </td>
                                    <td class="my-auto text-sm">0</td>
                                    <td>
                                      <div class="flex flex-nowrap items-center">
                                        <FleetNumberIcon
                                          e_flag={1}
                                          fleet_number={1}
                                          ship_number={2}
                                          combined_flag={false}
                                          size="xs"
                                        />
                                        <ComponentShipMaskedModal
                                          size="xs"
                                          name_flag={true}
                                          color="flagship"
                                          ship_max_hp={96}
                                          ship_param={[0, 0, 96, 80]}
                                          ship_slot={[505, 506, 0, 0, 0]}
                                          mst_ship={mockEnemyWoMstShip}
                                          mst_slot_items={mockMstSlotItems}
                                        />
                                      </div>
                                    </td>
                                    <td>
                                      <div class="flex-none">
                                        <ComponentColorBarLabel
                                          size="xs"
                                          v_now={24}
                                          v_max={96}
                                        />
                                      </div>
                                    </td>
                                    <td class="my-auto text-sm">72</td>
                                  </tr>

                                  <tr class="rounded">
                                    <td>
                                      <div class="flex flex-nowrap items-center">
                                        <FleetNumberIcon
                                          e_flag={0}
                                          fleet_number={1}
                                          ship_number={3}
                                          combined_flag={false}
                                          size="xs"
                                        />
                                        <ComponentShipModal
                                          size="xs"
                                          name_flag={true}
                                          ship={mockDamagedShip}
                                          mst_ship={mockDamagedMstShip}
                                          slot_items={mockSlotItems}
                                          mst_slot_items={mockMstSlotItems}
                                        />
                                      </div>
                                    </td>
                                    <td>
                                      <div class="flex-none">
                                        <ComponentColorBarLabel
                                          size="xs"
                                          v_now={7}
                                          v_max={36}
                                        />
                                      </div>
                                    </td>
                                    <td class="my-auto text-sm">29</td>
                                    <td>
                                      <div class="flex flex-nowrap items-center">
                                        <FleetNumberIcon
                                          e_flag={1}
                                          fleet_number={1}
                                          ship_number={3}
                                          combined_flag={false}
                                          size="xs"
                                        />
                                        <ComponentShipMaskedModal
                                          size="xs"
                                          name_flag={true}
                                          color="elite"
                                          ship_max_hp={38}
                                          ship_param={[48, 72, 30, 32]}
                                          ship_slot={[501, 514, 0, 0, 0]}
                                          mst_ship={mockEnemyIClassMstShip}
                                          mst_slot_items={mockMstSlotItems}
                                        />
                                      </div>
                                    </td>
                                    <td>
                                      <div class="flex-none">
                                        <ComponentColorBarLabel
                                          size="xs"
                                          v_now={0}
                                          v_max={38}
                                        />
                                      </div>
                                    </td>
                                    <td class="my-auto text-sm">38</td>
                                  </tr>
                                </tbody>
                              </table>
                            </ul>
                          </details>
                        </li>

                        {/* 11-A2: Air Base Air Attack (AirBaseAirAttackComponent) */}
                        <li>
                          <details open>
                            <summary>Air Base Air Attack</summary>
                            <ul class="pl-0">
                              <div class="flex flex-nowrap pl-2 items-center text-xs">
                                touch : <span class="w-1" />
                                <div class="w-6 flex justify-center">
                                  <div class="w-6 text-center">_</div>
                                </div>
                                <div class="w-3 text-center">/</div>
                                <div class="w-6 flex justify-center">
                                  <div class="w-6 text-center">_</div>
                                </div>
                                <div class="divider divider-horizontal mr-0 ml-0" />
                                <SpriteMotionCounts
                                  counts={{
                                    f_sprite_fly_count: 18,
                                    e_sprite_fly_count: 0,
                                    f_sprite_crash_count: 0,
                                    e_sprite_crash_count: 0,
                                    f_sprite_damage_count: 0,
                                    e_sprite_damage_count: 0,
                                    f_sprite_non_normal_count: 0,
                                    e_sprite_non_normal_count: 0,
                                  }}
                                />
                              </div>
                              <table class="table table-xs">
                                <thead>
                                  <tr>
                                    <th class="w-2/8">Attack</th>
                                    <th class="w-1/8">HP</th>
                                    <th class="w-2/8">Defense</th>
                                    <th class="w-1/8">HP</th>
                                    <th class="w-1/8">Damage</th>
                                    <th class="w-1/8" />
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr class="rounded">
                                    <td>
                                      <div class="flex flex-col">
                                        <ComponentEquipmentMstModal
                                          size="xs"
                                          compact={false}
                                          empty_flag={false}
                                          name_flag={true}
                                          show_name={true}
                                          show_param={true}
                                          mst_slot_item={
                                            mockMstSlotItemsDict[701]
                                          }
                                        />
                                        <div class="h-px" />
                                        <ComponentEquipmentMstModal
                                          size="xs"
                                          compact={false}
                                          empty_flag={false}
                                          name_flag={true}
                                          show_name={true}
                                          show_param={true}
                                          mst_slot_item={
                                            mockMstSlotItemsDict[702]
                                          }
                                        />
                                      </div>
                                    </td>
                                    <td />
                                    <td>
                                      <div class="flex flex-col">
                                        <div class="flex flex-nowrap items-center">
                                          <FleetNumberIcon
                                            e_flag={1}
                                            fleet_number={1}
                                            ship_number={1}
                                            combined_flag={false}
                                            size="xs"
                                          />
                                          <ComponentShipMaskedModal
                                            size="xs"
                                            name_flag={true}
                                            color="flagship"
                                            ship_max_hp={130}
                                            ship_param={[0, 0, 130, 90]}
                                            ship_slot={[505, 506, 0, 0, 0]}
                                            mst_ship={mockEnemyRuMstShip}
                                            mst_slot_items={mockMstSlotItems}
                                          />
                                        </div>
                                      </div>
                                    </td>
                                    <td>
                                      <div class="flex flex-col">
                                        <ComponentColorBarLabel
                                          size="xs"
                                          v_now={0}
                                          v_max={130}
                                        />
                                      </div>
                                    </td>
                                    <td>
                                      <div class="flex flex-col">
                                        <DamageCommonComponent
                                          dmg={130}
                                          critical_flag={2}
                                        />
                                      </div>
                                    </td>
                                    <td />
                                  </tr>
                                </tbody>
                              </table>
                            </ul>
                          </details>
                        </li>

                        {/* 11-A3: Opening Air Attack (OpeningAirAttackComponent) */}
                        <li>
                          <details open>
                            <summary>Opening Air Attack</summary>
                            <ul class="pl-0">
                              <div class="pl-2 text-xs flex flex-nowrap items-center">
                                <AirStateComponent air_state={0} />
                                <div class="divider divider-horizontal mr-0 ml-0" />
                                touch : <span class="w-1" />
                                <div class="w-6 flex justify-center">
                                  <div class="w-6 overflow-hidden">
                                    <ComponentEquipmentMstModal
                                      size="xs"
                                      compact={true}
                                      empty_flag={false}
                                      name_flag={false}
                                      show_name={true}
                                      show_param={true}
                                      mst_slot_item={mockMstSlotItemsDict[110]}
                                    />
                                  </div>
                                </div>
                                <div class="w-3 text-center">/</div>
                                <div class="w-6 flex justify-center">
                                  <div class="w-6 text-center">_</div>
                                </div>
                                <div class="divider divider-horizontal mr-0 ml-0" />
                                CI : <span class="w-1" />
                                <div class="flex justify-center">
                                  <div class="w-24">
                                    <ComponentShipModal
                                      size="xs"
                                      name_flag={true}
                                      ship={mockFletcherShip}
                                      mst_ship={mockFletcherMstShip}
                                      slot_items={mockSlotItems}
                                      mst_slot_items={mockMstSlotItems}
                                    />
                                  </div>
                                  <div class="w-1" />
                                  <div class="w-6 overflow-hidden">
                                    <ComponentEquipmentMstModal
                                      size="xs"
                                      compact={true}
                                      empty_flag={false}
                                      name_flag={false}
                                      show_name={true}
                                      show_param={true}
                                      mst_slot_item={mockMstSlotItemsDict[303]}
                                    />
                                  </div>
                                  <div class="w-1" />
                                  <div class="w-6 overflow-hidden">
                                    <ComponentEquipmentMstModal
                                      size="xs"
                                      compact={true}
                                      empty_flag={false}
                                      name_flag={false}
                                      show_name={true}
                                      show_param={true}
                                      mst_slot_item={mockMstSlotItemsDict[507]}
                                    />
                                  </div>
                                </div>
                                <div class="divider divider-horizontal mr-0 ml-0" />
                                <SpriteMotionCounts
                                  counts={{
                                    f_sprite_fly_count: 12,
                                    e_sprite_fly_count: 8,
                                    f_sprite_crash_count: 0,
                                    e_sprite_crash_count: 2,
                                    f_sprite_damage_count: 1,
                                    e_sprite_damage_count: 0,
                                    f_sprite_non_normal_count: 0,
                                    e_sprite_non_normal_count: 0,
                                  }}
                                />
                              </div>
                              <table class="table table-xs">
                                <thead>
                                  <tr>
                                    <th class="w-2/8">Attack</th>
                                    <th class="w-1/8">HP</th>
                                    <th class="w-2/8">Defense</th>
                                    <th class="w-1/8">HP</th>
                                    <th class="w-1/8">Damage</th>
                                    <th class="w-1/8" />
                                  </tr>
                                </thead>
                                <tbody>
                                  {/* Wave 1: Friendly Attack Wave */}
                                  <tr class="rounded">
                                    <td>
                                      <div class="flex flex-col">
                                        <div class="flex flex-nowrap items-center">
                                          <FleetNumberIcon
                                            e_flag={0}
                                            fleet_number={1}
                                            ship_number={1}
                                            combined_flag={false}
                                            size="xs"
                                          />
                                          <ComponentShipModal
                                            size="xs"
                                            name_flag={true}
                                            ship={mockYahagiShip}
                                            mst_ship={mockYahagiMstShip}
                                            slot_items={mockSlotItems}
                                            mst_slot_items={mockMstSlotItems}
                                          />
                                        </div>
                                      </div>
                                    </td>
                                    <td>
                                      <div class="flex flex-col">
                                        <ComponentColorBarLabel
                                          size="xs"
                                          v_now={55}
                                          v_max={60}
                                        />
                                      </div>
                                    </td>
                                    <td>
                                      <div class="flex flex-col">
                                        <div class="flex flex-nowrap items-center">
                                          <FleetNumberIcon
                                            e_flag={1}
                                            fleet_number={1}
                                            ship_number={2}
                                            combined_flag={false}
                                            size="xs"
                                          />
                                          <ComponentShipMaskedModal
                                            size="xs"
                                            name_flag={true}
                                            color="flagship"
                                            ship_max_hp={96}
                                            ship_param={[0, 0, 96, 80]}
                                            ship_slot={[505, 506, 0, 0, 0]}
                                            mst_ship={mockEnemyWoMstShip}
                                            mst_slot_items={mockMstSlotItems}
                                          />
                                        </div>
                                        <div class="h-px" />
                                        <div class="flex flex-nowrap items-center">
                                          <FleetNumberIcon
                                            e_flag={1}
                                            fleet_number={1}
                                            ship_number={3}
                                            combined_flag={false}
                                            size="xs"
                                          />
                                          <ComponentShipMaskedModal
                                            size="xs"
                                            name_flag={true}
                                            color="elite"
                                            ship_max_hp={38}
                                            ship_param={[48, 72, 30, 32]}
                                            ship_slot={[501, 514, 0, 0, 0]}
                                            mst_ship={mockEnemyIClassMstShip}
                                            mst_slot_items={mockMstSlotItems}
                                          />
                                          <IconShield class="h-4 self-center ml-auto" />
                                        </div>
                                      </div>
                                    </td>
                                    <td>
                                      <div class="flex flex-col">
                                        <ComponentColorBarLabel
                                          size="xs"
                                          v_now={24}
                                          v_max={96}
                                        />
                                        <div class="h-px" />
                                        <ComponentColorBarLabel
                                          size="xs"
                                          v_now={0}
                                          v_max={38}
                                        />
                                      </div>
                                    </td>
                                    <td>
                                      <div class="flex flex-col">
                                        <DamageCommonComponent
                                          dmg={72}
                                          critical_flag={1}
                                        />
                                        <div class="h-px" />
                                        <DamageCommonComponent
                                          dmg={38}
                                          critical_flag={2}
                                        />
                                      </div>
                                    </td>
                                    <td />
                                  </tr>

                                  {/* Wave 2: Enemy Air Attack Wave */}
                                  <tr class="rounded">
                                    <td>
                                      <div class="flex flex-col">
                                        <div class="flex flex-nowrap items-center">
                                          <FleetNumberIcon
                                            e_flag={1}
                                            fleet_number={1}
                                            ship_number={2}
                                            combined_flag={false}
                                            size="xs"
                                          />
                                          <ComponentShipMaskedModal
                                            size="xs"
                                            name_flag={true}
                                            color="flagship"
                                            ship_max_hp={96}
                                            ship_param={[0, 0, 96, 80]}
                                            ship_slot={[505, 506, 0, 0, 0]}
                                            mst_ship={mockEnemyWoMstShip}
                                            mst_slot_items={mockMstSlotItems}
                                          />
                                        </div>
                                      </div>
                                    </td>
                                    <td>
                                      <div class="flex flex-col">
                                        <ComponentColorBarLabel
                                          size="xs"
                                          v_now={24}
                                          v_max={96}
                                        />
                                      </div>
                                    </td>
                                    <td>
                                      <div class="flex flex-col">
                                        <div class="flex flex-nowrap items-center">
                                          <FleetNumberIcon
                                            e_flag={0}
                                            fleet_number={1}
                                            ship_number={2}
                                            combined_flag={false}
                                            size="xs"
                                          />
                                          <ComponentShipModal
                                            size="xs"
                                            name_flag={true}
                                            ship={mockFletcherShip}
                                            mst_ship={mockFletcherMstShip}
                                            slot_items={mockSlotItems}
                                            mst_slot_items={mockMstSlotItems}
                                          />
                                        </div>
                                      </div>
                                    </td>
                                    <td>
                                      <div class="flex flex-col">
                                        <ComponentColorBarLabel
                                          size="xs"
                                          v_now={37}
                                          v_max={37}
                                        />
                                      </div>
                                    </td>
                                    <td>
                                      <div class="flex flex-col">
                                        <DamageCommonComponent
                                          dmg={0}
                                          critical_flag={0}
                                        />
                                      </div>
                                    </td>
                                    <td />
                                  </tr>
                                </tbody>
                              </table>
                            </ul>
                          </details>
                        </li>
                      </ul>
                    </details>
                  </li>
                </ul>
              </div>
            </div>

            {/* Part 2: Combat Readouts & Air Warfare Line */}
            <div class="space-y-3 pt-2">
              <div class="flex items-center justify-between border-b border-base-300 pb-1.5">
                <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                  制空状態・陣形・ダメージ計算 (&lt;AirStateComponent /&gt;,
                  &lt;FormationComponent /&gt;, &lt;DamageCommonComponent /&gt;)
                </h3>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="p-3 bg-base-200/50 rounded-lg border border-base-300/60">
                  <div class="text-xs font-semibold mb-2">
                    制空権状態 (Air State : [Label])
                  </div>
                  <div class="space-y-1 text-xs font-mono">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-1.5">
                        <span class="text-base-content/60">0:</span>
                        <AirStateComponent air_state={0} />
                      </div>
                      <span class="text-[10px] text-base-content/50">
                        制空権確保
                      </span>
                    </div>
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-1.5">
                        <span class="text-base-content/60">1:</span>
                        <AirStateComponent air_state={1} />
                      </div>
                      <span class="text-[10px] text-base-content/50">
                        航空優勢
                      </span>
                    </div>
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-1.5">
                        <span class="text-base-content/60">2:</span>
                        <AirStateComponent air_state={2} />
                      </div>
                      <span class="text-[10px] text-base-content/50">
                        航空互角
                      </span>
                    </div>
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-1.5">
                        <span class="text-base-content/60">3:</span>
                        <AirStateComponent air_state={3} />
                      </div>
                      <span class="text-[10px] text-base-content/50">
                        航空劣勢
                      </span>
                    </div>
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-1.5">
                        <span class="text-base-content/60">4:</span>
                        <AirStateComponent air_state={4} />
                      </div>
                      <span class="text-[10px] text-base-content/50">
                        制空権喪失
                      </span>
                    </div>
                  </div>
                </div>

                <div class="p-3 bg-base-200/50 rounded-lg border border-base-300/60">
                  <div class="text-xs font-semibold mb-2">
                    交戦陣形 (Formation : [F] / [E])
                  </div>
                  <div class="space-y-1.5 text-xs">
                    <div class="flex items-center gap-1">
                      <FormationComponent formation={[1, 1]} />
                    </div>
                    <div class="flex items-center gap-1">
                      <FormationComponent formation={[6, 3]} />
                    </div>
                    <div class="flex items-center gap-1">
                      <FormationComponent formation={[14, 12]} />
                    </div>
                  </div>
                  <div class="text-[10px] text-base-content/50 mt-2 font-mono">
                    1: Line Ahead / 2: Double Line / 3: Diamond / 4: Echelon /
                    5: Line Abreast / 6: Vanguard / 11-14: Cruising formations
                  </div>
                </div>

                <div class="p-3 bg-base-200/50 rounded-lg border border-base-300/60">
                  <div class="text-xs font-semibold mb-2">
                    ダメージ値算出 (&lt;DamageCommonComponent /&gt;)
                  </div>
                  <div class="flex items-center gap-3 text-xs">
                    <div>
                      <span class="text-[10px] text-base-content/50 block">
                        Critical (cl=2)
                      </span>
                      <DamageCommonComponent dmg={284} critical_flag={2} />
                    </div>
                    <div>
                      <span class="text-[10px] text-base-content/50 block">
                        Normal (cl=1)
                      </span>
                      <DamageCommonComponent dmg={52} critical_flag={1} />
                    </div>
                    <div>
                      <span class="text-[10px] text-base-content/50 block">
                        Scratch / 0 (cl=0)
                      </span>
                      <DamageCommonComponent dmg={0} critical_flag={0} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Opening Air Attack Header Component Anatomy */}
              <div class="p-3 bg-base-200/40 rounded-lg border border-base-300 space-y-2">
                <div class="flex items-center justify-between">
                  <div class="text-[11px] font-semibold text-base-content/70 uppercase tracking-wider">
                    開幕航空戦ヘッダー実体仕様 (&lt;AirStateComponent /&gt; +
                    touch + CI + &lt;SpriteMotionCounts /&gt;)
                  </div>
                  <span class="text-[10px] text-base-content/50 font-mono">
                    opening_air_attack.tsx (L457-L465)
                  </span>
                </div>
                <div class="p-2.5 bg-base-300/40 rounded border border-base-300 flex flex-wrap items-center text-xs">
                  <AirStateComponent air_state={0} />
                  <div class="divider divider-horizontal mr-0 ml-0" />
                  <div class="inline-flex items-center shrink-0">
                    <span>touch :</span>
                    <span class="w-1" />
                    <div class="w-6 h-6 flex items-center justify-center shrink-0">
                      <ComponentEquipmentMstModal
                        size="xs"
                        compact={true}
                        empty_flag={false}
                        name_flag={false}
                        show_name={true}
                        show_param={true}
                        mst_slot_item={mockMstSlotItemsDict[110]}
                      />
                    </div>
                    <div class="w-3 text-center shrink-0">/</div>
                    <div class="w-6 h-6 flex items-center justify-center shrink-0">
                      <EmptySlot
                        kind="equip"
                        size="xs"
                        label="No enemy touch plane"
                      />
                    </div>
                  </div>
                  <div class="divider divider-horizontal mr-0 ml-0" />
                  <div class="inline-flex items-center shrink-0">
                    <span>CI :</span>
                    <span class="w-1" />
                    <div class="flex items-center shrink-0">
                      <div class="w-24 shrink-0 overflow-hidden flex items-center">
                        <ComponentShipModal
                          size="xs"
                          name_flag={true}
                          ship={mockFletcherShip}
                          mst_ship={mockFletcherMstShip}
                          slot_items={mockSlotItems}
                          mst_slot_items={mockMstSlotItems}
                        />
                      </div>
                      <div class="w-1 shrink-0" />
                      <div class="w-20 shrink-0 flex items-center justify-start gap-1">
                        <div class="w-6 overflow-hidden">
                          <ComponentEquipmentMstModal
                            size="xs"
                            compact={true}
                            empty_flag={false}
                            name_flag={false}
                            show_name={true}
                            show_param={true}
                            mst_slot_item={mockMstSlotItemsDict[303]}
                          />
                        </div>
                        <div class="w-6 overflow-hidden">
                          <ComponentEquipmentMstModal
                            size="xs"
                            compact={true}
                            empty_flag={false}
                            name_flag={false}
                            show_name={true}
                            show_param={true}
                            mst_slot_item={mockMstSlotItemsDict[507]}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="divider divider-horizontal mr-0 ml-0" />
                  <SpriteMotionCounts
                    counts={{
                      f_sprite_fly_count: 12,
                      e_sprite_fly_count: 8,
                      f_sprite_crash_count: 0,
                      e_sprite_crash_count: 2,
                      f_sprite_damage_count: 1,
                      e_sprite_damage_count: 0,
                      f_sprite_non_normal_count: 0,
                      e_sprite_non_normal_count: 0,
                    }}
                  />
                </div>
                <div class="p-2.5 bg-base-300/30 rounded border border-base-300 flex flex-wrap items-center gap-x-2 text-xs">
                  <div class="inline-flex items-center shrink-0">
                    <span>Result :</span>
                    <span class="w-1" />
                    <span class="text-yellow-500 font-semibold w-8">S</span>
                  </div>
                  <div class="divider divider-horizontal mr-0 ml-0" />
                  <div class="inline-flex items-center shrink-0">
                    <span>Drop :</span>
                    <span class="w-1" />
                    <div class="w-28 shrink-0 flex items-center">
                      <EmptySlot
                        kind="ship"
                        size="xs"
                        showLabel={true}
                        labelWidthClass="flex-1"
                        widthClass="w-full"
                        label="No drop ship"
                      />
                    </div>
                  </div>
                  <div class="divider divider-horizontal mr-0 ml-0" />
                  <div class="inline-flex items-center shrink-0">
                    <span>Landing HP :</span>
                    <span class="w-1" />
                    <span class="tabular-nums">0</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 12 / BASE OPERATIONS: LBAS, MATERIALS & QUESTS */}
        <section id="section-base-ops" class="space-y-4 pt-2">
          <div class="border-b border-base-300 pb-2">
            <h2 class="text-xl font-bold tracking-tight">
              12 / Base Operations: LBAS, Materials, Items &amp; Quests
            </h2>
            <p class="text-xs text-base-content/60 mt-0.5">
              基地航空隊（LBAS）、資源・資材帯（Materials）、アイテム棚（Items）、任務（Quests）の生体仕様。
            </p>
          </div>

          <div class="bg-base-100 rounded-box border border-base-300 p-5 space-y-6">
            {/* Part 1: AirBasesComponent (LBAS) */}
            <div class="space-y-3">
              <div class="flex items-center justify-between border-b border-base-300 pb-1.5">
                <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                  基地航空隊生体表示 (&lt;AirBasesComponent /&gt;)
                </h3>
                <span class="text-[11px] text-base-content/50 font-mono">
                  Action Kind: Standby / Sortie / Defense / Evacuation / Rest
                </span>
              </div>

              <div class="border border-base-300 rounded-box overflow-x-auto bg-base-100">
                <ul class="menu menu-xs bg-base-100 w-full pl-0 flex pt-0">
                  <li>
                    <details open>
                      <summary>Air Base</summary>
                      <ul class="pl-0">
                        <li>
                          <details open>
                            <summary class="flex">
                              1-1
                              <div class="w-4">
                                <IconChevronRightS class="h-4 w-4" />
                              </div>
                              <div class="truncate w-32">第一基地航空隊</div>
                              <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                              <div class="flex-none">R : 7</div>
                              <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                              <div class="flex-none">Sortie</div>
                              <span class="flex-auto" />
                            </summary>
                            <ul class="pl-0">
                              <li class="h-auto">
                                <a class="justify-start gap-x-0 gap-y-1 flex flex-wrap">
                                  <div class="justify-start gap-0 flex">
                                    <div
                                      class="pl-2 pr-0.5 flex-1 min-w-12 content-center"
                                      style={{
                                        "overflow-x": "clip",
                                        "overflow-clip-margin":
                                          "content-box 4px",
                                      }}
                                    >
                                      <div class="w-58">
                                        <ComponentEquipmentModal
                                          size="xs"
                                          attr_onslot={18}
                                          slot_item={mockSlotItemsDict[9001]}
                                          mst_slot_item={
                                            mockMstSlotItemsDict[701]
                                          }
                                          name_flag={true}
                                        />
                                      </div>
                                    </div>
                                    <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                                    <div class="flex-none">
                                      <div class="flex justify-center w-8 indicator">
                                        <div class="indicator-item indicator-top indicator-end" />
                                        <div class="badge badge-md border-base-300 w-9 text-nowrap">
                                          --
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </a>
                              </li>

                              <li class="h-auto">
                                <a class="justify-start gap-x-0 gap-y-1 flex flex-wrap">
                                  <div class="justify-start gap-0 flex">
                                    <div
                                      class="pl-2 pr-0.5 flex-1 min-w-12 content-center"
                                      style={{
                                        "overflow-x": "clip",
                                        "overflow-clip-margin":
                                          "content-box 4px",
                                      }}
                                    >
                                      <div class="w-58">
                                        <ComponentEquipmentModal
                                          size="xs"
                                          attr_onslot={18}
                                          slot_item={mockSlotItemsDict[9002]}
                                          mst_slot_item={
                                            mockMstSlotItemsDict[702]
                                          }
                                          name_flag={true}
                                        />
                                      </div>
                                    </div>
                                    <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                                    <div class="flex-none">
                                      <div class="flex justify-center w-8 indicator">
                                        <div class="indicator-item indicator-top indicator-end">
                                          <div class="h-4 w-4">
                                            <IconCautionFill
                                              level="middle"
                                              size="full"
                                            />
                                          </div>
                                        </div>
                                        <div class="badge badge-md border-base-300 w-9 text-nowrap">
                                          --
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </a>
                              </li>

                              <li class="h-auto">
                                <a class="justify-start gap-x-0 gap-y-1 flex flex-wrap">
                                  <div class="justify-start gap-0 flex">
                                    <div
                                      class="pl-2 pr-0.5 flex-1 min-w-12 content-center"
                                      style={{
                                        "overflow-x": "clip",
                                        "overflow-clip-margin":
                                          "content-box 4px",
                                      }}
                                    >
                                      <div class="w-58">
                                        <ComponentEquipmentModal
                                          size="xs"
                                          attr_onslot={18}
                                          slot_item={mockSlotItemsDict[9003]}
                                          mst_slot_item={
                                            mockMstSlotItemsDict[703]
                                          }
                                          name_flag={true}
                                        />
                                      </div>
                                    </div>
                                    <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                                    <div class="flex-none">
                                      <div class="flex justify-center w-8 indicator">
                                        <div class="indicator-item indicator-top indicator-end">
                                          <div class="h-4 w-4">
                                            <IconCautionFill
                                              level="high"
                                              size="full"
                                            />
                                          </div>
                                        </div>
                                        <div class="badge badge-md border-base-300 w-9 text-nowrap">
                                          --
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </a>
                              </li>

                              <li class="h-auto">
                                <a class="justify-start gap-x-0 gap-y-1 flex flex-wrap">
                                  <div class="justify-start gap-0 flex">
                                    <div
                                      class="pl-2 pr-0.5 flex-1 min-w-12 content-center"
                                      style={{
                                        "overflow-x": "clip",
                                        "overflow-clip-margin":
                                          "content-box 4px",
                                      }}
                                    >
                                      <div class="w-58">
                                        <ComponentEquipmentModal
                                          size="xs"
                                          attr_onslot={4}
                                          slot_item={mockSlotItemsDict[9004]}
                                          mst_slot_item={
                                            mockMstSlotItemsDict[704]
                                          }
                                          name_flag={true}
                                        />
                                      </div>
                                    </div>
                                    <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                                    <div class="flex-none">
                                      <div class="flex justify-center w-8 indicator">
                                        <div class="indicator-item indicator-top indicator-end" />
                                        <div class="badge badge-md border-base-300 w-9 text-nowrap">
                                          --
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </a>
                              </li>
                            </ul>
                          </details>
                        </li>
                      </ul>
                    </details>
                  </li>
                </ul>
              </div>
            </div>

            {/* Part 2: MaterialsComponent */}
            <div class="space-y-3 pt-2">
              <div class="flex items-center justify-between border-b border-base-300 pb-1.5">
                <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                  資源・資材帯生体表示 (&lt;MaterialsComponent /&gt;)
                </h3>
                <span class="text-[11px] text-base-content/50 font-mono">
                  燃料・弾薬・鋼材・ボーキサイト・バーナー(2)・バケツ(1)・開発資材(3)・ネジ(4)
                </span>
              </div>
              <p class="text-xs text-base-content/60">
                燃料(31)から改修資材(4)までの主要8資源が{" "}
                <code>IconMaterial size=&quot;xs&quot;</code>
                （24x24px、DeckComponent の各SVGと同一高さ）＋横並び数値（
                <code>tabular-nums</code>）で表示されます。
              </p>

              <div class="border border-base-300 rounded-box overflow-x-auto bg-base-100">
                <ul class="menu menu-xs bg-base-100 w-full pl-0 flex pt-0">
                  <li>
                    <details open>
                      <summary>Materials</summary>
                      <ul class="pl-0">
                        <li class="h-auto">
                          <div class="justify-start gap-0 flex flex-nowrap items-center">
                            <div class="w-[24px] shrink-0" />
                            <div class="pl-2 justify-start gap-x-0 gap-y-1 flex flex-wrap items-center">
                              <For
                                each={[
                                  { id: 31, count: 284520 },
                                  { id: 32, count: 279140 },
                                  { id: 33, count: 298300 },
                                  { id: 34, count: 195400 },
                                  { id: 2, count: 1920 },
                                  { id: 1, count: 2840 },
                                  { id: 3, count: 2450 },
                                  { id: 4, count: 84 },
                                ]}
                              >
                                {(mat) => (
                                  <div class="inline-flex items-center flex-nowrap shrink-0">
                                    <div class="shrink-0">
                                      <MaterialIcon
                                        item_number={mat.id}
                                        size="xs"
                                      />
                                    </div>
                                    <div class="w-12 flex justify-end tabular-nums">
                                      {mat.count}
                                    </div>
                                    <div class="divider divider-horizontal mr-0 ml-0" />
                                  </div>
                                )}
                              </For>
                            </div>
                          </div>
                        </li>
                      </ul>
                    </details>
                  </li>
                </ul>
              </div>
            </div>

            {/* Part 3: QuestsComponent */}
            <div class="space-y-3 pt-2">
              <div class="flex items-center justify-between border-b border-base-300 pb-1.5">
                <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                  任務トラッカー生体表示 (&lt;QuestsComponent /&gt;)
                </h3>
                <span class="text-[11px] text-base-content/50 font-mono">
                  Accepted / Available / Completed (達成・報告済) • 期間置換対応
                </span>
              </div>

              <div class="border border-base-300 rounded-box overflow-x-auto bg-base-100">
                <ul class="menu menu-xs bg-base-100 w-full pl-0 flex pt-0">
                  <li class="w-full min-w-0">
                    <details open class="min-w-0 w-full">
                      <summary>Quests</summary>
                      <ul class="pl-0 max-w-[960px]">
                        <li class="py-1 w-150 max-w-full">
                          <div class="px-2 py-1 flex items-center justify-between gap-2 w-full hover:bg-transparent! active:bg-transparent! cursor-default">
                            <input
                              type="search"
                              aria-label="Filter quests..."
                              class="input input-xs input-bordered min-w-0 flex-1 max-w-60"
                              placeholder="Filter quests..."
                              value=""
                              readonly
                            />
                            <span class="text-xs text-base-content/60 tabular-nums shrink-0">
                              4 / 4
                            </span>
                          </div>
                        </li>
                        <li class="text-xs px-2 py-1 font-semibold text-base-content/80">
                          Accepted (1)
                        </li>
                        <li class="text-xs py-1 w-full justify-between items-start gap-3">
                          <div class="px-2 flex items-start gap-2 w-150 max-w-full">
                            <div class="flex flex-col gap-0.5 tabular-nums w-9 shrink-0 items-end">
                              <span class="text-base-content/70">[216]</span>
                              <span class="text-base-content/60">80%</span>
                            </div>
                            <div class="min-w-0 flex-1">
                              <div class="flex items-center gap-1.5 min-w-0">
                                <span class="truncate">
                                  敵艦隊主力を撃滅せよ！
                                </span>
                                <span class="badge badge-xs badge-ghost border-base-300 shrink-0">
                                  Weekly
                                </span>
                              </div>
                              <div class="text-[11px] text-base-content/60 whitespace-pre-wrap wrap-break-word mt-0.5">
                                敵艦隊主力との交戦を敢行、これを撃滅せよ！
                              </div>
                            </div>
                          </div>
                        </li>

                        <li class="text-xs px-2 py-1 font-semibold text-base-content/80 mt-2">
                          Available (1)
                        </li>
                        <li class="text-xs py-1 w-full justify-between items-start gap-3">
                          <div class="px-2 flex items-start gap-2 w-150 max-w-full">
                            <div class="flex flex-col gap-0.5 tabular-nums w-9 shrink-0 items-end">
                              <span class="text-base-content/70">[303]</span>
                              <span class="text-base-content/60">0%</span>
                            </div>
                            <div class="min-w-0 flex-1">
                              <div class="flex items-center gap-1.5 min-w-0">
                                <span class="truncate">
                                  「演習」で練度向上！
                                </span>
                                <span class="badge badge-xs badge-ghost border-base-300 shrink-0">
                                  Daily
                                </span>
                              </div>
                              <div class="text-[11px] text-base-content/60 whitespace-pre-wrap wrap-break-word mt-0.5">
                                本日中に他の司令官の艦隊と3回以上「演習」を行え！
                              </div>
                            </div>
                          </div>
                        </li>

                        <li class="text-xs px-2 py-1 font-semibold text-base-content/80 mt-2">
                          Completed (2)
                        </li>
                        <li class="text-xs py-1 w-full justify-between items-start gap-3">
                          <div class="px-2 flex items-start gap-2 w-150 max-w-full">
                            <div class="flex flex-col gap-0.5 tabular-nums w-9 shrink-0 items-end">
                              <span class="text-base-content/70">[402]</span>
                              <span class="text-base-content/60">100%</span>
                            </div>
                            <div class="min-w-0 flex-1">
                              <div class="flex items-center gap-1.5 min-w-0">
                                <span class="truncate">
                                  「遠征」を3回成功させよう！
                                </span>
                                <span class="badge badge-xs badge-ghost border-base-300 shrink-0">
                                  Daily
                                </span>
                                <span class="badge badge-xs badge-success shrink-0">
                                  Claimable
                                </span>
                              </div>
                              <div class="text-[11px] text-base-content/60 whitespace-pre-wrap wrap-break-word mt-0.5">
                                艦隊を遠征に出航させ、本日中に遠征を3回以上成功させよ！
                              </div>
                            </div>
                          </div>
                        </li>
                        <li class="text-xs py-1 w-full justify-between items-start gap-3">
                          <div class="px-2 flex items-start gap-2 w-150 max-w-full">
                            <div class="flex flex-col gap-0.5 tabular-nums w-9 shrink-0 items-end">
                              <span class="text-base-content/70">[503]</span>
                              <span class="text-base-content/60">100%</span>
                            </div>
                            <div class="min-w-0 flex-1">
                              <div class="flex items-center gap-1.5 min-w-0">
                                <span class="truncate">艦隊大整備！</span>
                                <span class="badge badge-xs badge-ghost border-base-300 shrink-0">
                                  Daily
                                </span>
                                <span class="badge badge-xs badge-neutral shrink-0">
                                  Completed
                                </span>
                              </div>
                              <div class="text-[11px] text-base-content/60 whitespace-pre-wrap wrap-break-word mt-0.5">
                                各艦隊から複数の艦を「入渠」させ、艦隊の整備を行え！
                              </div>
                            </div>
                          </div>
                        </li>
                      </ul>
                    </details>
                  </li>
                </ul>
              </div>
            </div>

            {/* Part 4: ItemsComponent */}
            <div class="space-y-3 pt-2">
              <div class="flex items-center justify-between border-b border-base-300 pb-1.5">
                <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                  アイテム棚生体表示 (&lt;ItemsComponent /&gt;)
                </h3>
                <span class="text-[11px] text-base-content/50 font-mono">
                  Normal (id&lt;75) / Special (id&gt;=75) / Purchased (payitem)
                </span>
              </div>

              <div class="border border-base-300 rounded-box overflow-x-auto bg-base-100">
                <ul class="menu menu-xs bg-base-100 w-full pl-0 flex pt-0">
                  <li class="w-full min-w-0">
                    <details open class="min-w-0 w-full">
                      <summary>Items</summary>
                      <ul class="pl-0 max-w-[960px]">
                        <li class="py-1 w-150 max-w-full">
                          <div class="px-2 py-1 flex items-center justify-between gap-2 w-full hover:bg-transparent! active:bg-transparent! cursor-default">
                            <input
                              type="search"
                              aria-label="Filter items..."
                              class="input input-xs input-bordered min-w-0 flex-1 max-w-60"
                              placeholder="Filter items..."
                              value=""
                              readonly
                            />
                            <span class="text-xs text-base-content/60 tabular-nums shrink-0">
                              4 / 4
                            </span>
                          </div>
                        </li>
                        <li class="w-150 max-w-full min-w-0">
                          <details open class="min-w-0 w-full">
                            <summary class="text-xs font-semibold text-base-content/80">
                              Normal Items (2)
                            </summary>
                            <ul class="pl-0">
                              <li class="text-xs py-1 w-full">
                                <div class="px-2 flex items-start gap-2.5 w-full">
                                  <div class="shrink-0 pt-0.5">
                                    <MaterialIcon item_number={50} size="xs" />
                                  </div>
                                  <div class="min-w-0 flex-1">
                                    <div class="flex items-center justify-between gap-2">
                                      <span class="truncate font-medium">
                                        応急修理要員
                                      </span>
                                      <span class="tabular-nums font-medium shrink-0 text-right w-14">
                                        x5
                                      </span>
                                    </div>
                                    <div class="text-[11px] text-base-content/60 whitespace-pre-wrap wrap-break-word mt-0.5">
                                      轟沈した艦を一度だけ救出し、中破状態で復帰させます。
                                    </div>
                                  </div>
                                </div>
                              </li>
                              <li class="text-xs py-1 w-full">
                                <div class="px-2 flex items-start gap-2.5 w-full">
                                  <div class="shrink-0 pt-0.5">
                                    <MaterialIcon item_number={57} size="xs" />
                                  </div>
                                  <div class="min-w-0 flex-1">
                                    <div class="flex items-center justify-between gap-2">
                                      <div class="flex items-center gap-1.5 min-w-0">
                                        <span class="truncate font-medium">
                                          勲章
                                        </span>
                                        <span class="badge badge-xs badge-accent shrink-0">
                                          Usable
                                        </span>
                                      </div>
                                      <span class="tabular-nums font-medium shrink-0 text-right w-14">
                                        x14
                                      </span>
                                    </div>
                                    <div class="text-[11px] text-base-content/60 whitespace-pre-wrap wrap-break-word mt-0.5">
                                      複数集めることで資源または改装設計図と交換可能です。
                                    </div>
                                  </div>
                                </div>
                              </li>
                            </ul>
                          </details>
                        </li>
                        <li class="w-150 max-w-full">
                          <details open>
                            <summary class="text-xs font-semibold text-base-content/80">
                              Special Items (1)
                            </summary>
                            <ul class="pl-0">
                              <li class="text-xs py-1 w-full">
                                <div class="px-2 flex items-start gap-2.5 w-full">
                                  <div class="shrink-0 pt-0.5">
                                    <MaterialIcon item_number={75} size="xs" />
                                  </div>
                                  <div class="min-w-0 flex-1">
                                    <div class="flex items-center justify-between gap-2">
                                      <span class="truncate font-medium">
                                        新型砲熕兵装資材
                                      </span>
                                      <span class="tabular-nums font-medium shrink-0 text-right w-14">
                                        x9
                                      </span>
                                    </div>
                                    <div class="text-[11px] text-base-content/60 whitespace-pre-wrap wrap-break-word mt-0.5">
                                      新型砲熕兵装の開発や改修に必要な特殊資材です。
                                    </div>
                                  </div>
                                </div>
                              </li>
                            </ul>
                          </details>
                        </li>
                        <li class="w-150 max-w-full">
                          <details open>
                            <summary class="text-xs font-semibold text-base-content/80">
                              Purchased Items (1)
                            </summary>
                            <ul class="pl-0">
                              <li class="text-xs py-1 w-full">
                                <div class="px-2 flex items-start gap-2.5 w-full">
                                  <div class="shrink-0 pt-0.5">
                                    <MaterialIcon item_number={53} size="xs" />
                                  </div>
                                  <div class="min-w-0 flex-1">
                                    <div class="flex items-center justify-between gap-2">
                                      <div class="flex items-center gap-1.5 min-w-0">
                                        <span class="truncate font-medium">
                                          母港拡張
                                        </span>
                                        <span class="badge badge-xs badge-accent shrink-0">
                                          Usable
                                        </span>
                                        <span class="badge badge-xs badge-ghost border-base-300 tabular-nums shrink-0">
                                          1000 pt
                                        </span>
                                      </div>
                                      <span class="tabular-nums font-medium shrink-0 text-right w-14">
                                        x1
                                      </span>
                                    </div>
                                    <div class="text-[11px] text-base-content/60 whitespace-pre-wrap wrap-break-word mt-0.5">
                                      保有艦数の上限枠を10隻分拡張します。
                                    </div>
                                  </div>
                                </div>
                              </li>
                            </ul>
                          </details>
                        </li>
                      </ul>
                    </details>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* 13 / COMPONENT INVENTORY TABLE */}
        <section id="section-catalog" class="space-y-4 pt-2">
          <div class="border-b border-base-300 pb-2">
            <h2 class="text-xl font-bold tracking-tight">
              13 / FUSOU-APP Component Inventory &amp; Storybook Coverage
            </h2>
            <p class="text-xs text-base-content/60 mt-0.5">
              実装済み UI コンポーネントおよび Storybook カバレッジ全覧。
            </p>
          </div>

          <div class="bg-base-100 rounded-box border border-base-300 overflow-hidden">
            <div class="overflow-x-auto">
              <table class="table table-xs w-full">
                <thead>
                  <tr class="border-b border-base-300 bg-base-200/60">
                    <th>コンポーネント名</th>
                    <th>ファイルパス</th>
                    <th>役割 / 説明</th>
                    <th>Storybook</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-base-300/40">
                  <tr>
                    <td class="font-mono font-semibold">CustomTitlebar</td>
                    <td>
                      <code>src/components/ui/titlebar.tsx</code>
                    </td>
                    <td>
                      フレームレスタイトルバー、音量ポップオーバー、Tauriウィンドウ制御
                    </td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">ComponentShipModal</td>
                    <td>
                      <code>
                        src/components/ui/components/ship/ship-modal.tsx
                      </code>
                    </td>
                    <td>
                      クリック展開可能な艦船カード（ダイアログ内に
                      ComponentShipTable を描画）
                    </td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">
                      ComponentEquipmentModal
                    </td>
                    <td>
                      <code>
                        src/components/ui/components/equipment/equipment-modal.tsx
                      </code>
                    </td>
                    <td>
                      装備カード・改修★・熟練度・機数表示（クリックで諸元ダイアログ展開）
                    </td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">
                      ComponentShipMaskedModal
                    </td>
                    <td>
                      <code>
                        src/components/ui/components/ship-masked/ship-masked-modal.tsx
                      </code>
                    </td>
                    <td>
                      深海敵艦・友軍艦隊用マスク表示モーダル（非公開諸元 unknown
                      隠蔽）
                    </td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">ComponentColorBar</td>
                    <td>
                      <code>
                        src/components/ui/components/bar/color-bar.tsx
                      </code>
                    </td>
                    <td>HP/Exp等の進捗ゲージ（HP残量に応じた自動色相判定）</td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">
                      ComponentColorBarLabel
                    </td>
                    <td>
                      <code>
                        src/components/ui/components/bar/color-bar-label.tsx
                      </code>
                    </td>
                    <td>
                      現在値/最大値分数ラベル併記型の統合ゲージコンポーネント
                    </td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">DeckComponent</td>
                    <td>
                      <code>src/components/deck_port/deck.tsx</code>
                    </td>
                    <td>
                      艦隊スロット（艦船・装備5枠+SE・HP・Cond・補給バー）の描画
                    </td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">
                      BattleSummaryComponent
                    </td>
                    <td>
                      <code>
                        src/components/battles/battle/battle_summary.tsx
                      </code>
                    </td>
                    <td>
                      戦闘終了後の味方 vs 敵艦隊のHP・被ダメージ対照サマリー表
                    </td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">AirStateComponent</td>
                    <td>
                      <code>src/components/battles/shared/air_state.tsx</code>
                    </td>
                    <td>
                      制空権状態（確保・優勢・互角・劣勢・喪失）の等幅インライン表示
                    </td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">FormationComponent</td>
                    <td>
                      <code>src/components/battles/shared/formation.tsx</code>
                    </td>
                    <td>
                      交戦陣形（単縦陣・警戒陣・警戒航行序列等）の英字等幅インライン表示
                    </td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">
                      DamageCommonComponent
                    </td>
                    <td>
                      <code>src/components/battles/dmg.tsx</code>
                    </td>
                    <td>
                      ダメージ数値表示（クリティカル黄、通常白、カスダメ/Miss赤）
                    </td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">AirBasesComponent</td>
                    <td>
                      <code>src/components/airbase/air_bases.tsx</code>
                    </td>
                    <td>
                      基地航空隊（出撃/防空/退避等の行動状態と4中隊装備枠）
                    </td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">MaterialsComponent</td>
                    <td>
                      <code>src/components/materials/materials.tsx</code>
                    </td>
                    <td>
                      主要資源4種＋資材4種（24px
                      SVG・tabular-nums）のリアルタイム集計ストリップ
                    </td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">ItemsComponent</td>
                    <td>
                      <code>src/components/items/items.tsx</code>
                    </td>
                    <td>
                      通常・特殊拡張・課金アイテム棚（IconMaterial・所持数・説明文）
                    </td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">QuestsComponent</td>
                    <td>
                      <code>src/components/quests/quests.tsx</code>
                    </td>
                    <td>
                      受注中・受注可能・完了任務の一覧、期間置換・進捗表示
                    </td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">
                      EmptyValue / EmptySlot
                    </td>
                    <td>
                      <code>src/components/ui/components/empty/empty.tsx</code>
                    </td>
                    <td>
                      固定幅欠損値（—）・空スロット破線 SVG プレースホルダー
                    </td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">
                      TouchPlane / FlareShip
                    </td>
                    <td>
                      <code>
                        src/components/battles/shared/
                        {`{touch_plane,flare_ship}`}.tsx
                      </code>
                    </td>
                    <td>触接・照明弾の共通固定幅インジケーター</td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">LogViewerComponent</td>
                    <td>
                      <code>src/components/logger/log-viewer.tsx</code>
                    </td>
                    <td>
                      virtua
                      による仮想化スクロール高速ログビューア、絞り込み、コピー
                    </td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">
                      PolicyPanelComponent
                    </td>
                    <td>
                      <code>src/components/policy/policy_panel.tsx</code>
                    </td>
                    <td>通信保全基準・Read-only 観測ポリシーパネル</td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">
                      ThemeControllerComponent
                    </td>
                    <td>
                      <code>src/components/settings/theme.tsx</code>
                    </td>
                    <td>
                      タイトルバーに常駐する DaisyUI テーマ（Light /
                      Dark）クリック切り替えボタン
                    </td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">AlertMessage</td>
                    <td>
                      <code>
                        src/components/ui/components/alert/alert_message.tsx
                      </code>
                    </td>
                    <td>
                      FUSOU-WEB
                      統一ソフトティント・セマンティックステータスアラート
                    </td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">FadeToast</td>
                    <td>
                      <code>src/components/settings/fade_toast.tsx</code>
                    </td>
                    <td>
                      通知メッセージの自動フェードイン・フェードアウトトースト
                    </td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="font-mono font-semibold">
                      DataCollectionStatusComponent
                    </td>
                    <td>
                      <code>
                        src/components/settings/data_collection_status.tsx
                      </code>
                    </td>
                    <td>
                      アップロード保留リトライ状態およびサプレッション追跡
                    </td>
                    <td>
                      <span class="badge badge-success badge-xs">Covered</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Footer Note */}
        <div class="border-t border-base-300 pt-6 mt-8 text-center text-xs text-base-content/60">
          <p>
            FUSOU-APP Design System &amp; Component Catalog • Developed for
            FUSOU Desktop Operations Platform
          </p>
          <p class="mt-1 text-base-content/40">
            All UI components strictly adhere to{" "}
            <code class="font-mono bg-base-300 px-1 rounded">DESIGN.md</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
