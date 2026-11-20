import type { EditingContext } from "./context";

export function attachShortcuts(context: EditingContext): void {
  window.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "SELECT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    ) {
      return;
    }
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        context.redo();
      } else {
        context.undo();
      }
      return;
    }
    if (modifier && event.key.toLowerCase() === "y") {
      event.preventDefault();
      context.redo();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (
        context.getEditorMode() === "roadside" &&
        context.getSelectedRoadsideRun()
      ) {
        event.preventDefault();
        context.removeRoadsideRun();
      } else if (context.getSelectedPoint()) {
        event.preventDefault();
        context.deleteSelectedPoint();
      }
    }
    if (event.key === "Escape") {
      if (context.getEditorMode() === "roadside") {
        event.preventDefault();
        context.setDrag(null);
        context.getView()?.setControlsEnabled(true);
        context.setSelectedRoadsideSpline(null);
        context.setSelectedRoadsideRun(null);
        context.scheduleOverlayUpdate();
        context.updateAuthoringUI();
      }
    }
  });
}
