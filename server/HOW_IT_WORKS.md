# Sketch-to-Deck-Plan Pipeline

Converts a photo of a hand-drawn deck sketch into a structured JSON layout ready for canvas rendering and pedestal calculation.

---

## Design Philosophy

The pipeline is **CV-first, AI-assisted**. Classical computer vision runs deterministically on every request. GPT-4o is invoked only as a fallback when CV fails — which happens often on hand-drawn notebook-paper sketches with corner gaps, ruled lines, or complex L-shapes.

```
Primary path:  Image → CV (LSD) → Graph → Polygon candidates → Best candidate
Fallback path: ↑ fails, bbox-only, or 4-corner result → GPT-4o perimeter reasoning
```

---

## Pipeline Overview

```
Upload
  │
  ▼
1.  Ingest            Validate file, assign session ID
  │
  ▼
2.  Preprocess        Sharpen → adaptive threshold → notebook-line removal → deskew
  │
  ├────────────────────────────────────┐
  ▼                                    ▼
3.  OCR                           4.  CV Extract
    GPT-4o Vision                      LSD → orthogonal-snapped
    (primary, replaces Tesseract)      line segments (via cv_ops.py)
  │                                    │
  │                               5.  Segment Classify
  │                                    Rule-based 6-class labeling
  │                                    │
  │                               6.  Line Graph
  │                                    Cluster segments into H-levels
  │                                    and V-columns; find intersections
  │                                    │
  │                               7.  Candidate Generation
  │                                    Enumerate closed polygon faces
  │                                    │ (if none: Shapely polygonize
  │                                    │  with orthogonal gap-closure)
  │                                    │
  └────────────────────────────────────┤
                                       │
                                  8.  Score + Select
                                       5-component deterministic scoring
                                       │
                                  9.  Normalize + Associate
                                       Snap vertices; link OCR to edges
                                       │
                                  ┌────┴──────────────────────────────────┐
                                  │ Did CV produce a good shape?          │
                                  │ (fails if: geometryFailed, bbox-only, │
                                  │  or best candidate has 4 corners)     │
                                  └────┬──────────────┬────────────────────┘
                               YES ◄───┘              └───► NO / 4-corner / bbox
                                  │                         │
                                  │                    10.  GPT-4o Shape Vision
                                  │                         3-step: walk → JSON → repair
                                  │                         + forceOrthogonal
                                  │                         + mergeCollinearEdges
                                  │                         + maybeRotate90
                                  │                         + associateVisionLabels
                                  │                         │
                                  └──────────────┬──────────┘
                                                 │
                                           11.  Finalize
                                                 Canvas coordinates + debug PNGs
```

---

## Stage 1 — Ingest (`pipeline/ingest.js`)

- Accepts multipart image upload (max 20 MB) via Multer
- Assigns a UUID session ID to every request
- Saves raw file to `server/uploads/`

---

## Stage 2 — Preprocess (`pipeline/preprocess.js` + `utils/cv_ops.py`)

Improves image quality before any detection. Applied in order:

1. **Resize** — caps to 2048 × 2048 px
2. **Grayscale + normalise** — stretches histogram to 0–255
3. **Sharpen** — σ=1.5 unsharp mask for faint pencil lines
4. **Linear contrast boost** — gain=1.35, offset=−25
5. **Adaptive threshold** (`cv.adaptiveThreshold`) — binarises despite uneven lighting
6. **Notebook-line removal** — morphological OPEN with a kernel spanning 55% of image width detects full-width horizontal rules; 1px vertical dilation; subtracted from the binary image before closing
7. **Morphological closing** (`MORPH_CLOSE 3×3`) — bridges gaps in hand-drawn lines
8. **Deskew** — Sobel gradient histogram estimates skew angle; Sharp corrects rotation

The notebook-line removal is the most important preprocessing step. Without it, ruled paper produces dozens of false horizontal structural segments that prevent polygon closure.

---

## Stage 3 — OCR (`pipeline/ocrVision.js`)

**GPT-4o Vision is the sole OCR step.** Tesseract.js was removed — it reliably returned 0 results on hand-drawn notebook sketches, so every request was falling through to the GPT-4o fallback anyway.

- Sends the original image to GPT-4o with a prompt focused on construction dimensions
- **Construction notation parser** (`utils/units.js`) normalises the output:

| Sketch text | Parsed |
|---|---|
| `31'6"` | 31.5 ft |
| `7'` | 7 ft |
| `5m`, `5 meters` | 5 m |
| `150mm` | 150 mm |
| `6"` | 6 in |

- Each item classified as `dimension`, `depth`, or `note`
- Returns normalised [0, 1] bounding boxes for spatial association

---

## Stage 4 — CV Extract (`pipeline/cvExtract.js` + `utils/cv_ops.py`)

Runs OpenCV (Python subprocess via `cv_ops.py`) to extract line segments:

| Step | Call | Purpose |
|---|---|---|
| Grayscale | `cvtColor` | Single channel |
| Detect | `cv2.createLineSegmentDetector(0)` | LSD — parameter-free, a-contrario false-detection control |
| Fallback | `Canny(40, 120)` + `HoughLinesP(minLen=30, maxGap=10)` | If LSD unavailable |

**LSD** (Line Segment Detector) replaced HoughLinesP. It handles fragmented edges better on hand-drawn input and requires no parameter tuning. LSD's `width` output is used as a votes proxy for downstream confidence scoring.

**Orthogonal snapping** — lines within 8° of horizontal → exactly horizontal; within 8° of vertical → exactly vertical.

All coordinates normalised to **[0, 1]**.

---

## Stage 5 — Segment Classification (`pipeline/segmentClassify.js`)

Each segment is classified into one of six classes using rule-based heuristics:

| Class | Meaning |
|---|---|
| `structural_boundary` | Deck perimeter edge — long, orthogonal, not overlapping text |
| `dimension_line` | Annotation line parallel to a structural edge |
| `witness_line` | Short perpendicular tick/extension connecting dim to boundary |
| `notebook_line` | Full-width horizontal background rule from lined paper |
| `leader_line` | Short pointer line from label to geometry |
| `noise` | Too short, too diagonal, or isolated |

Key features per segment: normalised length, angle deviation from H/V, text-mask overlap fraction, endpoint-to-text proximity, notebook y-grid membership, full-width flag, parallel-neighbour distance.

**Notebook grid detection**: finds long horizontal segments at regularly-spaced y-levels (period 0.008–0.12 of image height, coefficient of variation < 45%). Full-width segments at notebook y-levels are classified `notebook_line` and excluded from the graph.

Only `structural_boundary` segments proceed to the graph stage.

---

## Stage 6 — Line Graph (`pipeline/lineGraph.js`)

A single LSD segment often corresponds to a fragment of a longer wall. The graph stage merges fragments.

**Algorithm:**

1. Cluster H-segments by y-coordinate (tolerance 0.025); compute length-weighted mean y per cluster
2. Cluster V-segments by x-coordinate (tolerance 0.025); same
3. Merge overlapping x-ranges within each H-level (gap bridge 0.018); same for V-columns
4. Find all (H-level, V-column) intersections
5. Split each range at its intersection x or y values
6. Nodes = intersection points; edges = consecutive split points within a range

Result: `{ nodes: [{id, x, y}], edges: [{fromId, toId, horizontal}] }`

If fewer than 4 structural segments reach this stage, the input widens to include all non-noise, non-notebook segments longer than 0.05 normalised units.

---

## Stage 7 — Candidate Generation (`pipeline/candidateGen.js`)

Enumerates all closed interior face polygons using **tightest clockwise turn** traversal:

For each directed edge `(u→v)`, at `v` take the outgoing edge making the tightest clockwise (rightmost) turn from the arrival direction. Repeat until the start is revisited — that traces one face.

Clockwise turn priority for a rectilinear graph:

| Arrived going | First choice | Second | Third |
|---|---|---|---|
| RIGHT | DOWN | RIGHT | UP |
| DOWN | LEFT | DOWN | RIGHT |
| LEFT | UP | LEFT | DOWN |
| UP | RIGHT | UP | LEFT |

Candidates filtered to area 0.3%–95% of image (exterior face excluded).

**Fallback chain if no candidates found:**

1. **Shapely polygonize** (`pipeline/polygonize.js` + `cv_ops.py cmd_polygonize`) — bridges near-miss corner endpoints (within 1.2% of image diagonal) with short axis-aligned connecting segments, then runs `shapely.polygonize()` on the augmented line set. Returns up to 8 closed ring candidates. Requires `pip install shapely`; degrades silently if unavailable.
2. Contour from `cv.findContours + approxPolyDP` (outer hull of preprocessed binary image)
3. Traced outer outline from `cmd_trace_outline` in `cv_ops.py`
4. **Bounding box** of all structural segment endpoints — last resort; tagged `id='bbox-fallback'` to trigger the GPT-4o shape fallback downstream

---

## Stage 8 — Scoring + Selection (`pipeline/scorer.js`)

Each candidate is scored across five components:

| Component | Weight | Logic |
|---|---|---|
| Area | 0.30 | Sigmoid centred at 12% of image area |
| Orthogonality | 0.25 | Fraction of edges within 5° of H/V |
| Regularity | 0.15 | Score 1.0 for 4–8 edges; decreasing beyond 8 |
| OCR coverage | 0.20 | Fraction of OCR labels within 0.12 units of polygon edges |
| Aspect ratio | 0.10 | Penalises extremes (>8:1) |

Highest score wins. Fully deterministic — no AI ranking.

---

## Stage 9 — Normalize + Associate (`pipeline/normalize.js`, `pipeline/associate.js`)

### Normalization
- Merge vertices within 0.15 units
- Remove collinear intermediate points
- Remove zero-length edges
- Warn if closing edge is >5× median edge length

### OCR-to-segment spatial association (CV path)
Works in normalised [0, 1] image coordinates:

- Score = `(perpendicular_dist × 2.0 + midpoint_dist) × orientation_multiplier`
- Direction mismatch (horizontal label on vertical segment) → ×3.0 penalty
- Direction match → ×0.5 bonus
- Max association distance: 0.55 normalised units
- Ambiguity warning when two candidates score within 30% of each other

### Scale derivation
If labeled segments exist, derive per-axis real-world scale:
- `x_scale = label_value / geometric_length` over all horizontal labeled segments (take longest)
- `y_scale` same for vertical
- Apply to all vertices and depth points

If no labeled segments found, a default 40 ft scale is applied with a user-visible warning.

---

## Stage 10 — GPT-4o Shape Vision (`pipeline/shapeVision.js`)

**Fires when** any of these conditions are true:
- CV path produced no usable polygon (`geometryFailed = true`)
- The only result was the bounding-box fallback (`id === 'bbox-fallback'`)
- **The best CV candidate has exactly 4 corners** — LSD reliably finds the outer rectangle of L-shaped decks but misses short inner notch segments (e.g. 2–3 m vs 17 m overall), so a 4-corner result always goes through shape vision to check for complex shapes

### Why this is needed

Hand-drawn sketches on notebook paper frequently fail the CV path:
- Corner gaps prevent graph closure → no candidates
- Notebook line removal may not be complete → spurious structural segments
- L-shapes: LSD finds the outer rectangle confidently but the inner step is too short to survive classification, producing a 4-corner false positive

### Three-step pipeline

**Step 1 — Orientation + perimeter walk (GPT-4o, image + OCR hints)**

GPT-4o is shown the original image and a summary of OCR-detected labels with their image coordinates and inferred direction (labels near left/right edges → measuring vertical height; labels near top/bottom → measuring horizontal width).

It is asked to:
- State the deck orientation explicitly: `"ORIENTATION: deck is TALLER/WIDER"`
- Walk the perimeter clockwise from the top-left corner
- Output one segment per line: `RIGHT 6 m`, `DOWN 17 m`, etc.

**Step 2 — Convert walk to JSON (GPT-4o, text only)**

The perimeter walk from Step 1 is converted to absolute coordinates:
```json
{
  "unit": "m",
  "outerBoundary": [{"x": 0, "y": 0}, {"x": 6, "y": 0}, ...],
  "confidence": 0.8
}
```

**Step 3 — Verify and repair (GPT-4o, text only)**

Checks and fixes the JSON:
1. Orientation check — overall HEIGHT should match largest vertical label
2. Staircase collapse — only for zigzag steps < 5% of bounding box (drawing noise); real notch corners are preserved
3. Remove duplicate consecutive corners
4. Ensure polygon closure
5. All edges must be axis-aligned

### Post-processing (deterministic, after GPT-4o)

Applied in this order:

**`forceOrthogonal()`** — snaps any remaining diagonal edge to purely H or V by choosing the dominant axis (larger of |dx|, |dy|) and zeroing the other component. Fixes cases where GPT-4o returns slightly off-axis coordinates.

**`mergeCollinearEdges()`** — removes intermediate vertices where two consecutive edges travel the same direction (same axis and sign). Handles same-direction segments that step3 did not merge.

**`maybeRotate90()`** — corrects 90° orientation errors. GPT-4o frequently produces a landscape polygon for portrait sketches.
- **Primary signal**: Step 1 reasoning text — GPT-4o is prompted to write `"ORIENTATION: deck is TALLER"` or `"WIDER"`. If polygon is wider than tall and GPT-4o said TALLER → rotate 90° CCW: `(x, y) → (maxY − y, x)`.
- **Fallback signal**: OCR label positions — labels near cx < 0.25 or cx > 0.75 measure vertical heights; labels near cy < 0.20 or cy > 0.80 measure horizontal widths. If max vertical label > max horizontal label and polygon is wider → rotate.

### OCR label association (vision path)

The vision polygon lives in real-world meters/feet, not image [0,1] coordinates, so spatial association is not possible. Instead, **value matching** is used:

For each segment (geometric length in plan units) and each OCR item (parsedValue in same units):
- Relative error: `|parsedValue − geometricLength| / geometricLength`
- Candidates within 12% relative error
- Direction alignment bonus: ×0.4 score if label direction matches segment axis
- Direction mismatch penalty: ×2.5 score
- Greedy assignment sorted by score (lowest first); each OCR item used at most once

---

## Stage 11 — Finalize (`pipeline/finalize.js`, `pipeline/debugOverlay.js`)

### Canvas coordinate conversion

```
px = margin + ((dimension_in_m) × gridSize)
```

where `gridSize = 35 px/m`.

### Debug overlays (PNG, stored per session)

| Image | Content |
|---|---|
| `*_dbg_text.png` | Blue rectangles = OCR text regions |
| `*_dbg_classify.png` | Segments coloured by class (green=structural, orange=dimension, yellow=witness, grey=notebook, red=noise) |
| `*_dbg_graph.png` | Green dots at graph nodes, green lines for edges |
| `*_dbg_candidates.png` | Top 4 polygon candidates in different colours |

### Output document

```json
{
  "imageMetadata": { "width": 1200, "height": 900 },
  "deckPlan": {
    "unit": "m",
    "outerBoundary": [{"x": 0, "y": 0}, {"x": 6, "y": 0}, ...],
    "segments": [
      {
        "id": "s1",
        "start": {"x": 0, "y": 0},
        "end":   {"x": 6, "y": 0},
        "geometricLength": 6,
        "lengthLabel": {"rawText": "6m", "value": 6, "unit": "m", "confidence": 0.81},
        "confidence": 0.81
      }
    ],
    "depthPoints": [],
    "confidence": 0.6,
    "warnings": ["Shape fallback succeeded: used GPT-4o perimeter reasoning."]
  },
  "canvasShapes": [
    {"name": "main deck", "type": "add", "isLoopClosed": true, "points": [...]}
  ],
  "debugImages": {
    "textBoxes": "/uploads/abc123_dbg_text.png",
    "classifiedSegments": "/uploads/abc123_dbg_classify.png",
    "lineGraph": "/uploads/abc123_dbg_graph.png",
    "candidates": "/uploads/abc123_dbg_candidates.png"
  }
}
```

---

## API

```
POST /api/sketch/analyze
  Body: multipart/form-data
    image  — JPEG, PNG, or WebP; max 20 MB
    notes  — optional text guidance for GPT-4o (e.g. "the right edge is 6m")

  Response: JSON (see output document above)

GET /api/sketch/debug/:sessionId
  Returns full intermediate data for any of the last 50 sessions:
  raw candidates, scores, OCR items, classified segments, stage timings
```

---

## Error Resilience

Each stage is independently wrapped. Failures degrade gracefully:

| Stage fails | Effect |
|---|---|
| Preprocess | Uses un-enhanced original image |
| Text detect | Segment classify runs without text mask |
| OCR (GPT-4o Vision) | Zero OCR items; geometry returned without labels |
| CV extract (LSD) | Falls back to Canny + HoughLinesP; zero candidates fires shape vision |
| Line graph | Zero candidates; fallbacks fire |
| Candidate gen | Shape vision fallback fires |
| Shape vision (GPT-4o) | Warning added; no deck plan returned |
| Normalize | Partial plan returned |
| Debug overlays | Omitted from response; plan still returned |

All warnings from every stage are collected and returned in the API response under `warnings` and `deckPlan.warnings`.

---

## Known Limitations

| Problem | Status |
|---|---|
| L-shaped decks: LSD finds outer rectangle but misses inner notch | 4-corner trigger ensures GPT-4o shape vision always re-checks; costs one extra API call for genuine rectangles |
| Notebook line removal (morphological) is imperfect | Some ruled lines survive and generate false structural segments |
| OCR value matching requires segment lengths to be correct | If GPT-4o step2 produces wrong lengths, labels won't attach |
| GPT-4o is non-deterministic | Same sketch may produce slightly different outputs on repeated calls |
| Depth/height pedestal labels not yet associated on vision path | Depth points only work on the CV path |
