/* @jsxImportSource solid-js */
import { ShipSelectionModal } from "./ShipSelectionModal";
import { EquipSelectionModal } from "./EquipSelectionModal";
export function SimulatorModals() {
  return (
    <>
            <ShipSelectionModal />
      <EquipSelectionModal />

{/* Load Fleet Modal */}
      <dialog id="display-settings-modal" class="modal">
        <div class="modal-box rounded-xl">
          <h3 class="font-bold text-lg mb-2">表示設定</h3>
          <p class="text-xs text-base-content/60 mb-4">
            艦隊と基地航空隊の表示を切り替えます。
          </p>
          <div class="space-y-3 text-sm">
            <div class="grid grid-cols-2 gap-2">
              <label class="label cursor-pointer justify-start gap-2 py-0">
                <input
                  id="display-fleet-1"
                  type="checkbox"
                  class="checkbox checkbox-sm"
                  checked
                />
                <span class="label-text">第1艦隊を表示</span>
              </label>
              <label class="label cursor-pointer justify-start gap-2 py-0">
                <input
                  id="display-fleet-2"
                  type="checkbox"
                  class="checkbox checkbox-sm"
                  checked
                />
                <span class="label-text">第2艦隊を表示</span>
              </label>
              <label class="label cursor-pointer justify-start gap-2 py-0">
                <input
                  id="display-fleet-3"
                  type="checkbox"
                  class="checkbox checkbox-sm"
                  checked
                />
                <span class="label-text">第3艦隊を表示</span>
              </label>
              <label class="label cursor-pointer justify-start gap-2 py-0">
                <input
                  id="display-fleet-4"
                  type="checkbox"
                  class="checkbox checkbox-sm"
                  checked
                />
                <span class="label-text">第4艦隊を表示</span>
              </label>
            </div>
            <label class="label cursor-pointer justify-start gap-2 py-0">
              <input
                id="display-airbase"
                type="checkbox"
                class="checkbox checkbox-sm"
                checked
              />
              <span class="label-text">基地航空隊を表示</span>
            </label>
            <div class="form-control">
              <label class="label py-1"
                ><span class="label-text">連合艦隊タイプ</span></label
              >
              <select
                id="display-combined-fleet"
                class="select select-bordered select-sm w-52"
              >
                <option value="0">通常艦隊</option>
                <option value="1">機動部隊（第1＋第2）</option>
                <option value="2">水上打撃部隊（第1＋第2）</option>
                <option value="3">輸送護衛部隊（第1＋第2）</option>
              </select>
            </div>
            <div class="form-control">
              <label class="label py-1"
                ><span class="label-text">艦隊内スロット配置</span></label
              >
              <select
                id="display-fleet-slot-layout"
                class="select select-bordered select-sm w-40"
              >
                <option value="2x3" selected>2x3（縦長）</option>
                <option value="3x2">3x2（横長）</option>
              </select>
            </div>
            <div class="form-control">
              <label class="label py-1"
                ><span class="label-text">表示する基地航空隊数</span></label
              >
              <select
                id="display-airbase-count"
                class="select select-bordered select-sm w-36"
              >
                <option value="0">0</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3" selected>3</option>
              </select>
            </div>
          </div>
          <div class="modal-action">
            <button
              id="btn-display-settings-apply"
              type="button"
              class="btn btn-primary btn-sm">閉じる</button
            >
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>

      <dialog id="load-fleet-modal" class="modal">
        <div class="modal-box rounded-xl">
          <h3 class="font-bold text-lg mb-2">R2から自分のデッキを読込</h3>
          <p class="text-xs text-base-content/60 mb-4">
            選択したデッキはワークスペースに追加されます。
          </p>
          <div
            id="fleet-list-container"
            class="space-y-2 max-h-80 overflow-y-auto"
          >
            <span class="loading loading-spinner loading-sm"></span>
          </div>
          <div class="modal-action">
            <form method="dialog">
              <button class="btn btn-ghost btn-sm">閉じる</button>
            </form>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>

      {/* Save Image Modal */}
      <dialog id="save-image-modal" class="modal">
        <div class="modal-box rounded-xl">
          <h3 class="font-bold text-lg mb-4">画像保存設定</h3>
          <div class="space-y-3 text-sm">
            <div class="form-control">
              <label class="label py-1"
                ><span class="label-text">保存対象</span></label
              >
              <div class="flex flex-wrap gap-3">
                <label class="label cursor-pointer gap-2 py-0">
                  <input
                    type="radio"
                    name="saveimg-fleet-target"
                    class="radio radio-sm"
                    value="both"
                    checked
                  />
                  <span class="label-text">第1+第2艦隊</span>
                </label>
                <label class="label cursor-pointer gap-2 py-0">
                  <input
                    type="radio"
                    name="saveimg-fleet-target"
                    class="radio radio-sm"
                    value="fleet1"
                  />
                  <span class="label-text">第1艦隊のみ</span>
                </label>
                <label class="label cursor-pointer gap-2 py-0">
                  <input
                    type="radio"
                    name="saveimg-fleet-target"
                    class="radio radio-sm"
                    value="fleet2"
                  />
                  <span class="label-text">第2艦隊のみ</span>
                </label>
                <label class="label cursor-pointer gap-2 py-0">
                  <input
                    type="radio"
                    name="saveimg-fleet-target"
                    class="radio radio-sm"
                    value="fleet3"
                  />
                  <span class="label-text">第3艦隊のみ</span>
                </label>
                <label class="label cursor-pointer gap-2 py-0">
                  <input
                    type="radio"
                    name="saveimg-fleet-target"
                    class="radio radio-sm"
                    value="fleet4"
                  />
                  <span class="label-text">第4艦隊のみ</span>
                </label>
                <label class="label cursor-pointer gap-2 py-0">
                  <input
                    type="radio"
                    name="saveimg-fleet-target"
                    class="radio radio-sm"
                    value="airbase"
                  />
                  <span class="label-text">航空基地のみ</span>
                </label>
              </div>
            </div>
            <label class="label cursor-pointer justify-start gap-2 py-0">
              <input
                id="saveimg-include-airbase"
                type="checkbox"
                class="checkbox checkbox-sm"
                checked
              />
              <span class="label-text">基地航空隊を含める</span>
            </label>
            <label class="label cursor-pointer justify-start gap-2 py-0">
              <input
                id="saveimg-transparent-bg"
                type="checkbox"
                class="checkbox checkbox-sm"
              />
              <span class="label-text">背景を透過（PNG）</span>
            </label>
            <div class="form-control">
              <label class="label py-1"
                ><span class="label-text">画質倍率</span></label
              >
              <select id="saveimg-scale" class="select select-bordered select-sm">
                <option value="1">標準 (x1)</option>
                <option value="2" selected>高画質 (x2)</option>
                <option value="3">超高画質 (x3)</option>
              </select>
            </div>
            <div class="form-control">
              <label class="label py-1"
                ><span class="label-text">ファイル名</span></label
              >
              <input
                id="saveimg-filename"
                type="text"
                class="input input-bordered input-sm"
                value="fleet-deck"
              />
            </div>
          </div>
          <div class="modal-action">
            <button
              id="btn-save-image-confirm"
              type="button"
              class="btn btn-primary btn-sm">PNGで保存</button
            >
            <form method="dialog">
              <button class="btn btn-ghost btn-sm">キャンセル</button>
            </form>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>

      {/* Share Settings Modal */}
      <dialog id="share-settings-modal" class="modal">
        <div class="modal-box rounded-xl">
          <h3 class="font-bold text-lg mb-2">共有URL設定</h3>
          <p class="text-xs text-base-content/60 mb-4">
            共有時に含める情報を選択できます。詳細を含めるほど、URL生成が重くなる場合があります。
          </p>

          <div class="space-y-2.5 text-sm">
            <label class="label cursor-pointer justify-start gap-2 py-0">
              <input
                id="share-include-airbase"
                type="checkbox"
                class="checkbox checkbox-sm"
                checked
              />
              <span class="label-text">基地航空隊を含める</span>
            </label>

            <label class="label cursor-pointer justify-start gap-2 py-0">
              <input
                id="share-include-detailed-stats"
                type="checkbox"
                class="checkbox checkbox-sm"
                checked
              />
              <span class="label-text"
                >艦の詳細ステータス（回避/対潜/索敵の補正値など）を含める</span
              >
            </label>

            <div>
              <label class="label cursor-pointer justify-start gap-2 py-0">
                <input
                  id="share-include-snapshot"
                  type="checkbox"
                  class="checkbox checkbox-sm"
                />
                <span class="label-text"
                  >スナップショット情報を含める（艦/装備選択モーダルに反映）</span
                >
              </label>
              <p
                id="share-snapshot-hint"
                class="text-xs text-base-content/50 ml-7"
              >
              </p>
              <p class="text-xs text-base-content/45 ml-7 mt-0.5">
                URLパラメータには含めず、短縮URLの内部保存データとして共有されます。
              </p>
            </div>
          </div>

          <div class="modal-action">
            <button
              id="btn-share-confirm"
              type="button"
              class="btn btn-primary btn-sm">URLを生成してコピー</button
            >
            <form method="dialog">
              <button class="btn btn-ghost btn-sm">キャンセル</button>
            </form>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>

      {/* Workspace Add Modal */}
      <dialog id="workspace-add-modal" class="modal">
        <div class="modal-box rounded-xl">
          <h3 id="workspace-modal-title" class="font-bold text-lg mb-2">
            ワークスペースにURLを追加
          </h3>
          <p
            id="workspace-modal-description"
            class="text-xs text-base-content/60 mb-4"
          >
            共有URL（/share/short/xxxx or
            /share/data?data=...）を追加できます。URLを空欄のまま保存すると、現在の編成を自分のデッキとして追加します。
          </p>

          <div class="space-y-3 text-sm">
            <div class="form-control">
              <label class="label py-1"
                ><span class="label-text">表示名（任意）</span></label
              >
              <input
                id="workspace-entry-label"
                type="text"
                class="input input-bordered input-sm"
                placeholder="例: 友軍A / E-5破砕編成"
              />
            </div>

            <div class="form-control">
              <label class="label py-1"
                ><span class="label-text">メモ（任意）</span></label
              >
              <textarea
                id="workspace-entry-memo"
                class="textarea textarea-bordered textarea-sm min-h-20"
                maxlength="300"
                placeholder="例: 対潜重視。夜戦火力が不足しがち"></textarea>
            </div>

            <div class="form-control">
              <label class="label py-1"
                ><span class="label-text">共有URL or キー</span></label
              >
              <input
                id="workspace-share-input"
                type="text"
                class="input input-bordered input-sm"
                placeholder="https://fusou.dev/share/short/xxxxxxxxxxxxxxxx"
              />
              <p class="text-xs text-base-content/50 mt-1">
                キーだけ（16桁hex）でも追加できます。
              </p>
            </div>
          </div>

          <div class="modal-action">
            <button
              id="btn-workspace-add-confirm"
              type="button"
              class="btn btn-primary btn-sm">追加して切り替え</button
            >
            <form method="dialog">
              <button class="btn btn-ghost btn-sm">キャンセル</button>
            </form>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>

      {/* API Response Paste Dialog */}
      <dialog id="api-paste-modal" class="modal">
        <div class="modal-box max-w-2xl">
          <h3 class="font-bold text-lg mb-2">APIレスポンス貼り付け</h3>
          <p class="text-sm text-base-content/60 mb-4">
            各エンドポイントのレスポンスJSONを貼り付けてください。<code
              class="text-xs">svdata=</code
            >プレフィックス付きでも使用可能です。
          </p>

          {/* port */}
          <div class="mb-4">
            <div class="flex items-center justify-between mb-1">
              <label class="text-sm font-medium" for="api-paste-port">
                <code class="text-xs">api_port/port</code>
                <span class="text-base-content/50 ml-1">艦・編成</span>
              </label>
              <span id="api-paste-status-port" class="badge badge-ghost badge-sm"
                >未読込</span
              >
            </div>
            <textarea
              id="api-paste-port"
              class="textarea textarea-bordered w-full h-24 font-mono text-xs"
              placeholder="api_port/port のレスポンスJSON..."></textarea>
            <p id="api-paste-message-port" class="text-xs mt-1 min-h-[1.2em]"></p>
          </div>

          {/* require_info */}
          <div class="mb-4">
            <div class="flex items-center justify-between mb-1">
              <label class="text-sm font-medium" for="api-paste-require">
                <code class="text-xs">api_get_member/require_info</code>
                <span class="text-base-content/50 ml-1">装備</span>
              </label>
              <span
                id="api-paste-status-require"
                class="badge badge-ghost badge-sm">未読込</span
              >
            </div>
            <textarea
              id="api-paste-require"
              class="textarea textarea-bordered w-full h-24 font-mono text-xs"
              placeholder="api_get_member/require_info のレスポンスJSON..."
            ></textarea>
            <p id="api-paste-message-require" class="text-xs mt-1 min-h-[1.2em]">
            </p>
          </div>

          {/* getData */}
          <div class="mb-4">
            <div class="flex items-center justify-between mb-1">
              <label class="text-sm font-medium" for="api-paste-master">
                <code class="text-xs">api_start2/getData</code>
                <span class="text-base-content/50 ml-1">マスターデータ</span>
              </label>
              <span
                id="api-paste-status-master"
                class="badge badge-ghost badge-sm">未読込</span
              >
            </div>
            <textarea
              id="api-paste-master"
              class="textarea textarea-bordered w-full h-24 font-mono text-xs"
              placeholder="api_start2/getData のレスポンスJSON..."></textarea>
            <p id="api-paste-message-master" class="text-xs mt-1 min-h-[1.2em]">
            </p>
          </div>

          <div class="modal-action">
            <button id="btn-api-paste-apply" class="btn btn-success btn-sm"
              >編成に反映</button
            >
            <button id="btn-api-paste-reset" class="btn btn-ghost btn-sm"
              >リセット</button
            >
            <form method="dialog">
              <button class="btn btn-ghost btn-sm">閉じる</button>
            </form>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </>
  );
}
