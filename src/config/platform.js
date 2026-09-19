import { Capacitor } from "@capacitor/core";

const PLATFORM = Capacitor.getPlatform();

const IS_NATIVE = Capacitor.isNativePlatform();

export { PLATFORM, IS_NATIVE };
