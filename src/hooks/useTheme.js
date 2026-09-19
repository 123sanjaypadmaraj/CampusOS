import { useEffect } from "react";
import { StatusBar, Style as StatusBarStyle } from "@capacitor/status-bar";
import { IS_NATIVE, PLATFORM } from "../config/platform";

function useTheme({ darkMode, setColorTheme, setDarkMode, setThemePickerOpen, themePickerOpen, themePickerRef }) {
  useEffect(() => {
      if (!IS_NATIVE) return;
      StatusBar.setStyle({ style: darkMode ? StatusBarStyle.Dark : StatusBarStyle.Light }).catch(() => {});
      if (PLATFORM === "android") {
        StatusBar.setBackgroundColor({ color: darkMode ? "#0c0d12" : "#faf9fc" }).catch(() => {});
      }
    }, [darkMode]);

  const toggleTheme = () => {
      setDarkMode((current) => {
        const next = !current;
        localStorage.setItem("campus-theme", next ? "dark" : "light");
        return next;
      });
    };

  const selectColorTheme = (id) => {
      setColorTheme(id);
      localStorage.setItem("campus-color-theme", id);
      // Deliberately left open (unlike a native <select>) -- picking a color
      // theme is step one of this panel, with light/dark right underneath it,
      // so closing here would force a re-open just to reach that toggle.
    };

  useEffect(() => {
      if (!themePickerOpen) return;
      const onPointerDown = (e) => {
        if (themePickerRef.current && !themePickerRef.current.contains(e.target)) {
          setThemePickerOpen(false);
        }
      };
      document.addEventListener("mousedown", onPointerDown);
      return () => document.removeEventListener("mousedown", onPointerDown);
    }, [themePickerOpen]); // eslint-disable-line react-hooks/exhaustive-deps -- setThemePickerOpen/themePickerRef are a useState setter and a ref, both stable

  return { selectColorTheme, toggleTheme };
}

export { useTheme };
