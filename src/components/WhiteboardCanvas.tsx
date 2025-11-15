import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { whiteboardActions, whiteboardState, type PathAction, type Point } from "../state/whiteboard";
import { WhiteboardEngine } from "../lib/whiteboard/engine";
import { get } from "../lib/ml/registry";
import { visualizationActions, visualizationState } from "../state/visualizations";
import { createStore } from "solid-js/store";
import { datasetState } from "../state/dataset";

interface AnnotationState {
  type: "text" | null;
  position: Point | null;
}

export default function WhiteboardCanvas() {
  let canvasRef: HTMLCanvasElement | undefined;
  let overlayRef: HTMLCanvasElement | undefined;
  let moduleCanvasRef: HTMLCanvasElement | undefined;
  let moduleOverlayRef: HTMLDivElement | undefined;
  let moduleControlsRef: HTMLDivElement | null = null;
  let stageRef: HTMLDivElement | undefined;
  const [engine, setEngine] = createSignal<WhiteboardEngine>();
  const [annotation, setAnnotation] = createStore<AnnotationState>({ type: null, position: null });
  let activeModule: any = null;
  const hasSketches = () => whiteboardState.layers.some((layer) => layer.actions.length > 0);
  const dataset = () => datasetState();
  const pointTotal = createMemo(() => dataset()?.points.length ?? 0);
  const datasetOrigin = createMemo(() => dataset()?.origin ?? "generator");
  const activeLabel = createMemo(() => {
    const activeId = visualizationState.activeId();
    if (!activeId) return "No module";
    return get(activeId)?.label ?? "Custom";
  });

  onMount(() => {
    moduleControlsRef = document.getElementById("viz-controls-host") as HTMLDivElement | null;
    if (!canvasRef || !overlayRef || !moduleCanvasRef || !moduleOverlayRef || !moduleControlsRef) return;
    const instance = new WhiteboardEngine({
      canvas: canvasRef,
      overlay: overlayRef,
      getState: () => whiteboardState,
      onRequestText: (point) => {
        whiteboardActions.setPendingText(point);
        setAnnotation({ type: "text", position: point });
      },
      // sticky note removed
      onCommit: (layerId, action) => {
        whiteboardActions.pushAction(action);
        whiteboardActions.setPendingText(null);
        whiteboardActions.setPendingNote(null);
        setAnnotation({ type: null, position: null });
      },
    });
    setEngine(instance);

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      instance.setSize(Math.floor(width), Math.floor(height));
      instance.syncLayers(whiteboardState.layers);
      activeModule?.resize?.(Math.floor(width), Math.floor(height));
    });
    const observedTarget = stageRef ?? canvasRef.parentElement ?? canvasRef;
    if (observedTarget) {
      resizeObserver.observe(observedTarget);
    }

    onCleanup(() => {
      resizeObserver.disconnect();
      instance.destroy();
      activeModule?.destroy?.();
      visualizationActions.setActiveModule(null);
      activeModule = null;
      moduleControlsRef?.replaceChildren();
      stageRef = undefined;
    });
  });

  createEffect(() => {
    const inst = engine();
    if (!inst) return;
    inst.syncLayers(whiteboardState.layers);
  });

  createEffect(() => {
    const inst = engine();
    if (!inst) return;
    inst.render();
  });

  createEffect(() => {
    const mode = whiteboardState.interactionMode;
    if (canvasRef) {
      canvasRef.style.pointerEvents = mode === "whiteboard" ? "auto" : "none";
    }
    if (overlayRef) {
      // Overlay is for preview rendering only; never capture pointer events
      overlayRef.style.pointerEvents = "none";
    }
    if (moduleCanvasRef) {
      moduleCanvasRef.style.pointerEvents = mode === "visualization" ? "auto" : "none";
    }
    if (moduleOverlayRef) {
      moduleOverlayRef.style.pointerEvents = mode === "visualization" ? "auto" : "none";
    }
  });

  createEffect(() => {
    const activeId = whiteboardState.activeVisualization;
    const definition = activeId ? get(activeId) : null;
    if (activeModule) {
      activeModule.stop?.();
      activeModule.destroy?.();
      visualizationActions.setActiveModule(null);
      activeModule = null;
    }
    if (!definition || !moduleCanvasRef || !moduleOverlayRef || !moduleControlsRef) {
      visualizationActions.activate(null);
      visualizationActions.setActiveModule(null);
      moduleControlsRef?.replaceChildren();
      return;
    }
    const context = {
      canvas: moduleCanvasRef,
      overlay: moduleOverlayRef,
      controlsHost: moduleControlsRef,
      requestRender: () => {},
      width: () => moduleCanvasRef.width || moduleCanvasRef.clientWidth || canvasRef?.width || 0,
      height: () => moduleCanvasRef.height || moduleCanvasRef.clientHeight || canvasRef?.height || 0,
      pushMessage: visualizationActions.pushMessage,
    };
    const targetWidth = canvasRef?.width ?? moduleCanvasRef.clientWidth ?? 0;
    const targetHeight = canvasRef?.height ?? moduleCanvasRef.clientHeight ?? 0;
    moduleCanvasRef.width = targetWidth;
    moduleCanvasRef.height = targetHeight;
    moduleControlsRef.replaceChildren();
    const instance = definition.create(context as any);
    activeModule = instance;
    visualizationActions.setActiveModule(instance);
    instance.start();
  });

  return (
    <div class="wb-canvas">
      <div ref={stageRef!} class="wb-stage">
        <canvas ref={canvasRef!} class="wb-base" />
        <canvas ref={overlayRef!} class="wb-overlay" />
        <canvas ref={moduleCanvasRef!} class="viz-canvas" />
        <div ref={moduleOverlayRef!} class="viz-overlay" />
        <Show when={!whiteboardState.activeVisualization && !hasSketches()}>
          <div class="canvas-empty">
            <h2>Select a clustering module</h2>
            <p>Use the library to launch K-Means, DBSCAN, and other explainers. The canvas will guide each activity.</p>
          </div>
        </Show>
        {annotation.type === "text" && annotation.position && (
          <AnnotationPopup
            position={annotation.position}
            mode="text"
            onCancel={() => {
              whiteboardActions.setPendingText(null);
              setAnnotation({ type: null, position: null });
            }}
            onSubmit={(value) => {
              const action: PathAction = {
                id: crypto.randomUUID(),
                tool: "text",
                color: whiteboardState.strokeColor,
                fill: "transparent",
                weight: whiteboardState.weight,
                points: [annotation.position!],
                meta: { text: value, fontSize: 18 },
              };
              whiteboardActions.pushAction(action);
              setAnnotation({ type: null, position: null });
              engine()?.syncLayers(whiteboardState.layers);
            }}
          />
        )}
      
      </div>
      <footer class="viz-status-rail">
        <span class="viz-status">
          <span class="viz-status__label">Points</span>
          <strong>{pointTotal()}</strong>
        </span>
        <span class="viz-status">
          <span class="viz-status__label">Module</span>
          <strong>{activeLabel()}</strong>
        </span>
        <span class="viz-status">
          <span class="viz-status__label">Origin</span>
          <strong>{datasetOrigin()}</strong>
        </span>
        <span class="viz-status">
          <span class="viz-status__label">Mode</span>
          <strong>{whiteboardState.interactionMode}</strong>
        </span>
      </footer>
    </div>
  );
}

interface AnnotationPopupProps {
  position: Point;
  mode: "text";
  onCancel: () => void;
  onSubmit: (value: string) => void;
}

function AnnotationPopup(props: AnnotationPopupProps) {
  const [value, setValue] = createSignal("");
  const [background, setBackground] = createSignal("#fef3c7");

  let inputRef: HTMLInputElement | HTMLTextAreaElement | undefined;

  onMount(() => {
    inputRef?.focus();
  });

  const handleSubmit = (event: Event) => {
    event.preventDefault();
    props.onSubmit(value());
  };

  const style = {
    left: `${props.position.x}px`,
    top: `${props.position.y}px`,
  };

  return (
    <form class="annotation-popup" style={style} onSubmit={handleSubmit}>
      <input
        ref={inputRef as HTMLInputElement}
        type="text"
        placeholder="Type label"
        value={value()}
        onInput={(event) => setValue(event.currentTarget.value)}
      />
      <div class="actions">
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="submit">Add</button>
      </div>
    </form>
  );
}
