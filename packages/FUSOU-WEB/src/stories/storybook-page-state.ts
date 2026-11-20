import type { ViewerWorkspace } from "../features/simulator/viewer-workspace";

export type PageMockScenario = "populated" | "empty" | "error";

export interface StorybookPageState {
  scenario?: PageMockScenario;
  query?: Record<string, string>;
  simulatorPayload?: "fleet";
  viewerWorkspace?: "sample" | "empty";
}

export function pageState(state: StorybookPageState = {}) {
  return { fusouPageState: state };
}

export type StorybookViewerWorkspace = ViewerWorkspace;
