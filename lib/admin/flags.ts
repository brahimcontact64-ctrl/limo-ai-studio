/** Flags that must not be switched from the UI until the owner approves providers, budgets and live actions. */
export const LOCKED_FLAGS: ReadonlySet<string> = new Set(['paid_generation', 'facebook_live_publishing']);
