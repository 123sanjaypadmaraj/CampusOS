import { useEffect } from "react";
import { SplashScreen } from "@capacitor/splash-screen";
import { IS_NATIVE } from "../config/platform";

function useNativeSplashScreen() {
  useEffect(() => {
      if (!IS_NATIVE) return;
      SplashScreen.hide().catch(() => {});
    }, []);
}

export { useNativeSplashScreen };
