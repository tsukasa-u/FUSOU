/** @jsxImportSource solid-js */
import { createSignal, type JSX } from "solid-js";

type Props = {
  id?: string;
  class?: string;
  disabled?: boolean;
  hidden?: boolean;
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
  onShare?: () => boolean | Promise<boolean>;
};

export function ShareUrlButton(props: Props): JSX.Element {
  const [status, setStatus] = createSignal<"idle" | "loading" | "success" | "error">("idle");

  const handleClick = async (e: MouseEvent) => {
    if (props.onShare) {
      e.preventDefault();
      setStatus("loading");
      try {
        const res = await props.onShare();
        if (res) {
          setStatus("success");
          setTimeout(() => setStatus("idle"), 1500);
        } else {
          setStatus("error");
          setTimeout(() => setStatus("idle"), 3000);
        }
      } catch {
        setStatus("error");
        setTimeout(() => setStatus("idle"), 3000);
      }
    } else if (props.onClick) {
      if (typeof props.onClick === "function") {
        props.onClick(e as any);
      } else {
        props.onClick[0](props.onClick[1], e as any);
      }
    }
  };

  return (
    <button
      id={props.id}
      type="button"
      class={`fusou-btn-secondary gap-1.5 ${props.class ?? ""} ${status() === "success" ? "!bg-success/20 !text-success !border-success" : status() === "error" ? "!bg-error/20 !text-error !border-error" : ""}`.trim()}
      disabled={props.disabled || status() === "loading"}
      hidden={props.hidden}
      onClick={handleClick}
    >
      {status() === "loading" ? (
        <span class="loading loading-spinner loading-xs"></span>
      ) : status() === "success" ? (
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
      ) : status() === "error" ? (
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
          />
        </svg>
      )}
      <span class="hidden md:inline">
        {status() === "success" ? "コピー完了" : status() === "error" ? "失敗" : "共有"}
      </span>
    </button>
  );
}
