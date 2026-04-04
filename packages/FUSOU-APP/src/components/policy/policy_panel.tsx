type PolicyPanelProps = {
  showBackLink?: boolean;
};

export function PolicyPanelComponent(props: PolicyPanelProps) {
  return (
    <div class="bg-base-200 min-h-full p-6">
      <div class="max-w-xl mx-auto">
        {props.showBackLink && (
          <div class="mb-6">
            <a href="/app" class="btn btn-ghost btn-sm gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
              アプリに戻る
            </a>
          </div>
        )}

        <h1 class="text-xl font-bold mb-1">通信保全基準</h1>
        <p class="text-sm text-base-content/50 mb-6">Communication Integrity Policy</p>

        <div class="bg-base-100 rounded-xl border border-base-300/60 p-6 mb-4">
          <p class="text-sm text-base-content/70 leading-relaxed mb-5">
            FUSOU APP はゲーム通信を観測して情報を表示するツールです。
            以下は本ツールの設計方針であり、運用上の指針として公開しています。
          </p>

          <div class="space-y-3">
            <div class="flex items-start gap-3 p-3 bg-success/8 rounded-lg border border-success/20">
              <span class="text-success font-bold text-base mt-0.5 shrink-0">✓</span>
              <div>
                <p class="text-sm font-medium">通信を観測専用で扱う設計です</p>
                <p class="text-xs text-base-content/50 mt-0.5">Read-only observation of in-game traffic</p>
              </div>
            </div>

            <div class="flex items-start gap-3 p-3 bg-success/8 rounded-lg border border-success/20">
              <span class="text-success font-bold text-base mt-0.5 shrink-0">✓</span>
              <div>
                <p class="text-sm font-medium">通信内容を改変しない設計です</p>
                <p class="text-xs text-base-content/50 mt-0.5">No packet modification; pass-through only</p>
              </div>
            </div>

            <div class="flex items-start gap-3 p-3 bg-success/8 rounded-lg border border-success/20">
              <span class="text-success font-bold text-base mt-0.5 shrink-0">✓</span>
              <div>
                <p class="text-sm font-medium">ゲームサーバーへ追加通信を行わない設計です</p>
                <p class="text-xs text-base-content/50 mt-0.5">No extra requests sent to game servers</p>
              </div>
            </div>

            <div class="flex items-start gap-3 p-3 bg-success/8 rounded-lg border border-success/20">
              <span class="text-success font-bold text-base mt-0.5 shrink-0">✓</span>
              <div>
                <p class="text-sm font-medium">チート・マクロ機能を含まない設計です</p>
                <p class="text-xs text-base-content/50 mt-0.5">No cheat or macro automation functionality</p>
              </div>
            </div>

            <div class="flex items-start gap-3 p-3 bg-success/8 rounded-lg border border-success/20">
              <span class="text-success font-bold text-base mt-0.5 shrink-0">✓</span>
              <div>
                <p class="text-sm font-medium">パケット改変・スプーフィングを行わない設計です</p>
                <p class="text-xs text-base-content/50 mt-0.5">No packet spoofing or identity falsification</p>
              </div>
            </div>
          </div>
        </div>

        <div class="bg-base-100 rounded-xl border border-base-300/60 p-6 mb-4">
          <h2 class="text-sm font-semibold mb-3">お問い合わせ</h2>
          <p class="text-xs text-base-content/60 mb-4">
            バグ報告・機能要望・利用方針に関するお問い合わせは以下から受け付けています。
          </p>
          <div class="flex flex-wrap gap-2">
            <a
              href="https://github.com/tsukasa-u/FUSOU/issues/new"
              class="btn btn-secondary border-secondary-content btn-wide"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub Issues
            </a>
            <a
              href="https://wavebox.me/wave/byvjx7nrs7350t54/"
              class="btn btn-primary border-primary-content btn-wide"
              target="_blank"
              rel="noopener noreferrer"
            >
              Wavebox
            </a>
          </div>
        </div>

        <div class="bg-base-100 rounded-xl border border-base-300/60 p-6">
          <h2 class="text-sm font-semibold mb-2">著作権について</h2>
          <p class="text-xs text-base-content/60 leading-relaxed">
            本ツールで使用する画像・データは著作権法第32条に基づき引用しています。著作権は各権利者に帰属します。
          </p>
        </div>
      </div>
    </div>
  );
}
