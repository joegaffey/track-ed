import type { TrackView } from "../scene";
import { attachControls } from "./controls";
import type { EditingContext } from "./context";
import { attachPointerEditing } from "./pointer";
import { attachShortcuts } from "./shortcuts";

export type { EditingContext } from "./context";

/**
 * Wire the canvas pointer state machine, the authoring controls and the
 * keyboard shortcuts onto an existing app context.
 */
export function attachEditing(
  trackView: TrackView,
  canvas: HTMLCanvasElement,
  context: EditingContext,
): void {
  attachPointerEditing(trackView, canvas, context);
  attachControls(context);
  attachShortcuts(context);
}
