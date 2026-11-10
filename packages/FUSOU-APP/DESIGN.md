# DESIGN.md - FUSOU-APP Design System

Design System and UI Specification for FUSOU-APP (Tauri Desktop Application).

Data-dense naval operations desktop client with a calm dark base, frameless native window integration, explicit operational signaling, and high-precision tabular readability.

---

## Design Principles

1. **Native Frameless Desktop Ergonomics**:
   - Custom titlebar (`CustomTitlebar`) with native window control integration (`.fusou-win-btn`, `.fusou-tool-btn`).
   - Clean 10px rounded corners on `#root` when windowed, seamlessly flattening to 0px when maximized (`.is-maximized`).
   - Native dragging via `data-tauri-drag-region` and custom resizable edges (`WindowResizeBorders`).
2. **Theme Surfaces & High Data Density**:
   - Uses DaisyUI 5 OKLCH light (`--color-base-100: oklch(100% 0 0)`, `--color-base-300: oklch(92% 0.004 286.32)`) and dark (`--color-base-100: oklch(21.6% 0.006 56.043)`, `--color-base-300: oklch(27% 0.006 286.033)`) themes in `src/global.css`.
   - Brand & chrome hex values are scoped to the Tauri custom titlebar (`#27272a`), audio popover (`#1d1c1c`), 3-bar FUSOU logo / range thumb (`#B5D95A`, `#96C54E`, `#76B142`), and Tailwind operational status colors (`text-green-500`, `text-lime-500`, `text-yellow-500`, `text-orange-500`, `text-red-500`).
3. **Typography & Tactical Monospace Usage**:
   - `Roboto Mono` (`font-weight: 500`, imported in `src/global.css`) is applied to SVG tactical icon badges (`IconShip`, `IconEquipment`, `IconMaterial`, `IconFleetNumber`).
   - Operational lists and tables (`DeckComponent`, `BattleSummaryComponent`, `AirBasesComponent`, `MaterialsComponent`, `QuestsComponent`) use the app default sans-serif font, with `font-mono` used explicitly in `ErrorFallback.tsx` and `data_collection_status.tsx` and `tabular-nums` in `CustomTitlebar`.
4. **Resilient Non-Blocking UI Architecture**:
   - Every component must gracefully handle IPC delays, missing data, and non-Tauri browser/Storybook environments using `safeTauriListen`, `isTauri()`, and `<Show>` fallbacks.
5. **Strict Domain Vocabulary**:
   - Always use **「艦」** (Ship) for naval entities. Never use "艦娘" in any UI label, code, tooltip, or documentation.

---

## 01 / Color Palette & Theme Tokens

### Chrome, Brand & Operational Status Colors

- **Titlebar Canvas**: `#27272a` (`CustomTitlebar` header background and volume popover border)
- **Volume Popover Surface**: `#1d1c1c` (Floating 176px volume control panel & slider thumb border)
- **FUSOU 3-Bar Logo & Slider Thumb**: `#B5D95A` (top bar), `#96C54E` (middle bar & slider thumb `#96c54e`), `#76B142` (bottom bar)
- **Titlebar Text & Window Close Hover**: `#e5e7eb` / `#f1f5f9` (text), `#ef4444` / `#dc2626` (close hover/active & mute active)
- **ComponentColorBar & Operational Status Classes**:
  - `text-green-500` (`v_now == v_max` or Cond >= 50)
  - `text-lime-500` (`v_now > 0.75 * v_max`, Air Supremacy/Superiority, crossing advantage, launched balloon)
  - `text-yellow-500` (`v_now > 0.50 * v_max`, Air Parity, Critical hit damage, Kira stars)
  - `text-orange-500` (`v_now > 0.25 * v_max`, Air Denial, medium caution warning)
  - `text-red-500` (`v_now <= 0.25 * v_max`, Air Incapability, zero damage/miss, high caution warning)

### DaisyUI 5 Theme Tokens (`src/global.css`)

FUSOU-APP configures two core themes with full OKLCH color space support:

| Token | Dark Theme | Light Theme (Default) | Usage |
| :--- | :--- | :--- | :--- |
| `--color-base-100` | `oklch(21.6% 0.006 56.043)` | `oklch(100% 0 0)` | Window content & surface |
| `--color-base-200` | `oklch(21.6% 0.006 56.043)` | `oklch(100% 0 0)` | Page canvas background |
| `--color-base-300` | `oklch(27% 0.006 286.033)` | `oklch(92% 0.004 286.32)` | Borders, badges, dividers (`--radius-box: 0.5rem`) |
| `--color-base-content` | `oklch(97.807% 0.029 256.847)` | `oklch(21% 0.006 285.885)` | Primary typography |
| `--color-primary` | `oklch(87% 0.15 154.449)` | `oklch(87% 0.15 154.449)` | Primary buttons & active toggles |
| `--color-secondary` | `oklch(89% 0.196 126.665)` | `oklch(89% 0.196 126.665)` | Secondary controls |
| `--color-accent` | `oklch(86% 0.127 207.078)` | `oklch(86% 0.127 207.078)` | Equipment improvement `+n`, ship bonus indicators |
| `--color-info` | `oklch(68% 0.169 237.323)` | `oklch(68% 0.169 237.323)` | Informational states & log DEBUG badges |
| `--color-success` | `oklch(76% 0.233 130.85)` | `oklch(76% 0.233 130.85)` | Update alert, policy read-only checks, log INFO badges |
| `--color-warning` | `oklch(70% 0.213 47.604)` | `oklch(70% 0.213 47.604)` | Log WARN badges |
| `--color-error` | `oklch(63% 0.237 25.331)` | `oklch(63% 0.237 25.331)` | Error alerts, log ERROR badges, missing state outlines |

---

## 02 / Typography Hierarchy

- **Titlebar Brand**: 11px / `font-bold tracking-wider opacity-90` (`CustomTitlebar`)
- **Update Page Heading**: `text-4xl` (`update.tsx`)
- **Panel / Policy Title**: `text-xl font-bold` (`policy_panel.tsx`)
- **Card / Section Heading**: `text-lg font-semibold` (`start.tsx`)
- **Operational List & Table Text**: `text-xs` / `text-sm` in default system sans-serif (`DeckComponent`, `BattleSummaryComponent`, `AirBasesComponent`, `MaterialsComponent`, `QuestsComponent`)
- **SVG Capsule Icons**: `Roboto Mono` (`font-weight: 500`, 96px SVG coordinate space)
- **Explicit Monospace Scopes**: `font-mono` in `ErrorFallback.tsx` and `data_collection_status.tsx`; `tabular-nums` on `CustomTitlebar` volume readout (`10px`)

Rules:

- Stat tables and slot labels must never wrap unnecessarily; use `truncate` and `text-nowrap`.
- Multi-character equipment/material labels inside SVGs use SVG `textLength` + `lengthAdjust="spacingAndGlyphs"` instead of arbitrary font shrinking.

---

## 03 / Frameless Window & Custom Titlebar

### Window Architecture

1. **Root Shell (`#root`)**:
   - `height: 100vh; width: 100vw; display: flex; flex-direction: column; overflow: hidden;`
   - Floating window: `border-radius: 10px;`
   - Maximized window: `border-radius: 0px !important;` (toggled via `.is-maximized`)
2. **Window Resize Borders (`WindowResizeBorders`)**:
   - Invisible drag-handle strips along the 8 window perimeters (`top`, `bottom`, `left`, `right`, and 4 corners) enabling native window resizing in frameless mode.
3. **Custom Titlebar (`CustomTitlebar`)**:
   - Fixed height: 32px (`h-8`), background `#27272a`, text `#f1f5f9`.
   - Drag region: `data-tauri-drag-region` on header and title container.
   - Double click: Toggles window maximize/restore.

### Titlebar Tool Buttons (`.fusou-tool-btn`)

- Height: strictly fixed to 24px (`h-6`), padding `0 6px`, border-radius 4px.
- Normal state: transparent background, text `#e5e7eb`.
- Hover state: `background: rgba(255, 255, 255, 0.1)`, text `#ffffff`.
- Active state (`.fusou-active`): `background: rgba(255, 255, 255, 0.15)`.
- Tools included:
  - **Screenshot**: `invoke("trigger_external_screenshot")`
  - **Reload**: Click: reload external game webview / Shift+Click: reload app UI.
  - **Volume Popover**: Displays live volume % (`0%` - `100%`) with mute icon.

### Sound Volume Popover & Controls

- Panel: `#1d1c1c` surface, border `1px solid #27272a`, radius 8px, padding 10px.
- Custom range slider (`.fusou-custom-range`): 8px height pill track with 16px circular thumb (`#96c54e`).
- Custom mute toggle (`.fusou-custom-mute-btn`):
  - Normal: transparent with 1px border.
  - Muted (`.is-muted`): background `#ef4444` (error red), white text.

### Window Action Buttons (`.fusou-win-btn`)

- Dimensions: width 40px, height 32px (`w-10 h-8`).
- Hover: `background: rgba(255, 255, 255, 0.1)`.
- Close button (`.fusou-win-close`): Hover background `#ef4444`, active `#dc2626`.

---

## 04 / Buttons & Action Hierarchy

| Variant | Classes | Purpose |
| :--- | :--- | :--- |
| **Primary Action** | `.btn.btn-primary` (or `.btn-sm`) | Main CTA (Save, Submit, Sync, Confirm) |
| **Secondary Action** | `.btn.btn-secondary` | Sub-operations (Refresh, Export, Filter) |
| **Outline Action** | `.btn.btn-outline` | Bordered button with lower emphasis |
| **Ghost Action** | `.btn.btn-ghost` | Low-emphasis navigation, cancel, close dialog |
| **Destructive** | `.btn.btn-error` / `.btn-error.btn-outline` | Delete, reset cache, cancel upload |
| **Tool Button** | `.fusou-tool-btn` | Titlebar actions (24px height, icon+label) |
| **Compact Control** | `.btn.btn-xs` | Table row operations, item remove buttons |

Rules:

- Keep action labels concise and action-oriented.
- When an operation is in-flight, display `<span class="loading loading-spinner loading-xs" />` and disable the button.

---

## 05 / Cards, Surfaces & Collapsible Groups

### Standard Surface

- Background: `bg-base-100`
- Border: `border border-base-300` (`oklch(27% 0.006 286.033)`)
- Radius: `rounded-lg` (8px) or `rounded-box`
- Shadow: Flat (no drop shadows; depth is strictly border-driven)

### Collapsible Operational Groups (`<details open><summary>`)

The primary grouping mechanism in FUSOU-APP is the native `<details open class="group">` within `.menu.menu-xs`:

```tsx
<li>
  <details open>
    <summary class="font-semibold text-xs">Section Title</summary>
    <ul class="pl-0">
      {/* Dense operational content */}
    </ul>
  </details>
</li>
```

---

## 06 / UI Primitives & Visual Meters

### Color Bars (`ComponentColorBar` & `ComponentColorBarLabel`)

- **Component Paths**:
  - `ComponentColorBar`: `src/components/ui/components/bar/color-bar.tsx`
  - `ComponentColorBarLabel`: `src/components/ui/components/bar/color-bar-label.tsx`
- **Percentage Calculation & Progress Properties**:
  - `calc_value = v_max != 0 ? (v_now * 100) / v_max : 0` (or quantized if `quantize > 0`)
  - Progress element always uses `max="100"` with computed percentage `value={calc_value}`.
- **HP Status Color Thresholds**:
  - `v_now == v_max`: Green (`text-green-500`)
  - `v_now > 0.75 * v_max`: Lime (`text-lime-500` / Healthy, Minor Damage threshold)
  - `v_now > 0.50 * v_max`: Yellow (`text-yellow-500` / Minor Damage)
  - `v_now > 0.25 * v_max`: Orange (`text-orange-500` / Moderate Damage)
  - `v_now <= 0.25 * v_max`: Red (`text-red-500` / Heavy Damage / Critical Danger)
- **Bar Sizes**: `xs` (h-1), `sm` (h-[6px]), `md` (h-2), `lg` (h-[10px]), `xl` (h-3).
- **Exact DOM Tree (`ComponentColorBar`)**:
  ```html
  <div class="flex items-center w-full">
    <progress
      class="progress w-full [class_color] [class_size]"
      max="100"
      value={calc_value(v_now, v_max, quantize)}
    ></progress>
  </div>
  ```
- **Exact DOM Tree (`ComponentColorBarLabel`, size="xs")**:
  ```html
  <div class="w-full py-0.5 h-6">
    <div class="grid place-content-center cursor-inherit mx-auto h-[10px] text-xs">
      <div class=" flex flex-nowrap">
        <div class="w-[2em] text-center">{v_now}</div>/
        <div class="w-[2em] text-center">{v_max}</div>
      </div>
    </div>
    <div class="flex place-items-center w-full h-[10px]">
      <div class="flex items-center w-full">
        <progress
          class="progress w-full [class_color] h-1"
          max="100"
          value={calc_value}
        ></progress>
      </div>
    </div>
  </div>
  ```

---

## 07 / Tactical SVG Capsule & Monospace Badge System

FUSOU does not use generic emoji or consumer icon fonts for naval entities. Instead, it utilizes an engineered **Tactical SVG Capsule Badge System** with diagonal military hatch patterns (`bg_slash`), fixed tabular `Roboto Mono` typography, and color-coded status / tier stripes.

### 1. Ship Class Badges (`IconShip`, `src/components/ui/icons/ship.tsx`)

- **Geometry**: SVG Capsule with `viewBox="0 0 199 151"` (width 199, height 151, corner radius 75).
- **Texture**: 12 diagonal slashes across the capsule (`#303030`, 0.5px stroke).
- **Typography & Centering**: Centered medium `Roboto Mono` (`font-weight: 500`) at 96px font size with `lengthAdjust="spacingAndGlyphs"` and `textLength={name.length * 48}`. Text is horizontally centered inside the 199px width capsule via `transform="translate(${28 - (name.length - 3) * 24} 104)"`:
  - 2-letter codes (`DE`, `DD`, `CL`, `CA`, `BB`, `CV`, `SS`, `AO`, `AV`, `AR`, `AS`, `CT`): `transform="translate(52 104)"`, `textLength="96"`. Spans from x=52 to x=148 with symmetrical 51/52px margins centered at x=100.
  - 3-letter codes (`CLT`, `CAV`, `CVL`, `BBV`, `SSV`, `LHA`, `CVB`): `transform="translate(28 104)"`, `textLength="144"`. Spans from x=28 to x=172 with symmetrical 27/28px margins centered at x=100.
- **Hull Classification Codes**:
  - `DE`: 海防艦 (Escort)
  - `DD`: 駆逐艦 (Destroyer)
  - `CL`: 軽巡洋艦 (Light Cruiser)
  - `CLT`: 重雷装巡洋艦 (Torpedo Cruiser)
  - `CA`: 重巡洋艦 (Heavy Cruiser)
  - `CAV`: 航空巡洋艦 (Aviation Cruiser)
  - `CVL`: 軽空母 (Light Aircraft Carrier)
  - `BB`: 戦艦 (Battleship)
  - `BBV`: 航空戦艦 (Aviation Battleship)
  - `CV`: 正規空母 (Standard Aircraft Carrier)
  - `SS`: 潜水艦 (Submarine)
  - `SSV`: 潜水空母 (Submarine Aircraft Carrier)
  - `AO`: 補給艦 (Fleet Oiler)
  - `AV`: 水上機母艦 (Seaplane Tender)
  - `LHA`: 揚陸艦 (Amphibious Assault Ship)
  - `CVB`: 装甲空母 (Armored Aircraft Carrier)
  - `AR`: 工作艦 (Repair Ship)
  - `AS`: 潜水母艦 (Submarine Tender)
  - `CT`: 練習巡洋艦 (Training Cruiser)
- **Status Stripes**: Dual bottom horizontal stripes representing enemy/ship tier:
  - `normal`: Silver/Gray (`#CCCCCC`)
  - `elite`: Orange Red (`#FF4500`)
  - `flagship`: Gold (`#FFD700`)

### 2. Equipment Category Badges (`IconEquipment`, `src/components/ui/icons/equipment.tsx`)

- **Geometry**: Compact square capsule SVG with `viewBox="0 0 151 151"` (width 151, height 151, corner radius 75).
- **Texture**: 8 internal diagonal slashes (`#303030`, 0.5px stroke).
- **Typography & Centering**: Centered medium `Roboto Mono` (`font-weight: 500`) at 96px font size with `lengthAdjust="spacingAndGlyphs"` and `textLength="96"`. Horizontally centered via `transform="translate(28 104)"` (spans x=28 to x=124 with symmetrical 28/27px margins).
- **Category Abbreviations**:
  - `PA`: 小口径主砲 (Small Caliber Main Gun)
  - `SA`: 中口径主砲 (Medium Caliber Main Gun)
  - `TO`: 魚雷 (Torpedo)
  - `CA`: 艦上戦闘機 (Carrier Fighter)
  - `AA`: 対空機銃 (Anti-Air Gun)
  - `RE`: 水上偵察機 (Reconnaissance Seaplane)
  - `RA`: 小型電探 / 大型電探 (Radar)
  - `SO`: ソナー (Sonar)
  - `DC`: 爆雷 / 爆雷投射機 (Depth Charge)
  - `LC`: 大発動艇 / 特型内火艇 (Landing Craft)
  - `EA`: 機関部強化 / 電波探知機 (Turbine / Boiler / Special)
  - `AP`: 徹甲弾 (Armor-Piercing Shell)
  - `LA`: 陸上攻撃機 (Land-based Attack Aircraft)
  - `IN`: 局地戦闘機 (Interceptor Fighter)
  - `JB`: 噴式戦闘爆撃機 (Jet Fighter-Bomber)
- **Category Color Striping**: Dual bottom stripes color-coded by equipment group:
  - Red (`#CC3D3D`): Main battery & munitions (`PA`, `SA`, `AP`)
  - Yellow (`#FFEA00`): Secondary battery, high-angle secondary & recon (`RE`)
  - Blue (`#5887AB`): Torpedoes & torpedo bombers (`TO`)
  - Green (`#39B74E`): Fighters & anti-aircraft (`CA`, `AA`)
  - Orange (`#DE9437`): Dive bombers & mechanical engineering (`EA`)
  - Cyan (`#7FCCD8`): ASW gear (`SO`, `DC`)
  - Purple (`#997EAE`): Special, amphibious & jet equipment (`LC`, `JB`)

### 3. Material & Inventory Badges (`IconMaterial`, `src/components/ui/icons/material.tsx`)

- **Geometry**: Square capsule SVG with `viewBox="0 0 151 151"`, identical styling and background slashes.
- **Material Tactical Codes**:
  - `A0`: 燃料 (Fuel)
  - `B0`: 弾薬 (Ammo)
  - `C0`: 鋼材 (Steel)
  - `D0`: ボーキサイト (Bauxite)
  - `A3`: 高速修復材 (Instant Repair / Bucket)
  - `B3`: 高速建造材 (Instant Construction / Flamethrower)
  - `C3`: 開発資材 (Development Material)
  - `C1`: 改修資材 (Improvement Material / Screws)
  - `E0`: 家具コイン (Furniture Coin)
  - `E3`: 応急修理女神 (Emergency Repair Goddess)
  - `D2`: 間宮 (Food Supply Ship Mamiya)
  - `B1`: 勲章 (Medal)
  - `B4`: 試製甲板カタパルト (Prototype Flight Deck Catapult)
  - `E4`: 戦闘糧食 (Combat Rations)

### 4. Fleet Number Indicators (`IconFleetNumber`, `src/components/ui/icons/fleet-number.tsx`)

- **Structure**: Rendered strictly without capsule borders or rounded containers. Composed of two large monospace tabular digits (`Roboto Mono`, font-size 96, transform `translate(28 104)` in `viewBox="0 0 151 151"`), underlined by a solid 16px bottom indicator bar (`M28 124 124 124`) crossed by 8 diagonal slashes (`bg_slash`, `#303030`).
- **Digit Mapping**:
  - Digit 1: Fleet number (`fleet_number`, 1..4).
  - Digit 2: Ship position within the fleet (`ship_number`, 1..6 or 1..7 for 遊撃部隊).
  - **Combined Fleet Offset**: When `combined_flag: true` and `ship_number > 6`, automatically calculates `[fleet_number + 1, ship_number - 6]`, rendering Second Fleet (随伴護衛艦隊) ships 1st to 6th as `21` through `26`.
  - Examples: `11` (第1艦隊 旗艦), `12` (第1艦隊 2番艦), `16` (第1艦隊 6番艦), `17` (遊撃部隊 7番艦), `21` (第二艦隊 随伴旗艦).
- **Faction Color Coding**:
  - Friendly (`e_flag: 0`): Tactical Emerald Green (`#2D9C45`).
  - Hostile (`e_flag: 1`): Tactical Crimson (`#FF100C`).

### 5. Morale Badges (`IconKira`, `src/components/ui/icons/kira.tsx`)

- High-morale / glittering sparkle indicators (戦意高揚・キラキラ).
- Scalable SVG geometry (`viewBox="0 0 512 512"`):
  - `kira_type: 1`: Single large 4-point sparkle star (`d="M256,128c-24.65,24.65-41.52,67.72-49.91,106.9..."`).
  - `kira_type: 2`: Double sparkle stars (large top-left star paired with medium bottom-right star).
  - `kira_type: 3`: Triple sparkle star cluster (large top-left at `M247.355,106.9...`, medium bottom-right at `M407.471,304.339...`, and small bottom-left at `M146.352,354.702...`), filled with `#EAB308` / `#FFD966` / `currentColor`.

### 6. Plane Proficiency Badges (`IconPlaneProficiency`, `src/components/ui/icons/plane-proficiency.tsx`)

- Aircraft veteran rank insignia with authentic vector geometry (`viewBox="0 0 378 378"`, `stroke-width="4"`, `stroke="currentColor"`):
  - **Level 1–3 (Cyan Tier)**: Three vertical rectangular slots (`x=38, 151, 262`, `y=38`, `w=75/76`, `h=302`, `stroke-miterlimit="8"`). Active slots are filled with Slate Cyan `#9DC3E6`, inactive slots have `fill="none"`.
    - **Lv.1**: Rightmost slot filled `#9DC3E6`, left 2 slots hollow (`fill="none"`).
    - **Lv.2**: Right 2 slots filled `#9DC3E6`, leftmost slot hollow (`fill="none"`).
    - **Lv.3**: All 3 vertical slots filled `#9DC3E6`.
  - **Level 4–6 (Gold Slanted Tier)**: Three slanted hollow parallelogram slots leaning right (`M0 302 28.25 0 114 0 84.75 302Z` with `transform="matrix(-1 0 0 1 ... 38)"`). Active slots are filled with Golden Yellow `#FFD966`, inactive slots have `fill="none"`.
    - **Lv.4**: Rightmost slanted slot filled `#FFD966`, left 2 hollow (`fill="none"`).
    - **Lv.5**: Right 2 slanted slots filled `#FFD966`, leftmost hollow (`fill="none"`).
    - **Lv.6**: All 3 slanted slots filled `#FFD966`.
  - **Level 7 (Max Double Chevron)**: Two horizontal double chevrons spanning `y=38` to `y=340` (`M38 38 113.5 38 189 189 113.5 340 38 340 113.5 189Z` and `M189 38 264.5 38 340 189 264.5 340 189 340 264.5 189Z`), both fully filled with Golden Yellow `#FFD966` with `stroke="currentColor"`.

### 7. Alert & Diagnostics Badges (`IconCautionFill`, `IconError`)

- Warning shield / circular exclamation badge:
  - Low caution: Amber (`#F59E0B`)
  - Middle caution: Orange (`#F97316`)
  - Critical caution: Red (`#EF4444`)
- Critical error indicator (`IconError`): Red pill badge with exclamation alert (`#DC2626`).

---

## 08 / Ship & Equipment Modals (`src/components/ui/components/`)

Modal components follow a unified interactive pattern: a compact clickable trigger element paired with an accessible native HTML `<dialog class="modal">` enclosing a high-precision data table.

### 1. Ship Detail Modal (`ComponentShipModal` & `ComponentShipTable`)

- **Component Paths**:
  - Trigger & Modal Container: `src/components/ui/components/ship/ship-modal.tsx`
  - Internal ComponentShip: `src/components/ui/components/ship/ship.tsx`
  - Internal Stat Table: `src/components/ui/components/ship/ship-table.tsx`
- **Props**:
  - `mst_ship?: MstShip`
  - `ship?: Ship`
  - `mst_slot_items?: MstSlotItems`
  - `slot_items?: SlotItems`
  - `size: "xs" | "sm" | "md" | "lg" | "xl"`
  - `color?: string`
  - `name_flag?: boolean`
  - `empty_flag?: boolean`
- **Trigger Structure**:
  ```html
  <div class="w-full cursor-pointer" onClick={open_modal}>
    <div class="flex flex-nowrap w-full">
      <div>
        <IconShip ship_stype={mst_ship.stype} color={color} size={size} empty_flag={empty_flag} />
      </div>
      <div class="pl-3 truncate content-center cursor-inherit [class_size.name_text] [class_size.name_h]">
        {mst_ship.name}
      </div>
    </div>
  </div>
  ```
- **Modal Lifecycle**:
  - Opened via native `dialogRef?.showModal()`.
  - Closed via backdrop click or the native `<form method="dialog">` close button.
- **Ship Table Contents & Exact DOM Tree (`ComponentShipTable`)**:
  - **Header & Meta**: Ship Name, Current Level, Next EXP progress.
  - **Slots Section**: Equipment slots (S1..S5 + Extra Slot SE) displaying slotted gear modal (`ComponentEquipmentModal`), improvement level (`★+n`), plane proficiency rank, and onslot capacity. Locked slots render with a 45° diagonal military hatch texture (`bg-[size:16px_16px] bg-[image:repeating-linear-gradient(45deg,currentColor_0,currentColor_0.5px,transparent_0,transparent_50%)]`).
  - **12-Stat Status Table**:
    1. **Durability (HP)**: Current / Max with health status indicator.
    2. **Firepower**: Base firepower value with optional `+{accent}` special effect bonus.
    3. **Armor**: Defensive armor rating.
    4. **Torpedo**: Torpedo attack stat.
    5. **Evasion**: Evasion value.
    6. **Anti-Air**: AA defense rating.
    7. **Aircraft Installed**: Total aircraft capacity across all slots.
    8. **Anti-Submarine**: ASW rating.
    9. **Speed**: Velocity rating (`Slow` / `Fast` / `Fast+` / `Fastest`).
    10. **Reconnaissance**: Line-of-sight / LoS rating.
    11. **Range**: Attack range (`Short` / `Medium` / `Long` / `Very Long`).
    12. **Luck**: Luck stat (`luck_now` / `luck_max`).
  - **Exact DOM Tree (`ComponentShipTable`, size="sm")**:
    ```html
    <div class="cursor-default">
      <div class="flex justify-start">
        <h3 class="font-bold pl-2 truncate text-lg">{mst_ship.name}</h3>
        <div class="place-self-end pl-4 text-md">Lv. {ship.lv}</div>
        <div class="place-self-end pl-2 text-md">next {ship.exp[1]}</div>
      </div>
      <div class="pt-2">
        <table class="table table-sm">
          <caption class="truncate text-md">Slots</caption>
          <tbody>
            <!-- S1..S5 -->
            <tr class="flex rounded items-center w-full [hatch_if_locked]">
              <th class="flex-none w-4">S{index + 1}</th>
              <td class="flex-none w-12 ml-4 py-1 w-full">
                <ComponentEquipmentModal slot_item={slot} mst_slot_item={mst_slot} name_flag={true} size="sm" />
              </td>
            </tr>
            <!-- SE (Extra Slot) -->
            <tr class="flex rounded items-center [hatch_if_locked]">
              <th class="flex-none w-4">SE</th>
              <td class="flex-none w-12 ml-4 py-1 w-full">
                <ComponentEquipmentModal slot_item={slot_ex} mst_slot_item={mst_slot_ex} name_flag={true} size="sm" />
              </td>
            </tr>
          </tbody>
        </table>
        <div class="h-2" />
        <table class="table table-sm">
          <caption class="truncate text-md">Ship Status</caption>
          <tbody>
            <tr class="flex rounded">
              <th class="truncate flex-1 w-2">Durability</th>
              <td class="flex-none w-12 flex justify-end pr-4">{ship.maxhp}</td>
              <th class="truncate flex-1 w-2">Firepower</th>
              <td class="flex-none w-12 flex justify-end pr-4">
                <div class="indicator">
                  <span class="indicator-item indicator-bottom text-accent text-sm">+{bonus}</span>
                  {ship.karyoku[0]}
                </div>
              </td>
            </tr>
            <!-- 5 additional rows for Armor, Torpedo, Evasion, Anti-Air, Aircraft installed, ASW, Speed, Recon, Range, Luck -->
          </tbody>
        </table>
      </div>
    </div>
    ```

### 2. Equipment Detail Modal (`ComponentEquipmentModal` & `ComponentEquipmentTable`)

- **Component Paths**:
  - Trigger & Modal Container: `src/components/ui/components/equipment/equipment-modal.tsx`
  - Internal ComponentEquipment: `src/components/ui/components/equipment/equipment.tsx`
  - Internal Stat Table: `src/components/ui/components/equipment/equipment-table.tsx`
- **Props**:
  - `mst_slot_item?: MstSlotItem`
  - `slot_item?: SlotItem`
  - `ex_flag?: boolean`
  - `name_flag?: boolean`
  - `attr_onslot?: number`
  - `hide_onslot?: boolean`
  - `size: "xs" | "sm" | "md" | "lg" | "xl"`
  - `empty_flag?: boolean`
- **Trigger Structure**:
  ```html
  <div class="w-full cursor-pointer" onClick={open_modal}>
    <div class="flex flex-nowrap w-full">
      <div class="indicator">
        <span class="indicator-item">{levelTemplate}</span>
        <IconEquipment category_number={mst_slot_item.type[1]} icon_number={mst_slot_item.type[3]} size={size} empty_flag={empty_flag} />
      </div>
      <!-- Proficiency & Onslot (when not ex_flag and not compact) -->
      <div class="flex-none [class_size.proficiency_onslot_pl] [class_size.proficiency_onslot_mt]">
        <div class="flex items-center justify-center w-4 [class_size.proficiency_onslot_h]">
          <IconPlaneProficiency level={slot_item.alv} size="full" />
        </div>
        <div class="flex items-center justify-center w-4 cursor-inherit [class_size.proficiency_onslot_h] [class_size.onslot_text]">
          {attr_onslot}
        </div>
      </div>
      <!-- Name (when name_flag: true) -->
      <div class="pl-3 truncate content-center cursor-inherit [class_size.name_text] [class_size.name_h]">
        {mst_slot_item.name}
      </div>
    </div>
  </div>
  ```
- **Equipment Table Contents & Exact DOM Tree (`ComponentEquipmentTable`)**:
  - **Header**: Equipment Name, Improvement Level (`+{level}` in `text-accent`).
  - **12-Stat Signed Table**: Renders values through `signed_number(val)`: if non-zero, outputs `+{val}` or `-{val}`, else empty string `""`.
    1. **Firepower**: Signed numeric modifier (`+n` / `-n`).
    2. **Torpedo**: Torpedo modifier.
    3. **Bomb**: Dive-bombing modifier.
    4. **Anti-Air**: Anti-air combat modifier.
    5. **Anti-Submarine**: ASW modifier.
    6. **Reconnaissance**: LoS modifier.
    7. **Accuracy**: Hit probability modifier.
    8. **Evasion**: Evasion modifier.
    9. **Armor**: Protective armor modifier.
    10. **Anti-Bomber**: High-altitude bomber interception modifier (LBAS).
    11. **Interception**: Fighter interception modifier (LBAS).
    12. **Distance**: Combat operational radius.
  - **Exact DOM Tree (`ComponentEquipmentTable`, size="sm")**:
    ```html
    <div class="flex justify-start cursor-default">
      <h3 class="font-bold pl-3 truncate text-lg">{mst_slot_item.name}</h3>
      <div class="place-self-end pl-4 text-accent text-md">+{slot_item.level}</div>
    </div>
    <div class="pt-2 cursor-default">
      <table class="table table-sm">
        <caption class="truncate pb-2 text-md">Equipment Status</caption>
        <tbody>
          <tr class="flex rounded">
            <th class="truncate flex-1 w-2">Firepower</th>
            <td class="flex-none w-12 flex justify-end pr-4">{signed_number(houg)}</td>
            <th class="truncate flex-1 w-2">Torpedo</th>
            <td class="flex-none w-12 flex justify-end pr-4">{signed_number(raig)}</td>
          </tr>
          <tr class="flex rounded">
            <th class="truncate flex-1 w-2">Bomb</th>
            <td class="flex-none w-12 flex justify-end pr-4">{signed_number(baku)}</td>
            <th class="truncate flex-1 w-2">Anti-Air</th>
            <td class="flex-none w-12 flex justify-end pr-4">{signed_number(tyku)}</td>
          </tr>
          <tr class="flex rounded">
            <th class="truncate flex-1 w-2">Anti-Submarine</th>
            <td class="flex-none w-12 flex justify-end pr-4">{signed_number(tais)}</td>
            <th class="truncate flex-1 w-2">Reconnaissance</th>
            <td class="flex-none w-12 flex justify-end pr-4">{signed_number(saku)}</td>
          </tr>
          <tr class="flex rounded">
            <th class="truncate flex-1 w-2">Accuracy</th>
            <td class="flex-none w-12 flex justify-end pr-4">{signed_number(houm)}</td>
            <th class="truncate flex-1 w-2">Evasion</th>
            <td class="flex-none w-12 flex justify-end pr-4">{signed_number(houk)}</td>
          </tr>
          <tr class="flex rounded">
            <th class="truncate flex-1 w-2">Armor</th>
            <td class="flex-none w-12 flex justify-end pr-4">{signed_number(souk)}</td>
            <th class="truncate flex-1 w-2">Anti-Bomber</th>
            <td class="flex-none w-12 flex justify-end pr-4">{signed_number(taibaku)}</td>
          </tr>
          <tr class="flex rounded">
            <th class="truncate flex-1 w-2">Interception</th>
            <td class="flex-none w-12 flex justify-end pr-4">{signed_number(geigeki)}</td>
            <th class="truncate flex-1 w-2">Distance</th>
            <td class="flex-none w-12 flex justify-end pr-4">{signed_number(distance)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    ```

### 3. Enemy / Masked Ship Modal (`ComponentShipMaskedModal` & `ComponentShipMaskedTable`)

- **Component Paths**:
  - Trigger & Modal Container: `src/components/ui/components/ship-masked/ship-masked-modal.tsx`
  - Internal ComponentShipMasked: `src/components/ui/components/ship-masked/ship-masked.tsx`
  - Masked Table: `src/components/ui/components/ship-masked/ship-masked-table.tsx`
- **Design Intent**: Used for hostile Abyssal fleets during sortie and combat simulation where complete intelligence is unavailable.
- **Stat Masking Rules**:
  - **Revealed Combat Stats**: Durability (HP), Firepower, Armor, Torpedo, and Anti-Air are extracted from the master ship data and displayed accurately.
  - **Masked Unknown Stats**: Evasion, Aircraft Installed, Anti-Submarine, Speed, Reconnaissance, Range, and Luck are explicitly rendered as `"unknown"` in default table cell typography (`<td class="flex-none w-12 flex justify-end pr-4">unknown</td>`).

---

## 09 / Fleet & Deck Layout Architecture (`DeckComponent`)

In production (`src/pages/app.tsx`), the operational panels are rendered inside a unified DaisyUI menu container:
`<ul class="menu menu-xs bg-base-100 w-full pl-0 flex pt-0">`.

The fleet deck table (`src/components/deck_port/deck.tsx` and `decks.tsx`) organizes ship records into a dense, high-throughput 11-column flex hierarchy:

```text
+--------------+---+---------+---+--------+---+-------+---+--------------------------+---+-----+
|  Ship Modal  | | |  Cond   | | |   HP   | | | Fuel/ | | |   Equipment Slots (1-5)  | | | Extra|
| (Icon+Name+Lv)| | |(Kira/Ct)| | | (Color | | | Ammo  | | |  (Gear Modals / Slashes) | | | Slot|
|              | | | [Badge] | | |  Bar)  | | |(Bars) | | |                          | | | (SE)|
+--------------+---+---------+---+--------+---+-------+---+--------------------------+---+-----+
```

### DOM Structure & Column Specifications

Each deck item is structured as:
```html
<li>
  <details open>
    <summary class="flex">
      <div class="w-20 flex-none">{fleet_name}</div>
      <div class="w-4 flex-none -mx-4"><IconChevronRightS class="h-4 w-4" /></div>
      <div class="pl-4">{deck_name}</div>
      <span class="flex-auto" />
    </summary>
    <ul class="pl-0">
      <li class="h-auto">
        <a class="justify-start gap-x-0 gap-y-1 flex flex-wrap">
          <div class="justify-start gap-0 flex">
            <!-- 11 Columns -->
          </div>
        </a>
      </li>
    </ul>
  </details>
</li>
```

1. **Ship Modal Trigger (`pl-2 pr-0.5 truncate flex-1 min-w-12 content-center` -> `w-[106px] h-max`)**:
   - Houses `ComponentShipModal` with ship name truncated to prevent table column overflow.
2. **Vertical Divider (`divider divider-horizontal mr-0 ml-0 flex-none`)**:
   - Thin DaisyUI separator maintaining spatial separation between operational metrics.
3. **Condition / Morale Indicator (`flex-none` -> `flex justify-center w-8 indicator`)**:
   - Contains a fixed-width `badge badge-md border-base-300 w-9`.
   - High Morale (>= 50): Accompanied by `IconKira` (1 to 3 stars based on cond score).
   - Low Morale (<= 29 / 19): Accompanied by `IconCautionFill` with amber or red warning state.
4. **Vertical Divider (`divider divider-horizontal mr-0 ml-0 flex-none`)**
5. **HP Health Meter (`indicator` -> `w-16 text-xs`)**:
   - Stacked indicator for caution warning icon when damaged, and `ComponentColorBarLabel size="xs"`.
6. **Vertical Divider (`divider divider-horizontal mr-0 ml-0 flex-none`)**
7. **Fuel & Ammo Supply Meters (`indicator` -> `flex-none my-auto`)**:
   - Contains `grid w-8 place-content-center space-y-1` with two stacked `ComponentColorBar size="xs"` elements (`w-8 text-xs`) representing remaining Fuel (top) and Ammo (bottom) supplies.
8. **Vertical Divider (`divider divider-horizontal mr-0 ml-0`)**
9. **Spacer (`w-[4px]`)**
10. **Equipment Slots 1 through 5 (`grid grid-cols-5 gap-2 content-center w-60`)**:
    - Active slots: Rendered inside `<div class="text-base flex justify-center">` containing `ComponentEquipmentModal size="xs"` with centered gear icon, level badge, and proficiency/onslot.
    - Empty unlocked slots: Rendered inside `<div class="text-base flex justify-center">` with `empty_flag={true}`.
    - Locked slots (e.g. ship only possesses 3 or 4 slots): Styled with the `.back_slash_color` military diagonal hatch:
      ```css
      .back_slash_color {
        background-size: 16px 16px;
        background-position: top left;
        background-image: repeating-linear-gradient(45deg, currentColor 0, currentColor 0.5px, transparent 0, transparent 50%);
      }
      ```
11. **Vertical Divider (`divider divider-horizontal mr-0 ml-0`)**
12. **Extra Slot / Slot Expansion (`content-center` -> `<div class="text-base flex justify-center w-8">`)**:
    - Houses the supplementary gear slot (`SE`) for specialized auxiliary equipment (`ComponentEquipmentModal size="xs"`).

---

## 10 / Combat Systems & Battle Summary

In production (`src/components/battles/battles.tsx`), combat operations are organized into an integrated view under `<ul class="menu menu-xs bg-base-100 w-full pl-0 flex pt-0">`:

### 1. Combat Header & Phase Indicators

1. **Map Header**:
   - `<summary class="flex">Battles<IconChevronRightS class="h-4 w-4" /><div>Map : {maparea_id}-{mapinfo_no}</div><span class="flex-auto" /></summary>`.
2. **Cell Route Selection**:
   - Horizontal navigation bar: `<div class="flex flex-row pl-2 items-center"><div class="h-4 mt-px pt-px text-xs">cells</div><IconChevronRightS class="h-4 w-4 m-1" /><button class="btn btn-xs btn-square rounded-none">A</button>...`.
3. **Search Status**:
   - Inline indicator (`battles.tsx`): `Search : <div class="text-lime-500">Enemy in sight; Accuracy &amp; Evacuation Up</div>` (or corresponding reconnaissance status / `___` fallback).
4. **Formations & Form**:
   - Inline tactical indicator: `<FormationComponent formation={battle?.formation} />` + `divider divider-horizontal mr-0 ml-0` + `Form : <div class="text-lime-500">Crossing the T (Advantage)</div>`.
5. **Tactical Consumables & Air Assets**:
   - `Smoke Type : _` (or `Signle` / `Double` / `Triple`) + `divider` + `Combat Ration : _` + `divider` + `Balloon : launched`.

### 2. Battle Summary Table (`BattleSummaryComponent`, `src/components/battles/battle/battle_summary.tsx`)

Rendered as a unified `<table class="table table-xs">` inside `<details open><summary>Summary</summary><ul class="pl-0">` with exactly 6 table columns:

| Column | Header | Width | Content |
| :--- | :--- | :--- | :--- |
| **Col 1** | `Own Main` | `w-2/10` | Green `IconFleetNumber` (`e_flag={0}`) + `ComponentShipModal` |
| **Col 2** | `HP` | `w-2/10` | `ComponentColorBarLabel size="xs"` |
| **Col 3** | `Damage` | `w-1/10` | Numeric damage dealt (`my-auto text-sm`) |
| **Col 4** | `Enemy Main` | `w-2/10` | Red `IconFleetNumber` (`e_flag={1}`) + `ComponentShipMaskedModal` |
| **Col 5** | `HP` | `w-2/10` | `ComponentColorBarLabel size="xs"` |
| **Col 6** | `Damage` | `w-1/10` | Numeric damage dealt (`my-auto text-sm`) |

### 3. Aerial Combat Phases

FUSOU-APP renders dedicated sequential combat phases for aerial operations under the Battles menu tree:

#### A. Land-Based Air Attack (`AirBaseAirAttackComponent`, `src/components/battles/battle/air_base_air_attack.tsx`)

- **Structure**: Rendered inside `<li><details open><summary>Air Base Air Attack</summary><ul class="pl-0">`.
- **Tactical Header Bar**:
  ```html
  <div class="flex flex-nowrap pl-2 items-center text-xs">
    touch : <span class="w-1" />
    <div class="w-6 flex justify-center">
      <!-- Friendly Touch Plane: ConnectedCIMstEquip (w-6 overflow-hidden) or '_' -->
    </div>
    <div class="w-3 text-center">/</div>
    <div class="w-6 flex justify-center">
      <!-- Enemy Touch Plane: ConnectedCIMstEquip (w-6 overflow-hidden) or '_' -->
    </div>
    <div class="divider divider-horizontal mr-0 ml-0" />
    <!-- Sprite Flight & Loss Counts: SpriteMotionCounts -->
    <span class="text-xs">Sprite - Fly: 18/0, Crash: 0/0, Damage: 0/0, Non-Normal: 0/0</span>
  </div>
  ```
- **Air Base Attack Table**:
  `<table class="table table-xs">` with exactly 6 columns:
  `<thead><tr><th class="w-2/8">Attack</th><th class="w-1/8">HP</th><th class="w-2/8">Defense</th><th class="w-1/8">HP</th><th class="w-1/8">Damage</th><th class="w-1/8" /></tr></thead>`
  - **Attack (`w-2/8`)**: Vertical list of attacking land-based squadron aircraft (`ConnectedOwnPlaneEquip` -> `ComponentEquipmentMstModal` with `compact={false}` and equipment icon + name only; no proficiency badge or onslot count).
  - **HP (`w-1/8`)**: Empty cell `<td />` (air bases do not carry per-plane HP bars).
  - **Defense (`w-2/8`)**: Defending enemy ships (`ConnectedNumberedEnemyShip`). If protected by an escorting ship, renders `<IconShield class="h-4 self-center ml-auto" />`.
  - **HP (`w-1/8`)**: Enemy ship HP gauge (`ConnectedEnemyShipHP` / `ComponentColorBarLabel size="xs"`).
  - **Damage (`w-1/8`)**: Damage values rendered via `DamageCommonComponent` (`text-yellow-500` for critical hits).

#### B. Opening Aerial Combat (`OpeningAirAttackComponent`, `src/components/battles/battle/opening_air_attack.tsx`)

- **Structure**: Rendered inside `<li><details open><summary>Opening Air Attack</summary><ul class="pl-0">`.
- **Tactical Header Bar**:
  ```html
  <div class="pl-2 text-xs flex flex-nowrap items-center">
    <!-- Air Superiority State -->
    Air State : <div class="text-lime-500 pl-1">Air Supremacy</div>
    <div class="divider divider-horizontal mr-0 ml-0" />
    <!-- Touch Aircraft -->
    touch : <span class="w-1" />
    <div class="w-6 flex justify-center">
      <div class="w-6 overflow-hidden">
        <!-- ConnectedCIMstEquip (e.g. 零式水上偵察機11型乙(熟練)) or '_' -->
      </div>
    </div>
    <div class="w-3 text-center">/</div>
    <div class="w-6 flex justify-center">_</div>
    <div class="divider divider-horizontal mr-0 ml-0" />
    <!-- Anti-Air Cut-in (AACI) -->
    CI : <span class="w-1" />
    <div class="flex justify-center">
      <div class="w-24">
        <!-- ConnectedOwnShip name (e.g. Fletcher Kai) or '___' -->
      </div>
      <div class="w-1" />
      <!-- ConnectedCIMstEquip items used for AACI (e.g. 5inch dual gun + radar) -->
    </div>
    <div class="divider divider-horizontal mr-0 ml-0" />
    <!-- Sprite Flight & Loss Counts: SpriteMotionCounts -->
    <span class="text-xs">Sprite - Fly: 12/8, Crash: 0/2, Damage: 1/0, Non-Normal: 0/0</span>
  </div>
  ```
- **Opening Air Attack Table**:
  `<table class="table table-xs">` with exactly 6 columns:
  `<thead><tr><th class="w-2/8">Attack</th><th class="w-1/8">HP</th><th class="w-2/8">Defense</th><th class="w-1/8">HP</th><th class="w-1/8">Damage</th><th class="w-1/8" /></tr></thead>`
  - **Row 1 (Friendly Strike Wave)**:
    - Attackers (`f_attacker_ships`): Participating friendly carrier/cruiser ships (`ConnectedNumberedOwnShip`).
    - Attacker HPs (`f_attacker_hps`): `ConnectedOwnShipHP` (`ComponentColorBarLabel size="xs"`).
    - Defenders (`e_defenser_ships`): Enemy ships targeted by torpedo and dive bombers (`ConnectedNumberedEnemyShip`), including `<IconShield class="h-4 self-center ml-auto" />` when protected.
    - Defender HPs (`e_defenser_hps`): `ConnectedEnemyShipHP` (`ComponentColorBarLabel size="xs"`).
    - Damage (`e_defenser_damages`): `DamageCommonComponent` values.
  - **Row 2 (Enemy Counter-Strike Wave)**:
    - Attackers (`e_attacker_ships`): Participating enemy carriers.
    - Attacker HPs (`e_attacker_hps`): Enemy carrier HPs.
    - Defenders (`f_defenser_ships`): Friendly ships targeted by enemy air strike.
    - Defender HPs (`f_defenser_hps`): Friendly ship HPs.
    - Damage (`f_defenser_damages`): Damage received (`text-red-500` for 0 damage scratch hits).

### 4. Air State Readout (`AirStateComponent`, `src/components/battles/shared/air_state.tsx`)

Rendered as an inline status readout:
```html
Air State : <div class="{class}">{label}</div>
```

- `0`: `Air Supremacy` (制空権確保, `class: "text-lime-500 pl-1"`)
- `1`: `Air Superiority` (航空優勢, `class: "text-lime-500 pl-1"`)
- `2`: `Air Parity` (航空互角 / 均衡, `class: "text-yellow-500 pl-1"`)
- `3`: `Air Denial` (航空劣勢, `class: "text-orange-500 pl-1"`)
- `4`: `Air Incapability` (制空権喪失, `class: "text-red-500 pl-1"`)

### 5. Tactical Formations (`FormationComponent`, `src/components/battles/shared/formation.tsx`)

Rendered as an inline tactical formation indicator:
```html
Formation : <span class="w-1" /><div class="text-lime-500">{friendly}</div><div class="w-3 text-center">/</div><div class="text-red-500">{enemy}</div>
```

- **Standard Formations**: `Line Ahead` (単縦陣), `Double Line` (複縦陣), `Diamond` (輪形陣), `Echelon` (梯形陣), `Line Abreast` (単横陣), `Vanguard` (警戒陣).
- **Cruising Formations**: `1st cruising formation` through `4th cruising formation` (第1〜第4警戒航行序列).

### 6. Combat Damage Readout (`DamageCommonComponent`, `src/components/battles/dmg.tsx`)

Rendered as:
```html
<div class="h-6 text-sm content-center {color}">{dmg}</div>
```

- **Critical Damage (`cl_flag == 2`)**: Golden yellow (`text-yellow-500`).
- **Normal Penetration (`cl_flag == 1`)**: Standard text (`""`).
- **Scratch / Muted Damage / Miss (`cl_flag == 0 || dmg == 0`)**: Red (`text-red-500`).

### 7. Sprite Motion & Loss Readout (`SpriteMotionCounts`, `src/components/battles/shared/sprite_motion_counts.tsx`)

Rendered as an inline summary of aircraft sprite trajectories and anti-air attrition during aerial combat phases:
```html
<span class="text-xs">
  Sprite - Fly: {f_fly}/{e_fly}, Crash: {f_crash}/{e_crash}, Damage: {f_damage}/{e_damage}, Non-Normal: {f_non_normal}/{e_non_normal}
</span>
```

---

## 11 / Base Operations: LBAS, Materials & Quests

### 1. Land-Based Air Corps (`AirBasesComponent`, `src/components/airbase/air_bases.tsx`)

Organized under `ul.menu.menu-xs` by base squadron:
- **Base Summary**: `<summary class="flex">{map}-{area} <IconChevronRightS /> {name} <divider /> R : {distance} <divider /> {action}</summary>`.
- **Action Statuses**: `Standby` (待機), `Sortie` (出撃), `Defense` (防空), `Evacuation` (退避), `Rest` (休息).
- **Squadron Plane Rows**:
  - Each plane row is `li.h-auto > a.justify-start.gap-x-0.gap-y-1.flex.flex-wrap > div.justify-start.gap-0.flex` containing:
    - Equipment modal wrapper: `<div class="pl-2 pr-0.5 flex-1 min-w-12 content-center" style="overflow-x: clip; overflow-clip-margin: content-box 4px;"><div class="w-58"><ComponentEquipmentModal size="xs" attr_onslot={n} name_flag={true} ... /></div></div>`.
    - Authentic Gear Capsule:
      - Land Attacker (`LA`): Primary stripe `#39B74E`, secondary stripe `#38B012`, backing dark bar `M27.5 124 124.5 124`, 8 diagonal slashes `bg_slash`.
      - Interceptor (`IN`): Primary stripe `#39B74E`, secondary stripe `#87D296`, backing dark bar `M27.5 124 124.5 124`, 8 diagonal slashes `bg_slash`.
      - Equipment name (`ComponentEquipment`): `pl-3 truncate content-center cursor-inherit text-md h-6`.
    - Vertical divider: `<div class="divider divider-horizontal mr-0 ml-0 flex-none" />`.
    - Aircraft condition & status badge:
      ```html
      <div class="flex-none">
        <div class="flex justify-center w-8 indicator">
          <div class="indicator-item indicator-top indicator-end">
            <!-- IconCautionFill for cond=2 (level="middle", orange) or cond=3 (level="high", red) -->
            <div class="h-4 w-4"><IconCautionFill level="middle" size="full" /></div>
          </div>
          <div class="badge badge-md border-base-300 w-9 text-nowrap">--</div>
        </div>
      </div>
      ```

### 2. Materials & Logistics Tracker (`MaterialsComponent`, `src/components/materials/materials.tsx`)

Rendered inside `ul.menu.menu-xs` as:
`<li class="h-auto"><div class="justify-start gap-0 flex flex-nowrap"><div class="w-[24px]" /><div class="justify-start gap-0 flex flex-wrap gap-y-1"><div class="justify-start gap-0 flex flex-nowrap">`

A persistent 8-resource horizontal strip tracking fleet logistical reserves in exact index order (`icon_material_converter`):

| Array Index | Resource Code | Resource Name | Badge Item Number | Indicator Color (`material.tsx`) |
| :--- | :--- | :--- | :--- | :--- |
| 0 | `A0` | Fuel | `31` | Yellow (`#CCCC00`) |
| 1 | `B0` | Ammo | `32` | Yellow (`#CCCC00`) |
| 2 | `C0` | Steel | `33` | Yellow (`#CCCC00`) |
| 3 | `D0` | Bauxite | `34` | Yellow (`#CCCC00`) |
| 4 | `B3` | Instant Construction (Flamethrower) | `2` | Brown (`#684329`) |
| 5 | `A3` | Instant Repair (Bucket) | `1` | Brown (`#684329`) |
| 6 | `C3` | Development Material | `3` | Brown (`#684329`) |
| 7 | `C1` | Improvement Material (Screw) | `4` | Brown (`#684329`) |

Each item displays `<IconMaterial item_number={id} size="full" />` (20x20px), followed by `<div class="w-10 flex justify-end pt-0.5">{count}</div>` and `<div class="divider divider-horizontal mr-0 ml-0" />`.

### 3. Quests & Missions Tracker (`QuestsComponent`, `src/components/quests/quests.tsx`)

Rendered inside `ul.menu.menu-xs` with `<ul class="pl-0 max-w-[960px]">`:
- **Accepted Quests Header**: `<li class="text-xs px-2 py-1 font-semibold text-base-content/80">Accepted (N)</li>`
- **Available Quests Header**: `<li class="text-xs px-2 py-1 font-semibold text-base-content/80 mt-2">Available (N)</li>`
- **Quest Card Structure**:
  ```html
  <li class="text-xs py-1 w-full justify-between items-start gap-3">
    <div class="px-2 items-start gap-2 w-150">
      <div class="flex flex-col gap-0.5">
        <span class="w-8 shrink-0 text-base-content/70 text-right">[{no}]</span>
        <span class="w-8 text-right shrink-0 text-base-content/60">{progressLabel}</span>
      </div>
      <div class="min-w-0 flex-1">
        <div class="truncate">{title}</div>
        <div class="text-[11px] text-base-content/60 whitespace-pre-wrap wrap-break-word mt-0.5">{detail}</div>
      </div>
    </div>
  </li>
  ```
- **Progress Flags**:
  - `0`: `0%`
  - `1`: `50%`
  - `2`: `80%`
  - `3`: `100%`

---

## 12 / Component Catalog & Storybook Directory Structure

```text
src/
├── pages/
│   ├── design-system.tsx     # Live Component Catalog & Design System Page (13 Sections)
│   ├── app.tsx               # Main Desktop Operations
│   ├── start.tsx             # Startup & Connectivity Screen
│   ├── debug.tsx             # Debug API & Directory Inspector
│   ├── update.tsx            # Updater UI
│   ├── policy.tsx            # Communication Integrity Policy
│   └── not_found.tsx         # 404 Error Screen
├── components/
│   ├── ui/
│   │   ├── titlebar.tsx      # Custom frameless titlebar
│   │   ├── window_resize_borders.tsx # Frameless window resize borders
│   │   ├── components/       # ColorBar, Ship, Equipment, Modals
│   │   │   ├── bar/          # ColorBar, ColorBarLabel
│   │   │   ├── ship/         # ComponentShipModal, ComponentShipTable
│   │   │   ├── equipment/    # ComponentEquipmentModal, ComponentEquipmentTable
│   │   │   └── ship-masked/  # ComponentShipMaskedModal, ComponentShipMaskedTable
│   │   └── icons/            # SVG Vector Icons (Ship, Equipment, Material, FleetNumber, Kira, etc.)
│   ├── deck_port/            # Decks & Ship Slots (DeckComponent, DecksComponent)
│   ├── battles/              # Battle Simulation & Combat Phases (BattleSummary, OpeningAirAttack)
│   ├── airbase/              # Land-based Air Base (AirBasesComponent)
│   ├── quests/               # Quests Tracker (QuestsComponent)
│   ├── materials/            # Resource Tracker (MaterialsComponent)
│   ├── logger/               # Log Viewer (Virtua Virtualized Logger)
│   └── settings/             # Settings, Theme, Data Collection
└── stories/
    ├── design_system/        # Design System Tokens & Overview Stories
    ├── ui/                   # Titlebar & Window Stories
    ├── deck_port/            # Deck Stories
    ├── battles/              # Battle & Combat Stories
    ├── airbase/              # Airbase Stories
    ├── quests/               # Quests Stories
    ├── materials/            # Materials Stories
    ├── logger/               # Log Viewer Stories
    ├── settings/             # Settings & Theme Stories
    └── pages/                # Page-level Stories (App, Start, Debug, Policy, DesignSystem)
```

---

## 13 / Non-Tauri & Storybook Compatibility Rules

1. **IPC Call Isolation**:
   - Never call `invoke(...)` or `listen(...)` nakedly at module scope or without error handling.
   - Always use `safeTauriListen(...)` for subscriptions, and wrap Tauri window calls in `isTauri()` checks or `.catch(...)`.
2. **Mock Data Availability**:
   - Components requiring Solid Stores/Contexts must always support fallback states or provider wrappers so that Storybook stories and the Component Catalog render smoothly without throwing errors.
3. **Cross-Platform Catalog Parity**:
   - The desktop catalog (`packages/FUSOU-APP/src/pages/design-system.tsx`) and the web catalog (`packages/FUSOU-WEB/src/pages/design-system/app.astro`) must maintain 1:1 structural parity across all 13 sections, sharing identical visual hierarchy and component nomenclature.
