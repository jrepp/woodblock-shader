import { useSnapshot } from "valtio";
import { uiStore } from "./ui.js";

export function useUi() {
  const ui = useSnapshot(uiStore);
  return { ui, uiStore };
}
