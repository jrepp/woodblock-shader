import { useSnapshot } from "valtio";
import { controlsStore, setControl, setControls } from "./controls.js";

export function useControls() {
  const controls = useSnapshot(controlsStore);
  return {
    controls,
    setControl,
    setControls,
  };
}
