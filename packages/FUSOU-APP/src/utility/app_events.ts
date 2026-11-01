import appEvents from "./app_events.json";

export const APP_EVENTS = appEvents;
export type AppEventName = (typeof APP_EVENTS)[keyof typeof APP_EVENTS];
