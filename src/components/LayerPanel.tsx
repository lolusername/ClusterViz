import { For, Show } from "solid-js";
import { whiteboardActions, whiteboardState } from "../state/whiteboard";

export default function LayerPanel() {
  return (
    <aside class="panel">
      <header class="panel-header">
        <div>
          <h3>Layers</h3>
          <p>{whiteboardState.layers.length} total</p>
        </div>
        <button onClick={() => whiteboardActions.createLayer()}>+ Layer</button>
      </header>
      <ul class="layer-list">
        <For each={whiteboardState.layers}>
          {(layer) => (
            <li classList={{ active: whiteboardState.activeLayerId === layer.id }}>
              <button class="layer-name" onClick={() => whiteboardActions.selectLayer(layer.id)}>
                {layer.name}
              </button>
              <div class="layer-controls">
                <button onClick={() => whiteboardActions.moveLayer(layer.id, "up")}>↑</button>
                <button onClick={() => whiteboardActions.moveLayer(layer.id, "down")}>↓</button>
                <button onClick={() => whiteboardActions.toggleLayerVisibility(layer.id)}>
                  <Show when={layer.visible} fallback={<>🙈</>}>
                    👁️
                  </Show>
                </button>
                <button onClick={() => whiteboardActions.toggleLayerLock(layer.id)}>
                  {layer.locked ? "🔒" : "🔓"}
                </button>
                <button onClick={() => whiteboardActions.clearLayer(layer.id)}>🧹</button>
                <button disabled={whiteboardState.layers.length === 1} onClick={() => whiteboardActions.removeLayer(layer.id)}>
                  ❌
                </button>
              </div>
            </li>
          )}
        </For>
      </ul>
    </aside>
  );
}
