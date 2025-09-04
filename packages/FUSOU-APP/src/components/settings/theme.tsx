import { For } from "solid-js";

const themes = ["light", "dark"];

export function ThemeControllerComponent() {
  return (
    <div class="dropdown mb-20 w-64">
      <div
        tabindex="0"
        role="button"
        class="btn btn-primary border-primary-content btn-wide"
      >
        Theme
        <svg
          width="12px"
          height="12px"
          class="inline-block h-2 w-2 fill-current opacity-60"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 2048 2048"
        >
          <path d="M1799 349l242 241-1017 1017L7 590l242-241 775 775 775-775z" />
        </svg>
      </div>
      <ul
        tabindex="0"
        class="dropdown-content bg-base-200 rounded-md z-[1] w-64 outline outline-1 p-2 shadow max-h-80"
        style={{ "overflow-y": "auto" }}
      >
        <For each={themes}>
          {(theme) => (
            <li>
              <input
                type="radio"
                name="theme-dropdown"
                class="theme-controller btn btn-sm btn-block border-0 justify-start"
                aria-label={theme}
                value={theme}
                checked={theme == localStorage.getItem("fusou-app-theme")}
                onClick={() => {
                  localStorage.setItem("fusou-app-theme", theme);
                }}
              />
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
