import { useSyncExternalStore } from "react";
import type { OperationState } from "@/store/operationStore";
import { getState, subscribe } from "@/store/operationStore";

export function useOperationStore(): OperationState {
  return useSyncExternalStore(subscribe, getState, getState);
}
