export function shouldReconcileRealtimeStatus(status: string): boolean {
  return (
    status === "SUBSCRIBED" ||
    status === "CHANNEL_ERROR" ||
    status === "TIMED_OUT" ||
    status === "CLOSED"
  );
}
