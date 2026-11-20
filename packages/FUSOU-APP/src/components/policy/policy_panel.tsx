import { For, Show } from "solid-js";

type PolicyPanelProps = {
  showBackLink?: boolean;
};

const POLICY_ITEMS = [
  {
    ja: "通信を観測専用で扱う設計です",
    en: "Read-only observation of in-game traffic",
  },
  {
    ja: "通信内容を改変しない設計です",
    en: "No packet modification; pass-through only",
  },
  {
    ja: "ゲームサーバーへ追加通信を行わない設計です",
    en: "No extra requests sent to game servers",
  },
  {
    ja: "チート・マクロ機能を含まない設計です",
    en: "No cheat or macro automation functionality",
  },
  {
    ja: "パケット改変・スプーフィングを行わない設計です",
    en: "No packet spoofing or identity falsification",
  },
] as const;

export function PolicyPanelComponent(props: PolicyPanelProps) {
  return (
    <div class="bg-base-100 min-h-full">
      <div class="max-w-4xl mx-auto px-6 py-6 space-y-6">
        <Show when={props.showBackLink}>
          <div>
            <a href="/app" class="btn btn-ghost btn-sm gap-1.5">
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
          </div>
        </Show>

        <header class="space-y-1">
          <h1 class="text-2xl font-bold tracking-tight">通信保全基準</h1>
          <p class="text-sm text-base-content/65">
            Communication Integrity Policy
          </p>
        </header>

        {/* Design Principles */}
        <section class="space-y-2.5">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-base-content/60">
            設計方針 · Design Principles
          </h2>
          <div class="bg-base-100 rounded-box border border-base-300 divide-y divide-base-300">
            <div class="p-4">
              <p class="text-sm text-base-content/75 leading-relaxed">
                FUSOU APP はゲーム通信を観測して情報を表示するツールです。
                以下は本ツールの設計方針であり、運用上の指針として公開しています。
              </p>
            </div>

            <div class="p-4 space-y-2.5">
              <For each={POLICY_ITEMS}>
                {(item) => (
                  <div class="flex items-start gap-3 p-3 bg-success/10 rounded-box border border-success/20">
                    <span class="text-success font-bold text-base mt-0.5 shrink-0">
                      ✓
                    </span>
                    <div class="min-w-0">
                      <p class="text-sm font-medium">{item.ja}</p>
                      <p class="text-xs text-base-content/60 mt-0.5">
                        {item.en}
                      </p>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </section>

        {/* Contact */}
        <section class="space-y-2.5">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-base-content/60">
            お問い合わせ · Contact
          </h2>
          <div class="bg-base-100 rounded-box border border-base-300 p-4 space-y-3">
            <p class="text-xs text-base-content/65 leading-relaxed">
              バグ報告・機能要望・利用方針に関するお問い合わせは以下から受け付けています。
            </p>
            <div class="flex flex-wrap gap-2">
              <a
                href="https://github.com/tsukasa-u/FUSOU/issues/new"
                class="btn btn-secondary enabled:border-secondary-content btn-sm w-full sm:w-48"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub Issues
              </a>
              <a
                href="https://wavebox.me/wave/byvjx7nrs7350t54/"
                class="btn btn-primary enabled:border-primary-content btn-sm w-full sm:w-48"
                target="_blank"
                rel="noopener noreferrer"
              >
                Wavebox
              </a>
            </div>
          </div>
        </section>

        {/* Copyright */}
        <section class="space-y-2.5">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-base-content/60">
            著作権について · Copyright
          </h2>
          <div class="bg-base-100 rounded-box border border-base-300 p-4">
            <p class="text-xs text-base-content/65 leading-relaxed">
              本ツールで使用する画像・データは著作権法第32条に基づき引用しています。著作権は各権利者に帰属します。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
