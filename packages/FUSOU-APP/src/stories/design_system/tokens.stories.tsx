import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta: Meta = {
  title: "Design System/Tokens & Palette",
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj;

export const BrandPalette: Story = {
  render: () => (
    <div class="space-y-6 max-w-4xl text-base-content">
      <div>
        <h2 class="text-xl font-bold tracking-tight">
          FUSOU-APP Theme &amp; Operational Tokens
        </h2>
        <p class="text-xs text-base-content/60 mt-1">
          <code>src/global.css</code> DaisyUI 5 OKLCH
          テーマトークン・Titlebar・ステータスカラー
        </p>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div class="card bg-base-100 border border-base-300 p-4">
          <div class="h-12 rounded-box mb-2 border border-base-300 bg-primary" />
          <div class="font-bold text-sm">Primary (Mint Green)</div>
          <div class="text-xs font-mono text-base-content/60">
            oklch(87% 0.15 154.449)
          </div>
          <div class="text-[11px] text-base-content/50 mt-1">
            Primary CTA &amp; active toggles
          </div>
        </div>

        <div class="card bg-base-100 border border-base-300 p-4">
          <div class="h-12 rounded-box mb-2 border border-base-300 bg-accent" />
          <div class="font-bold text-sm">Accent (Cyan)</div>
          <div class="text-xs font-mono text-base-content/60">
            oklch(86% 0.127 207.078)
          </div>
          <div class="text-[11px] text-base-content/50 mt-1">
            Equipment improvement (+n) &amp; highlights
          </div>
        </div>

        <div class="card bg-base-100 border border-base-300 p-4">
          <div class="h-12 rounded-box mb-2 border border-base-300 bg-warning" />
          <div class="font-bold text-sm">Warning</div>
          <div class="text-xs font-mono text-base-content/60">
            oklch(70% 0.213 47.604)
          </div>
          <div class="text-[11px] text-base-content/50 mt-1">
            WARN badges &amp; alerts
          </div>
        </div>

        <div class="card bg-base-100 border border-base-300 p-4">
          <div class="h-12 rounded-box mb-2 border border-base-300 bg-error" />
          <div class="font-bold text-sm">Error</div>
          <div class="text-xs font-mono text-base-content/60">
            oklch(63% 0.237 25.331)
          </div>
          <div class="text-[11px] text-base-content/50 mt-1">
            Fatal errors &amp; close hover (#ef4444)
          </div>
        </div>
      </div>

      <div class="mt-6">
        <h3 class="text-sm font-semibold mb-3">
          Surfaces &amp; Titlebar Chrome
        </h3>
        <div class="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
          <div class="bg-base-100 border border-base-300 p-2.5 rounded-box">
            <div class="h-8 rounded mb-1.5 border border-base-300 bg-base-100" />
            <div class="font-semibold truncate">base-100/200</div>
            <div class="font-mono text-[10px] text-base-content/60">
              Dark: 21.6% OKLCH
            </div>
          </div>
          <div class="bg-base-100 border border-base-300 p-2.5 rounded-box">
            <div class="h-8 rounded mb-1.5 border border-base-300 bg-base-300" />
            <div class="font-semibold truncate">base-300</div>
            <div class="font-mono text-[10px] text-base-content/60">
              Dark: 27% OKLCH
            </div>
          </div>
          <div class="bg-base-100 border border-base-300 p-2.5 rounded-box">
            <div
              class="h-8 rounded mb-1.5"
              style={{ "background-color": "#1d1c1c" }}
            />
            <div class="font-semibold truncate">Volume Popover</div>
            <div class="font-mono text-[10px] text-base-content/60">
              #1d1c1c
            </div>
          </div>
          <div class="bg-base-100 border border-base-300 p-2.5 rounded-box">
            <div
              class="h-8 rounded mb-1.5"
              style={{ "background-color": "#27272a" }}
            />
            <div class="font-semibold truncate">Titlebar</div>
            <div class="font-mono text-[10px] text-base-content/60">
              #27272a
            </div>
          </div>
          <div class="bg-base-100 border border-base-300 p-2.5 rounded-box">
            <div
              class="h-8 rounded mb-1.5"
              style={{ "background-color": "#96C54E" }}
            />
            <div class="font-semibold truncate">Logo &amp; Thumb</div>
            <div class="font-mono text-[10px] text-base-content/60">
              #B5D95A / #96C54E / #76B142
            </div>
          </div>
          <div class="bg-base-100 border border-base-300 p-2.5 rounded-box">
            <div
              class="h-8 rounded mb-1.5"
              style={{ "background-color": "#f1f5f9" }}
            />
            <div class="font-semibold truncate">Popover Ink</div>
            <div class="font-mono text-[10px] text-base-content/60">
              #f1f5f9 / #e5e7eb
            </div>
          </div>
        </div>
      </div>
    </div>
  ),
};

export const TypographyScale: Story = {
  render: () => (
    <div class="space-y-4 max-w-3xl text-base-content">
      <h2 class="text-xl font-bold border-b border-base-300 pb-2">
        タイポグラフィ階層
      </h2>

      <div class="border-b border-base-300/60 pb-3">
        <div class="text-[10px] font-mono text-base-content/50">
          Unified Page Heading (24px / 600 — Settings, Uploads, Policy, Start,
          Update, Debug)
        </div>
        <div class="text-2xl font-semibold">Settings / 通信保全基準</div>
      </div>

      <div class="border-b border-base-300/60 pb-3">
        <div class="text-[10px] font-mono text-base-content/50">
          Section / Card Heading (20px / 600 — settings.tsx /
          data_collection_status.tsx)
        </div>
        <div class="text-xl font-semibold">Manual Snapshot Sync</div>
      </div>

      <div class="border-b border-base-300/60 pb-3">
        <div class="text-[10px] font-mono text-base-content/50">
          Start Card Heading (18px / 600 — start.tsx)
        </div>
        <div class="text-lg font-semibold leading-4">Open App</div>
      </div>

      <div class="border-b border-base-300/60 pb-3">
        <div class="text-[10px] font-mono text-base-content/50">
          Body / Table Text (text-xs / default sans-serif)
        </div>
        <div class="text-xs leading-relaxed">
          DeckComponent・BattleSummaryComponent・MaterialsComponent・QuestsComponent
          はデフォルトフォントで高密度描画します。
        </div>
      </div>

      <div>
        <div class="text-[10px] font-mono text-base-content/50">
          Monospace Scopes (Roboto Mono SVG icons &amp; ErrorFallback /
          data_collection_status)
        </div>
        <div class="text-xs space-x-3">
          <span class="tabular-nums">80% (titlebar.tsx)</span>
          <span class="font-mono">ErrorFallback stacktrace</span>
          <span
            style={{
              "font-family": '"Roboto Mono", monospace',
              "font-weight": 500,
            }}
          >
            DD / CL / PA (SVG icons)
          </span>
        </div>
      </div>
    </div>
  ),
};
