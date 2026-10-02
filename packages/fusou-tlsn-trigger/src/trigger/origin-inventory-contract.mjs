export function assertTaskOriginInventoryDigest(taskDigest, runtimeDigest) {
  if (taskDigest !== runtimeDigest) {
    throw new Error("Worker task Origin inventory digest does not match Trigger runtime inventory");
  }
  return runtimeDigest;
}