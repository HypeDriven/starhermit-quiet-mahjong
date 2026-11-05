// Localization: assets/strings.json (generated from the browser build's string
// tables, English text as the key) on the engine's strings, which follow the
// interface language the runtime reports (the player's choice in Options ›
// Language, else the account's preferred language or the device's) and own the
// locale fallback and the account strings (`starhermit.*`). Every string is
// drawn through T() each frame, so a change shows on the next frame without
// ending a round.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));

export type Vars = Record<string, string | number>;
/** A game string by its English key in the player's language; `{name}` placeholders from vars. */
export function T(key: string, vars?: Vars | null): string { return strings.t(key, vars ?? undefined); }
/** Marks an English key; translated with T() where it is shown. */
export const N = (key: string): string => key;
/** The account strings (sign in, invite, the leaderboard line, …). */
export function S(key: string, vars?: Vars): string { return strings.t(`starhermit.${key}`, vars); }
/** The controls line's action names and "Keyboard" (the game's own, keys `sh.*`). */
export function K(key: string): string { return strings.t(`sh.${key}`); }
