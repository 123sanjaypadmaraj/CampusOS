import { useEffect, useRef } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { PLATFORM } from "../config/platform";

function useAndroidBackButton({ active }) {
  const activeRef = useRef(active);

  useEffect(() => {
      activeRef.current = active;
    }, [active]);

  useEffect(() => {
      if (PLATFORM !== "android") return;
      const handle = CapacitorApp.addListener("backButton", () => {
        if (activeRef.current === "home") {
          CapacitorApp.exitApp();
        } else {
          window.history.back();
        }
      });
      return () => {
        handle.then((h) => h.remove());
      };
    }, []);
}

export { useAndroidBackButton };
