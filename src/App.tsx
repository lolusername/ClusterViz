import WhiteboardCanvas from "./components/WhiteboardCanvas";
import VisualizationLibrary from "./components/VisualizationLibrary";

export default function App() {
  return (
    <div class="app-shell">
      <main class="workspace">
        <section class="workspace__canvas">
          <div class="canvas-wrapper">
            <WhiteboardCanvas />
          </div>
        </section>
        <aside class="workspace__sidebar">
          <div class="workspace__controls-card">
            <header>
              <span class="eyebrow">Workshop controls</span>
              <div>
                <h2>Configure dataset + module</h2>
                <p>Everything inside adapts to whichever explainer you open.</p>
              </div>
            </header>
            <div class="workspace__controls-body">
              <div id="viz-controls-host" class="inspector-panel" />
            </div>
          </div>
          <div class="workspace__library-card">
            <header>
              <span class="eyebrow">Library</span>
              <div>
                <h2>Clustering modules</h2>
                <p>Launch explainers without leaving the canvas.</p>
              </div>
            </header>
            <div class="workspace__library-body">
              <VisualizationLibrary />
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
