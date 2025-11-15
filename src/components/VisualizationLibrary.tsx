import { createSignal, For, Show } from "solid-js";
import { list } from "../lib/ml/registry";
import { visualizationActions, visualizationState } from "../state/visualizations";
import { whiteboardActions } from "../state/whiteboard";

export default function VisualizationLibrary() {
  const [search, setSearch] = createSignal("");
  return (
    <aside class="panel">
      <header class="panel-header">
        <div>
          <h3>Clustering Library</h3>
          <p>Launch interactive explainers to compare clustering intuition.</p>
        </div>
        <Show when={visualizationState.activeId()}>
          <button
            class="danger"
            onClick={() => {
              visualizationActions.activate(null);
              visualizationActions.setActiveModule(null);
              whiteboardActions.setActiveVisualization(null);
              whiteboardActions.setInteractionMode("visualization");
            }}
          >
            Exit
          </button>
        </Show>
      </header>
      <input
        type="search"
        placeholder="Search clustering modules"
        value={search()}
        onInput={(event) => setSearch(event.currentTarget.value)}
      />
      <div class="viz-list">
        <For each={list().filter((viz) => viz.label.toLowerCase().includes(search().toLowerCase()))}>
          {(viz) => (
            <button
              classList={{ active: visualizationState.activeId() === viz.id }}
              onClick={() => {
                visualizationActions.activate(viz.id);
                whiteboardActions.setInteractionMode("visualization");
                whiteboardActions.setActiveVisualization(viz.id);
              }}
            >
              <h4>{viz.label}</h4>
              <p>{viz.summary}</p>
            </button>
          )}
        </For>
      </div>
    </aside>
  );
}
