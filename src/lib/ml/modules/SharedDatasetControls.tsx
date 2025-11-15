import { For, Show } from "solid-js";
import type { Accessor } from "solid-js";
import type { ImagePreviewMeta, PaletteSwatch } from "./paletteUtils";

interface PaletteProps {
  status: Accessor<string>;
  imagePreview: Accessor<ImagePreviewMeta | null>;
  palette: Accessor<PaletteSwatch[]>;
  paletteK?: Accessor<number>;
  onPaletteKChange?: (value: number) => void;
  onUpload: (file: File) => Promise<void>;
  onClear: () => void;
  uploadId: string;
}

interface SharedDatasetControlsProps {
  pointCount: Accessor<number>;
  onPointCountChange: (value: number) => void;
  addMode: Accessor<boolean>;
  toggleAddMode: () => void;
  onNewLayout: () => void;
  palette: PaletteProps;
}

export function SharedDatasetControls(props: SharedDatasetControlsProps) {
  const preview = () => props.palette.imagePreview();
  const hasPreview = () => Boolean(preview());
  const paletteSwatches = () => props.palette.palette();
  const canAdjustPaletteK = () => Boolean(hasPreview() && props.palette.paletteK && props.palette.onPaletteKChange);

  const handleFileChange = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await props.palette.onUpload(file);
    input.value = "";
  };

  return (
    <section class="dataset-controls">
      <header>
        <h2>Image pixels</h2>
        <p>Global dataset settings apply to every clustering module.</p>
      </header>

      <div class="dataset-controls__row">
        <label for="dataset-density">
          Point density <span>{props.pointCount()} pts</span>
        </label>
        <input
          id="dataset-density"
          class="dataset-controls__slider"
          type="range"
          min="20"
          max="300"
          step="10"
          value={props.pointCount()}
          onInput={(event) => props.onPointCountChange(Number((event.currentTarget as HTMLInputElement).value))}
        />
      </div>

      <div class="dataset-controls__toggles">
        <button
          type="button"
          class="viz-chip"
          aria-pressed={props.addMode() ? "true" : "false"}
          classList={{ active: props.addMode() }}
          onClick={props.toggleAddMode}
        >
          {props.addMode() ? "Add points on" : "Add points off"}
        </button>
        <button type="button" class="viz-chip" onClick={props.onNewLayout}>
          New layout
        </button>
      </div>

      <details class="viz-accordion palette-panel" open={hasPreview() || paletteSwatches().length > 0}>
        <summary>
          <div class="palette-panel__summary">
            <span class="eyebrow">Image palette</span>
            <div>
              <h3>Compare dominant colors</h3>
              <p>Upload a screenshot or photo to see its palette beside your clustering canvas.</p>
            </div>
          </div>
        </summary>

        <div class="palette-panel__body">
          <div class="palette-upload">
            <label class="palette-upload__label" for={props.palette.uploadId}>
              Upload image
            </label>
            <input id={props.palette.uploadId} type="file" accept="image/*" onChange={handleFileChange} />
            <p class="palette-upload__hint">We downsample and cluster every pixel so you can talk palettes with k-means or DBSCAN.</p>
            <div class="palette-upload__actions">
              <Show when={preview()}>
                <button type="button" class="viz-preview__clear" onClick={props.palette.onClear}>
                  Clear image
                </button>
              </Show>
            </div>
          </div>

          <Show when={props.palette.status()}>
            {(status) => <p class="viz-preview__note">{status()}</p>}
          </Show>
          <Show when={canAdjustPaletteK()}>
            <div class="viz-field">
              <div class="viz-field__top">
                <label class="viz-field__label" for={`${props.palette.uploadId}-palette-k`}>Palette colors</label>
                <span class="viz-field__value">k = {props.palette.paletteK?.() ?? 0}</span>
              </div>
              <input
                id={`${props.palette.uploadId}-palette-k`}
                type="range"
                min="2"
                max="8"
                step="1"
                value={props.palette.paletteK?.() ?? 2}
                onInput={(e) => props.palette.onPaletteKChange?.(Number(e.currentTarget.value))}
              />
            </div>
          </Show>

          <div class="viz-preview">
            <figure class="viz-preview__thumb" classList={{ "viz-preview__thumb--empty": !hasPreview() }}>
              <Show
                when={preview()}
                keyed
                fallback={<span class="viz-preview__empty">Upload an image to see a thumbnail and sampled pixels.</span>}
              >
                {(current) => (
                  <>
                    <img src={current.url} alt={current.sourceName ?? "Palette source"} width={current.width} height={current.height} />
                    <figcaption>
                      <strong>{current.sourceName ?? "Palette source"}</strong>
                      <span>
                        {current.width}×{current.height}px
                      </span>
                    </figcaption>
                  </>
                )}
              </Show>
            </figure>

            <div class="viz-preview__swatches" role="list">
              <Show
                when={paletteSwatches().length > 0}
                fallback={<span class="viz-preview__placeholder">Run clustering or upload an image to populate the palette.</span>}
              >
                <For each={paletteSwatches()}>
                  {(swatch) => (
                    <span class="viz-preview__swatch" role="listitem">
                      <span class="viz-preview__chip" style={{ "background-color": swatch.color }} />
                      <span>{swatch.color}</span>
                      <span class="viz-preview__fraction">{(swatch.fraction * 100).toFixed(1)}%</span>
                    </span>
                  )}
                </For>
              </Show>
            </div>
          </div>

          <div class="palette-callout">
            <span class="palette-callout__label">Clustering for palettes</span>
            <ul>
              <li>Plot every pixel as a point in RGB space.</li>
              <li>Run k-means to collapse thousands of samples into a handful of centroids.</li>
              <li>Use each centroid’s weight to report the fraction of the image it represents.</li>
            </ul>
            <p>Compare those swatches with your dataset clusters to discuss cohesion, contrast, or outliers.</p>
          </div>
        </div>
      </details>
    </section>
  );
}
