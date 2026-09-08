/** @jsxImportSource solid-js */
import { Show, type JSX } from "solid-js";
import { isSafeImageUrl } from "@/utils/security";

export interface ShipBannerProps {
  src: string | undefined;
  alt: string;
  class?: string;
}

/**
 * Ship banner `<img>` with graceful loading:
 * - A neutral placeholder background is always visible via the wrapper.
 * - The image starts invisible and fades in on load.
 * - On error the `<img>` is hidden so no broken-icon flickers.
 */
export function ShipBanner(props: ShipBannerProps): JSX.Element {
  const outerClass = () => props.class ?? "h-6 w-24";
  return (
    <span
      class={`${outerClass()} inline-block flex-none rounded overflow-hidden bg-base-300/40`}
    >
      <Show when={props.src && isSafeImageUrl(props.src)}>
        <img
          src={props.src}
          alt={props.alt}
          class="h-full w-full rounded object-cover opacity-0 transition-opacity duration-200"
          loading="lazy"
          onLoad={(e) => {
            (e.currentTarget as HTMLImageElement).classList.replace(
              "opacity-0",
              "opacity-100",
            );
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      </Show>
    </span>
  );
}

export default ShipBanner;
