// The look of the menus, HUD and overlays: the browser build's css/style.css,
// rewritten class-based in tools/ui-style.css and converted once with
// `starhermit css` into assets/ui-style.json (`npm run css`), registered at
// start with the theme the runtime's own widgets (dialogs, scroll bars,
// selects, check boxes, text fields) take. The runtime's high contrast swaps
// the tokens as body.high-contrast did.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

type Tokens = Record<string, string | number>;
let base: Tokens = {};
/** body.high-contrast's custom properties. */
const HIGH_CONTRAST: Tokens = {
  bg: "#000000", panel: "#000000f7", "panel-border": "#ffffff", text: "#ffffff", muted: "#dddddd", accent: "#ffff66", "accent-strong": "#ffff00", focus: "#00ffff",
};

export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  base = { ...(css.tokens as Tokens) };
  ui.setFont({ family: "sans-serif" });
  ui.setTheme({
    fontSize: 16, smallSize: 13.6, headingSize: 24, padding: 8, spacing: 10, radius: 10,
    text: "#e8ecf6", muted: "#9aa6c4", panel: "#10162c", control: "#22304f", hovered: "#2c3f66",
    pressed: "#1a2440", field: "#141c33", accent: "#6f9dff", focus: "#ffd97d", outline: "#2c3a5f",
  });
  ui.setTokens(css.tokens);
  ui.setAnimations(css.animations);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$text" } },
    paragraph: { text: { color: "$text" } },
    heading: { text: { color: "$text" } },
    // :focus-visible: a 3 px outline 2 px off every focusable element
    widget: { focusRing: { color: "$focus", width: 3, offset: 2 } },
    scrollArea: { parts: { bar: { background: "$muted", radius: 4 } } },
    tooltip: { background: "$panel", text: { color: "$text" }, radius: 6, padding: 6 },
    // .screen.overlay > .panel: the pause / results / help sheets over a 55 % dim of the garden
    dialog: { ...(css.styles[".panel"] as ui.Style), parts: { backdrop: { background: "#0609168c" } } },
  });
}

let contrast: boolean | null = null;
let current: Tokens = {};
/** The runtime's high contrast as tokens. */
export function applyTokens(highContrast: boolean): void {
  if (contrast === highContrast) return;
  contrast = highContrast;
  current = highContrast ? { ...base, ...HIGH_CONTRAST } : { ...base };
  ui.setTokens(current);
}
/** A token's current colour (for hand-drawn pieces: draw.* takes real colours). */
export function token(name: string): string { return String(current[name] ?? base[name] ?? "#000000"); }
