import { For } from "solid-js";
import { whiteboardActions, whiteboardState } from "../state/whiteboard";

const tools = [
  { id: "pen", label: "Pen", icon: "🖊" },
  { id: "eraser", label: "Eraser", icon: "🧽" },
  { id: "line", label: "Line", icon: "➖" },
  { id: "rectangle", label: "Rect", icon: "▭" },
  { id: "ellipse", label: "Ellipse", icon: "◯" },
  { id: "arrow", label: "Arrow", icon: "➡" },
  { id: "text", label: "Text", icon: "🔤" },
] as const;

const palette = ["#0f172a", "#2563eb", "#dc2626", "#16a34a", "#a855f7", "#f97316", "#10b981", "#fbbf24"];

export default function ToolPanel() {
  return (
    <aside class="panel">
      <section>
        <h3>Tools</h3>
        <div class="tool-grid tool-grid--slim">
          <For each={tools}>
            {(tool) => (
              <button
                classList={{ active: whiteboardState.tool === tool.id }}
                onClick={() => whiteboardActions.setTool(tool.id)}
              >
                <span aria-hidden="true">{tool.icon}</span>
                <span class="sr-only">{tool.label}</span>
              </button>
            )}
          </For>
        </div>
      </section>
      <section>
        <h3>Stroke</h3>
        <div class="color-row">
          <For each={palette}>
            {(color) => (
              <button
                style={{ "--color": color }}
                classList={{ selected: whiteboardState.strokeColor === color }}
                onClick={() => whiteboardActions.setStrokeColor(color)}
                aria-label={`Use ${color}`}
              />
            )}
          </For>
          <input
            type="color"
            value={whiteboardState.strokeColor}
            onInput={(event) => whiteboardActions.setStrokeColor(event.currentTarget.value)}
          />
        </div>
        <label class="slider">
          <span>{whiteboardState.weight}px</span>
          <input
            type="range"
            min="1"
            max="48"
            value={whiteboardState.weight}
            onInput={(event) => whiteboardActions.setWeight(Number(event.currentTarget.value))}
          />
        </label>
      </section>
      <section>
        <h3>Fill</h3>
        <div class="color-row">
          <button
            classList={{ selected: whiteboardState.fillColor === "transparent" }}
            onClick={() => whiteboardActions.setFillColor("transparent")}
          >
            ∅
          </button>
          <For each={palette}>
            {(color) => (
              <button
                style={{ "--color": color }}
                classList={{ selected: whiteboardState.fillColor === color }}
                onClick={() => whiteboardActions.setFillColor(color)}
              />
            )}
          </For>
          <input
            type="color"
            value={whiteboardState.fillColor === "transparent" ? "#ffffff" : whiteboardState.fillColor}
            onInput={(event) => whiteboardActions.setFillColor(event.currentTarget.value)}
          />
        </div>
      </section>
      <section>
        <h3>Actions</h3>
        <div class="action-row">
          <button onClick={() => whiteboardActions.undo()} disabled={!whiteboardState.history.length}>
            Undo
          </button>
          <button onClick={() => whiteboardActions.redo()} disabled={!whiteboardState.redo.length}>
            Redo
          </button>
        </div>
      </section>
    </aside>
  );
}
