/** @jsxImportSource solid-js */
import { Show, type JSX } from "solid-js";

export interface FusouPageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: JSX.Element;
  compact?: boolean;
  class?: string;
}

export function FusouPageHeader(props: FusouPageHeaderProps) {
  return (
    <div class={`fusou-page-header flex flex-col gap-1 mb-6 ${props.class ?? ""}`.trim()}>
      <div class="flex items-center justify-between gap-4">
        <h1 class={`flex-1 min-w-0 ${props.compact ? "fusou-page-title-compact" : "fusou-page-title"}`}>
          {props.title}
        </h1>
        <Show when={props.actions}>
          <div class="fusou-page-actions">
            {props.actions}
          </div>
        </Show>
      </div>
      <Show when={props.subtitle}>
        <p class={`whitespace-nowrap overflow-hidden text-ellipsis ${props.compact ? "fusou-page-subtitle-compact" : "fusou-page-subtitle"}`}>
          {props.subtitle}
        </p>
      </Show>
    </div>
  );
}

export default FusouPageHeader;