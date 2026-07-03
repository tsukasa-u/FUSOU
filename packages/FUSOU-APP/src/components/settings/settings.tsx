import { invoke } from "@tauri-apps/api/core";
import { FadeToast, showFadeToast } from "./fade_toast";
import "../../css/divider.css";
import { ThemeControllerComponent } from "./theme";
import { createSignal, onMount, Show } from "solid-js";

type SessionHealth = {
  has_session: boolean;
  access_token_len: number;
  refresh_token_len: number;
  seems_valid: boolean;
  reason?: string | null;
};

type HardwareAttestationHealth = {
  available: boolean;
  attestation_level: string;
  detail?: string | null;
  platform: string;
  distribution?: string | null;
  diagnostics: string[];
  remediation_steps: string[];
};

export function SettingsComponent() {
  const [sessionHealth, setSessionHealth] = createSignal<SessionHealth | null>(
    null,
  );
  const [checkingHealth, setCheckingHealth] = createSignal<boolean>(false);
  const [signingOut, setSigningOut] = createSignal<boolean>(false);
  const [attestationHealth, setAttestationHealth] =
    createSignal<HardwareAttestationHealth | null>(null);
  const [checkingAttestation, setCheckingAttestation] =
    createSignal<boolean>(false);
  const [runningAttestationCheck, setRunningAttestationCheck] =
    createSignal<boolean>(false);
  const [configuringAttestation, setConfiguringAttestation] =
    createSignal<boolean>(false);

  const handleCheckSessionHealth = async () => {
    try {
      setCheckingHealth(true);
      const health = await invoke<SessionHealth>(
        "check_supabase_session_health",
      );
      setSessionHealth(health);
      showFadeToast("setting_toast", "Session health checked");
    } catch (e: any) {
      console.error("Failed to check session health:", e);
      showFadeToast("setting_toast", "Failed to check session health");
    } finally {
      setCheckingHealth(false);
    }
  };

  const handleForceLocalSignOut = async () => {
    try {
      setSigningOut(true);
      await invoke("force_local_sign_out");
      setSessionHealth(null);
      showFadeToast(
        "setting_toast",
        "Local session cleared. Please sign in again.",
      );
    } catch (e: any) {
      console.error("Failed to force local sign out:", e);
      showFadeToast("setting_toast", "Failed to clear local session");
    } finally {
      setSigningOut(false);
    }
  };

  const handleLoadAttestationStatus = async () => {
    try {
      setCheckingAttestation(true);
      const status = await invoke<HardwareAttestationHealth>(
        "get_hardware_attestation_status",
      );
      setAttestationHealth(status);
    } catch (e: any) {
      console.error("Failed to load hardware attestation status:", e);
      showFadeToast("setting_toast", "Failed to load TPM status");
    } finally {
      setCheckingAttestation(false);
    }
  };

  const handleRunAttestationCheck = async () => {
    try {
      setRunningAttestationCheck(true);
      const status = await invoke<HardwareAttestationHealth>(
        "run_hardware_attestation_check",
      );
      setAttestationHealth(status);
      showFadeToast(
        "setting_toast",
        status.available
          ? "TPM hardware attestation is available"
          : "TPM hardware attestation is unavailable",
      );
    } catch (e: any) {
      console.error("Failed to run hardware attestation check:", e);
      showFadeToast("setting_toast", "Failed to run TPM check");
    } finally {
      setRunningAttestationCheck(false);
    }
  };

  const handleSetupAttestation = async () => {
    try {
      setConfiguringAttestation(true);
      const result = await invoke<string>("setup_hardware_attestation");
      showFadeToast("setting_toast", result);
      await handleLoadAttestationStatus();
    } catch (e: any) {
      console.error("Failed to setup hardware attestation:", e);
      showFadeToast(
        "setting_toast",
        e?.toString?.() ?? "Failed to setup TPM access",
      );
    } finally {
      setConfiguringAttestation(false);
    }
  };

  onMount(() => {
    void handleLoadAttestationStatus();
  });

  return (
    <>
      {/* <div class="breadcrumbs text-sm bg-base-300 fixed border-b-1 border-t-1 w-full rounded" style={{"z-index":"100"}}>
              <ul class="pl-4">
                <li><a class="link">Settings</a></li>
                <li><a class="link">Debug</a></li>
                <li><a class="link">Load Data</a></li>
              </ul>
            </div> */}

      {/* <div class="h-8"></div> */}

      <h1 class="mx-6 pt-6 pb-2 text-3xl font-semibold">Settings</h1>
      <div class="mx-6">
        <div class="divider divider-horizonal py-0 mt-4 mb-8" />

        <p class="py-2 text-xl font-semibold">Manual Snapshot Sync</p>
        <p class="px-px leading-5">
          Trigger a manual snapshot sync to the configured server.
        </p>
        <div class="mt-4 flex items-center justify-end">
          <button
            class="btn btn-primary border-primary-content btn-wide"
            onClick={async () => {
              try {
                // Signal Rust to perform snapshot sync; notifications are handled in Rust.
                await invoke("perform_snapshot_sync");
              } catch (e: any) {
                console.error("manual snapshot sync failed:", e);
              }
            }}
          >
            Sync snapshot
          </button>
        </div>

        <div class="divider divider-horizonal py-0 mt-4 mb-8" />

        <p class="py-2 text-xl font-semibold">Hardware Attestation (TPM)</p>
        <p class="px-px leading-5">
          Check whether TPM-based hardware attestation is currently usable on
          this device.
        </p>
        <div class="mt-4 flex items-center justify-end gap-2">
          <button
            class="btn btn-accent border-accent-content btn-wide"
            onClick={handleSetupAttestation}
            disabled={configuringAttestation()}
          >
            {configuringAttestation()
              ? "Configuring..."
              : "Auto Configure TPM Access"}
          </button>
          <button
            class="btn btn-secondary border-secondary-content btn-wide"
            onClick={handleLoadAttestationStatus}
            disabled={checkingAttestation()}
          >
            {checkingAttestation() ? "Refreshing..." : "Refresh TPM Status"}
          </button>
          <button
            class="btn btn-primary border-primary-content btn-wide"
            onClick={handleRunAttestationCheck}
            disabled={runningAttestationCheck()}
          >
            {runningAttestationCheck() ? "Checking..." : "Run TPM Check"}
          </button>
        </div>
        <Show when={attestationHealth()}>
          {(h) => (
            <div class="mt-4 p-4 bg-base-200 rounded-box text-sm space-y-2">
              <div>
                TPM availability: {" "}
                <span class={h().available ? "text-success" : "text-error"}>
                  {h().available ? "Available" : "Unavailable"}
                </span>
              </div>
              <div>
                Active attestation level: <span>{h().attestation_level}</span>
              </div>
              <div>
                Platform: <span>{h().platform}</span>
                <Show when={h().distribution}>
                  {(distribution) => (
                    <span> ({distribution()})</span>
                  )}
                </Show>
              </div>
              <Show when={h().detail}>
                {(detail) => <div class="text-warning">{detail()}</div>}
              </Show>
              <Show when={h().remediation_steps.length > 0}>
                <div class="mt-2">
                  <div class="font-semibold">Recommended steps</div>
                  <div class="mt-1 space-y-1">
                    {h().remediation_steps.map((step) => (
                      <div class="text-warning">- {step}</div>
                    ))}
                  </div>
                </div>
              </Show>
              <Show when={h().diagnostics.length > 0}>
                <div class="mt-2">
                  <div class="font-semibold">Diagnostics</div>
                  <div class="mt-1 space-y-1">
                    {h().diagnostics.map((line) => (
                      <div class="font-mono text-xs opacity-80">{line}</div>
                    ))}
                  </div>
                </div>
              </Show>
            </div>
          )}
        </Show>

        <div class="divider divider-horizonal py-0 mt-4 mb-8" />

        <p class="py-2 text-xl font-semibold">Supabase Session</p>
        <p class="px-px leading-5">
          Check the status of your Supabase authentication session.
        </p>
        <div class="mt-4 flex items-center justify-end">
          <button
            class="btn btn-primary border-primary-content btn-wide"
            onClick={handleCheckSessionHealth}
            disabled={checkingHealth()}
          >
            {checkingHealth() ? "Checking..." : "Check Session Health"}
          </button>
        </div>
        <Show when={sessionHealth()}>
          {(h) => (
            <div class="mt-4 p-4 bg-base-200 rounded-box text-sm space-y-2">
              <div>
                Session exists:{" "}
                <span class={h().has_session ? "text-success" : "text-warning"}>
                  {h().has_session ? "Yes" : "No"}
                </span>
              </div>
              <div>
                Access token length: <span>{h().access_token_len}</span>
              </div>
              <div>
                Refresh token length: <span>{h().refresh_token_len}</span>
              </div>
              <div>
                Status:{" "}
                <span class={h().seems_valid ? "text-success" : "text-error"}>
                  {h().seems_valid ? "Looks OK" : "Invalid/Corrupted"}
                </span>
              </div>
              <Show when={h().reason}>
                {(r) => <div class="text-warning">{r()}</div>}
              </Show>
            </div>
          )}
        </Show>

        <div class="divider divider-horizonal py-0 mt-4 mb-8" />

        <p class="py-2 text-xl font-semibold">Clear Supabase Session</p>
        <p class="px-px leading-5">
          Clear the stored Supabase session and sign out locally.
        </p>
        <div class="mt-4 flex items-center justify-end">
          <button
            class="btn btn-secondary border-secondary-content btn-wide"
            onClick={handleForceLocalSignOut}
            disabled={signingOut()}
          >
            {signingOut() ? "Signing out..." : "Force Local Sign Out"}
          </button>
        </div>

        <div class="divider divider-horizonal py-0 mt-4 mb-8" />

        <p class="py-2 text-xl font-semibold">Reload App Pages</p>
        <p class="px-px leading-5">
          Reload this application pages, not KanColle game web page
        </p>
        <div class="mt-4 flex items-center justify-end">
          <button
            class="btn btn-primary border-primary-content btn-wide"
            onClick={async () => {
              window.location.reload();
            }}
          >
            Reload
          </button>
        </div>

        <div class="divider divider-horizonal py-0 mt-4 mb-8" />

        <p class="py-2 text-xl font-semibold">Load Data</p>
        <p class="px-px leading-5">
          Load saved response data when the API comes from. this app does not
          access KanColle server via API, it just copies response data.
        </p>
        <div class="mt-4 flex items-center justify-end">
          <button
            class="btn btn-primary border-primary-content btn-wide"
            onClick={async () => {
              // We must invoke the API in order to get the data as follows ?
              // get_data -> require_info
              // IMPORTANT: KEEP THIS ORDER
              await invoke("get_mst_ships"); // get_data
              await invoke("get_mst_slot_items"); // get_data
              await invoke("get_mst_equip_exslot_ships"); // get_data
              await invoke("get_mst_slotitem_equip_types"); // get_data
              await invoke("get_mst_equip_ships"); // get_data
              await invoke("get_mst_stypes"); // get_data
              await invoke("get_mst_useitems"); // get_data
              await invoke("get_slot_items"); // require_info
              showFadeToast("setting_toast", "load all data");
            }}
          >
            Load all data
          </button>
        </div>
        {/* <div class="divider divider-horizonal py-0 mt-4 mb-8" /> */}

        <div class="grid py-6">
          <div id="load_mst_ships" class="py-2">
            <h2 class="py-1 text-lg font-semibold">Load ship data</h2>
            <p class="px-px leading-5">
              Load the mst_ships data restored from API
              "/kcsapi/api_start2/get_data"
            </p>
            <div class="mt-4 flex items-center justify-end">
              <button
                class="btn btn-secondary border-secondary-content btn-wide"
                onClick={() => {
                  invoke("get_mst_ships");
                  showFadeToast("setting_toast", "load mst_ships");
                }}
              >
                Load mst ship data
              </button>
            </div>
          </div>
          <div id="load_slot_items" class="py-2">
            <h2 class="py-1 text-lg font-semibold">Load slotitems data</h2>
            <p class="px-px leading-5">
              Load the slotitems data restored from API
              "/kcsapi/api_get_member/require_info"
            </p>
            <div class="mt-4 flex items-center justify-end">
              <button
                class="btn btn-secondary border-secondary-content btn-wide"
                onClick={() => {
                  invoke("get_slot_items");
                  showFadeToast("setting_toast", "load slot_items");
                }}
              >
                Load slot item data
              </button>
            </div>
          </div>
          <div id="load_mst_slot_items" class="py-2">
            <h2 class="py-1 text-lg font-semibold">Load mst_slotitems data</h2>
            <p class="px-px leading-5">
              Load the mst_slotitems data restored from API
              "/kcsapi/api_start2/get_data"
            </p>
            <div class="mt-4 flex items-center justify-end">
              <button
                class="btn btn-secondary border-secondary-content btn-wide"
                onClick={() => {
                  invoke("get_mst_slot_items");
                  showFadeToast("setting_toast", "load mst_slot_items");
                }}
              >
                Load mst slot item data
              </button>
            </div>
          </div>
          <div id="load_mst_equip_exslot_ships" class="py-2">
            <h2 class="py-1 text-lg font-semibold">
              Load mst_equip_exslot_ships data
            </h2>
            <p class="px-px leading-5">
              Load the mst_equip_exslot_ships data restored from API
              "/kcsapi/api_start2/get_data"
            </p>
            <div class="mt-4 flex items-center justify-end">
              <button
                class="btn btn-secondary border-secondary-content btn-wide"
                onClick={() => {
                  invoke("get_mst_equip_exslot_ships");
                  showFadeToast("setting_toast", "load mst_equip_exslot_ships");
                }}
              >
                Load mst equip exslot ship data
              </button>
            </div>
          </div>
          <div id="load_mst_slotitem_equip_types" class="py-2">
            <h2 class="py-1 text-lg font-semibold">
              Load mst_slotitem_equip_types data
            </h2>
            <p class="px-px leading-5">
              Load the mst_slotitem_equip_types data restored from API
              "/kcsapi/api_start2/get_data"
            </p>
            <div class="mt-4 flex items-center justify-end">
              <button
                class="btn btn-secondary border-secondary-content btn-wide"
                onClick={() => {
                  invoke("get_mst_slotitem_equip_types");
                  showFadeToast(
                    "setting_toast",
                    "load mst_slotitem_equip_types",
                  );
                }}
              >
                Load mst slot item equip types data
              </button>
            </div>
          </div>
          <div id="load_mst_equip_ships" class="py-2">
            <h2 class="py-1 text-lg font-semibold">
              Load mst_equip_ships data
            </h2>
            <p class="px-px leading-5">
              Load the mst_equip_ships data restored from API
              "/kcsapi/api_start2/get_data"
            </p>
            <div class="mt-4 flex items-center justify-end">
              <button
                class="btn btn-secondary border-secondary-content btn-wide"
                onClick={() => {
                  invoke("get_mst_equip_ships");
                  showFadeToast("setting_toast", "load mst_equip_ships");
                }}
              >
                Load mst equip ships data
              </button>
            </div>
          </div>
          <div id="load_mst_stypes" class="py-2">
            <h2 class="py-1 text-lg font-semibold">Load mst_stypes data</h2>
            <p class="px-px leading-5">
              Load the mst_stypes data restored from API
              "/kcsapi/api_start2/get_data"
            </p>
            <div class="mt-4 flex items-center justify-end">
              <button
                class="btn btn-secondary border-secondary-content btn-wide"
                onClick={() => {
                  invoke("get_mst_stypes");
                  showFadeToast("setting_toast", "load mst_stypes");
                }}
              >
                Load mst stypes data
              </button>
            </div>
          </div>
          <div id="load_mst_useitems" class="py-2">
            <h2 class=" py-1 text-lg font-semibold">Load mst_useitems data</h2>
            <p class="px-px leading-5">
              Load the mst_useitems data restored from API
              "/kcsapi/api_start2/get_data"
            </p>
            <div class="mt-4 flex items-center justify-end">
              <button
                class="btn btn-secondary border-secondary-content btn-wide"
                onClick={() => {
                  invoke("get_mst_useitems");
                  showFadeToast("setting_toast", "load mst_useitems");
                }}
              >
                Load mst useitems data
              </button>
            </div>
          </div>
        </div>

        {/* <div class="divider divider-horizonal py-0 mt-4 mb-8" />

        <div class="grid py-6">
                    <div class="py-2">
                        <h2 class="py-1 text-lg font-semibold">Save Response Data</h2>
                        <p>Save response data to test or use to analyze statistics</p>
                        <div class="mt-4 flex items-center justify-end">
                            <span class="w-8"></span>
                            <input type="file" class="file-input file-input-bordered file-input-sm w-full" />
                        </div>
                        <div class="mt-4 flex items-center justify-end">
                            <button class="btn btn-secondary border-secondary-content btn-wide" onClick={() => {  }}>empty</button>
                        </div>
                    </div>
                </div> */}

        <div class="divider divider-horizonal py-0 mt-4 mb-8" />

        <div class="grid">
          <div>
            <h2 class="py-2 text-xl font-semibold">Change theme</h2>
            <p class="px-px leading-5">
              change theme you like to select drop down menu
            </p>
            <div class="mt-4 flex items-center justify-end">
              <ThemeControllerComponent />
            </div>
          </div>
          <span class="h-8" />
        </div>
      </div>

      <FadeToast toast_id="setting_toast" />
    </>
  );
}
