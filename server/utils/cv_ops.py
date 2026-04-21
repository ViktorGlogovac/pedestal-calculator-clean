#!/usr/bin/env python3
"""
OpenCV operations for the pedestal calculator pipeline.

Called from Node.js via child_process.spawn.
Reads a JSON command from stdin, writes a JSON result to stdout.

Commands:
  preprocess   - adaptive threshold + morphological close
  extract      - Canny + HoughLinesP + findContours
  trace_outline - trace the dominant outer contour from a binary sketch image
  build_mask   - draw text bounding boxes as white rectangles on black image
  draw_overlay - draw lines/circles/polygons on an image for debug
"""

import sys
import json
import os
import base64
import traceback

import cv2
import numpy as np


def read_image(path):
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError(f"Could not read image: {path}")
    return img


def write_image(path, img):
    cv2.imwrite(path, img)


# ─── preprocess ───────────────────────────────────────────────────────────────

def cmd_preprocess(args):
    """
    Adaptive threshold + notebook line removal + morphological close.

    Pipeline:
      1. Adaptive threshold (handles uneven lighting)
      2. Horizontal notebook line removal via morphological subtraction
         - Detects lines spanning >= 55 % of image width (ruled paper lines
           span 85-95 % of width; sketch edges are much shorter)
         - Dilates detections 1 px vertically to erase edge artefacts
         - Subtracts them from the binary image
      3. Morphological close to bridge small gaps in hand-drawn sketch lines

    Returns the output path.
    """
    img = read_image(args["imagePath"])
    H, W = img.shape[:2]

    # Convert to grayscale
    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img

    # ── Step 1: Adaptive threshold ─────────────────────────────────────────
    thresh = cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        15, 10
    )

    # ── Step 2: Notebook line removal ─────────────────────────────────────
    # Morphological operations treat white (255) as foreground.
    # thresh has white = background, black = ink.
    # Invert so ink is foreground (255) for the morphology, then re-invert.
    binary_inv = cv2.bitwise_not(thresh)

    # Horizontal opening with a wide kernel detects only long continuous
    # horizontal features (notebook ruled lines).  55 % of image width is
    # well above any horizontal sketch edge but well below a full-width rule.
    h_len = max(40, int(W * 0.55))
    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (h_len, 1))
    h_lines = cv2.morphologyEx(binary_inv, cv2.MORPH_OPEN, h_kernel, iterations=2)

    # Dilate detections 1 px vertically to remove the residual dark border
    # that the adaptive threshold leaves right at the edge of each ruled line.
    v_expand = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 3))
    h_lines_expanded = cv2.dilate(h_lines, v_expand, iterations=1)

    # Remove the detected lines from the inverted binary
    cleaned_inv = cv2.subtract(binary_inv, h_lines_expanded)

    # Back to convention: white = background, black = ink
    cleaned = cv2.bitwise_not(cleaned_inv)

    # ── Step 3: Morphological close ────────────────────────────────────────
    # Bridge small gaps in hand-drawn sketch lines that were not part of
    # any ruled line.
    close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    closed = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, close_kernel)

    write_image(args["outputPath"], closed)
    return {"outputPath": args["outputPath"]}


# ─── extract ──────────────────────────────────────────────────────────────────

def cmd_extract(args):
    """
    Line extraction (LSD preferred, HoughLinesP fallback) + findContours.

    LSD (Linear Segment Detector) is parameter-free, uses an a-contrario
    false-detection framework, and handles fragmented/low-contrast edges
    better than Hough voting.  Falls back to Canny + HoughLinesP if LSD is
    not available in this OpenCV build.

    Returns normalised line segments and contour polygons.
    """
    import math

    img = read_image(args["imagePath"])
    W, H = img.shape[1], img.shape[0]

    # Grayscale
    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img.copy()

    # Gaussian blur (used by both paths)
    blur_k = args.get("blurKsize", 5)
    blurred = cv2.GaussianBlur(gray, (blur_k, blur_k), 0)

    lines_out = []
    edges = None  # used by contour path below; set in whichever branch runs

    # ── Primary: LSD ──────────────────────────────────────────────────────────
    lsd_ok = False
    try:
        lsd = cv2.createLineSegmentDetector(0)
        lsd_lines, widths, prec, nfa = lsd.detect(blurred)
        if lsd_lines is not None and len(lsd_lines) > 0:
            lsd_ok = True
            for i, line in enumerate(lsd_lines):
                x1, y1, x2, y2 = line[0]
                dx, dy = x2 - x1, y2 - y1
                angle = math.atan2(dy, dx) * 180 / math.pi
                length = math.sqrt(dx * dx + dy * dy)
                # LSD width is a proxy for stroke confidence
                w = float(widths[i][0]) if widths is not None else 1.0
                lines_out.append({
                    "p1": {"x": x1 / W, "y": y1 / H},
                    "p2": {"x": x2 / W, "y": y2 / H},
                    "angle": angle,
                    "length": length / max(W, H),
                    "votes": max(1, round(w)),
                })
    except Exception:
        lsd_ok = False

    # ── Fallback: Canny + HoughLinesP ─────────────────────────────────────────
    if not lsd_ok:
        edges = cv2.Canny(blurred, args.get("cannyLow", 40), args.get("cannyHigh", 120))
        raw_lines = cv2.HoughLinesP(
            edges,
            rho=args.get("houghRho", 1),
            theta=np.pi / 180,
            threshold=args.get("houghMinVotes", 50),
            minLineLength=args.get("houghMinLen", 30),
            maxLineGap=args.get("houghMaxGap", 10),
        )
        if raw_lines is not None:
            for line in raw_lines:
                x1, y1, x2, y2 = line[0]
                dx, dy = x2 - x1, y2 - y1
                angle = math.atan2(dy, dx) * 180 / math.pi
                length = math.sqrt(dx * dx + dy * dy)
                lines_out.append({
                    "p1": {"x": x1 / W, "y": y1 / H},
                    "p2": {"x": x2 / W, "y": y2 / H},
                    "angle": angle,
                    "length": length / max(W, H),
                    "votes": 1,
                })

    # For contours we need an edge image regardless of which path ran above
    if edges is None:
        edges = cv2.Canny(blurred, args.get("cannyLow", 40), args.get("cannyHigh", 120))

    # findContours
    contours_raw, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours_out = []
    min_area = args.get("minContourArea", 500)
    approx_factor = args.get("approxEpsilonFactor", 0.01)

    for c in contours_raw:
        area = cv2.contourArea(c)
        if area < min_area:
            continue
        epsilon = approx_factor * cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, epsilon, True)
        pts = [{"x": int(p[0][0]) / W, "y": int(p[0][1]) / H} for p in approx]
        if len(pts) >= 3:
            contours_out.append(pts)

    # Sort largest first
    contours_out.sort(key=lambda c: _poly_area(c), reverse=True)
    contours_out = contours_out[:5]

    # Text regions (edge density heuristic)
    text_regions = _detect_text_regions(edges, W, H)

    # Corner detection (line intersections)
    corners = _find_corners(lines_out, W, H)

    return {
        "imageSize": {"width": W, "height": H},
        "lines": lines_out,
        "contours": contours_out,
        "corners": corners,
        "textRegions": text_regions,
        "stats": {
            "lineCount": len(lines_out),
            "contourCount": len(contours_out),
            "cornerCount": len(corners),
            "textRegionCount": len(text_regions),
            "totalEdgePixels": int(np.count_nonzero(edges))
        }
    }


def cmd_trace_outline(args):
    """
    Trace the dominant outer contour from a preprocessed binary sketch image.
    Returns one normalized polygon approximating the outer boundary.
    """
    img = read_image(args["imagePath"])
    W, H = img.shape[1], img.shape[0]

    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img.copy()

    # Preprocessed images are typically black ink on white background.
    # Invert so the sketch lines become foreground (255) for contour extraction.
    _, thresh = cv2.threshold(gray, 220, 255, cv2.THRESH_BINARY_INV)

    # Remove any residual horizontal notebook lines that survived preprocessing.
    # The image is already inverted here (ink=255), so apply directly.
    h_len = max(40, int(W * 0.55))
    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (h_len, 1))
    h_lines = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, h_kernel, iterations=2)
    v_expand = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 3))
    h_lines_expanded = cv2.dilate(h_lines, v_expand, iterations=1)
    thresh = cv2.subtract(thresh, h_lines_expanded)

    # Bridge small breaks and thicken faint hand-drawn edges.
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=3)
    dilated = cv2.dilate(closed, kernel, iterations=1)

    contours_raw, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours_raw:
        return {"polygon": [], "area": 0}

    min_area = args.get("minContourArea", 1000)
    # Exclude near-full-image blobs caused by notebook lines merging into a single
    # page-spanning foreground mass. 85% of image area is the upper bound.
    max_area = W * H * 0.85
    contours_raw = [c for c in contours_raw if min_area <= cv2.contourArea(c) <= max_area]
    if not contours_raw:
        return {"polygon": [], "area": 0}

    best = max(contours_raw, key=cv2.contourArea)
    epsilon = args.get("approxEpsilonFactor", 0.004) * cv2.arcLength(best, True)
    approx = cv2.approxPolyDP(best, epsilon, True)
    pts = [{"x": float(p[0][0]) / W, "y": float(p[0][1]) / H} for p in approx]

    # If approxPolyDP over-simplified (e.g. jagged notebook-paper boundary → triangle),
    # fall back to the axis-aligned bounding rectangle of the contour, which always
    # produces exactly 4 usable vertices.
    if len(pts) < 4:
        x, y, bw, bh = cv2.boundingRect(best)
        pts = [
            {"x": x / W,         "y": y / H},
            {"x": (x + bw) / W,  "y": y / H},
            {"x": (x + bw) / W,  "y": (y + bh) / H},
            {"x": x / W,         "y": (y + bh) / H},
        ]

    return {
        "polygon": pts,
        "area": float(cv2.contourArea(best)) / float(W * H),
    }


def _poly_area(pts):
    area = 0
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        area += pts[i]["x"] * pts[j]["y"] - pts[j]["x"] * pts[i]["y"]
    return abs(area) / 2


def _detect_text_regions(edge_data, width, height):
    cell = 16
    thresh = 0.08
    regions = []
    rows = (height + cell - 1) // cell
    cols = (width + cell - 1) // cell
    for r in range(rows):
        for c in range(cols):
            x0, y0 = c * cell, r * cell
            x1, y1 = min(x0 + cell, width), min(y0 + cell, height)
            patch = edge_data[y0:y1, x0:x1]
            density = np.count_nonzero(patch) / patch.size
            if density > thresh:
                regions.append({
                    "x": x0 / width, "y": y0 / height,
                    "w": (x1-x0) / width, "h": (y1-y0) / height,
                    "density": float(density)
                })
    return regions


def _find_corners(lines, width, height):
    """Find line intersections as corners."""
    import math
    corners = []
    snap = 8

    def norm_to_px(l):
        return (
            l["p1"]["x"] * width, l["p1"]["y"] * height,
            l["p2"]["x"] * width, l["p2"]["y"] * height
        )

    for i in range(len(lines)):
        for j in range(i + 1, len(lines)):
            x1, y1, x2, y2 = norm_to_px(lines[i])
            x3, y3, x4, y4 = norm_to_px(lines[j])
            d1x, d1y = x2-x1, y2-y1
            d2x, d2y = x4-x3, y4-y3
            denom = d1x*d2y - d1y*d2x
            if abs(denom) < 1e-10:
                continue
            t = ((x3-x1)*d2y - (y3-y1)*d2x) / denom
            u = ((x3-x1)*d1y - (y3-y1)*d1x) / denom
            if not (-0.1 <= t <= 1.1 and -0.1 <= u <= 1.1):
                continue
            px = x1 + t * d1x
            py = y1 + t * d1y
            if px < 0 or px >= width or py < 0 or py >= height:
                continue
            dup = any(abs(c["x"]*width - px) < snap and abs(c["y"]*height - py) < snap for c in corners)
            if not dup:
                corners.append({"x": px / width, "y": py / height})

    return corners


# ─── polygonize ───────────────────────────────────────────────────────────────

def cmd_polygonize(args):
    """
    Take cleaned line segments (normalised [0,1] coords), close corner gaps
    with orthogonal bridging segments, then use Shapely polygonize to find
    all closed polygon faces.

    Why Shapely polygonize instead of the JS face-traversal:
      - polygonize() handles open/incomplete linework gracefully (returns
        whatever closed rings it can find instead of failing silently).
      - It does not require a perfectly embedded planar graph — partial
        closures still yield valid polygons.
      - Gap bridging adds short connecting segments at near-miss corners
        (the most common failure mode on hand-drawn sketches).

    Gap-closure strategy:
      For each pair of segment endpoints within gap_tol distance, add a
      direct bridging segment.  The bridge is only added when it is
      approximately axis-aligned (|dx| < gap/2 OR |dy| < gap/2), preventing
      spurious diagonal connections.

    Returns up to 8 polygons sorted by area descending, each as a list of
    normalised [0,1] vertices (no closing repeat).
    """
    import math

    try:
        from shapely.ops import polygonize, unary_union
        from shapely.geometry import LineString
    except ImportError:
        return {"polygons": [], "error": "shapely not installed; run: pip install shapely"}

    segs      = args.get("segments", [])
    W         = float(args.get("width",  1000))
    H         = float(args.get("height", 1000))
    gap_frac  = args.get("gapTolerance", 0.012)   # fraction of max(W, H)
    gap_px    = gap_frac * max(W, H)

    if not segs:
        return {"polygons": []}

    # Convert normalised → pixel coords
    def to_px(pt):
        return (pt["x"] * W, pt["y"] * H)

    px_segs = [(to_px(s["p1"]), to_px(s["p2"])) for s in segs]

    # ── Gap closure: collect all endpoints, bridge near-miss pairs ─────────────
    endpoints = []   # (seg_idx, coord)
    for i, (a, b) in enumerate(px_segs):
        endpoints.append((i, a))
        endpoints.append((i, b))

    bridge_segs = []
    for i in range(len(endpoints)):
        si, (ax, ay) = endpoints[i]
        for j in range(i + 1, len(endpoints)):
            sj, (bx, by) = endpoints[j]
            if si == sj:
                continue   # same segment
            dx, dy = abs(bx - ax), abs(by - ay)
            d = math.sqrt(dx * dx + dy * dy)
            if d < 0.5 or d > gap_px:
                continue   # too short (duplicate) or too far
            # Only add approximately axis-aligned bridges
            if dx < gap_px * 0.5 or dy < gap_px * 0.5:
                bridge_segs.append(((ax, ay), (bx, by)))

    # ── Build Shapely LineStrings ──────────────────────────────────────────────
    lines = []
    for (ax, ay), (bx, by) in px_segs:
        if math.hypot(bx - ax, by - ay) > 0.5:
            lines.append(LineString([(ax, ay), (bx, by)]))
    for (ax, ay), (bx, by) in bridge_segs:
        lines.append(LineString([(ax, ay), (bx, by)]))

    if not lines:
        return {"polygons": []}

    # ── Polygonize ─────────────────────────────────────────────────────────────
    result = list(polygonize(lines))
    if not result:
        # unary_union merges touching/overlapping lines before polygonizing
        result = list(polygonize(unary_union(lines)))

    out = []
    total_px = W * H
    for poly in result:
        area_frac = poly.area / total_px
        if area_frac < 0.003 or area_frac > 0.95:
            continue
        coords = list(poly.exterior.coords[:-1])   # drop the closing repeat
        pts = [{"x": x / W, "y": y / H} for x, y in coords]
        if len(pts) < 3:
            continue
        out.append({"vertices": pts, "area": round(area_frac, 5)})

    out.sort(key=lambda p: p["area"], reverse=True)
    return {"polygons": out[:8]}


# ─── build_mask ───────────────────────────────────────────────────────────────

def cmd_build_mask(args):
    """
    Draw white filled rectangles on a black image for each text bounding box.
    """
    W, H = int(args["width"]), int(args["height"])
    mask = np.zeros((H, W), dtype=np.uint8)

    for box in args["textBoxes"]:
        x1 = max(0, int(round(box["x"] * W)))
        y1 = max(0, int(round(box["y"] * H)))
        x2 = min(W-1, int(round((box["x"] + box["w"]) * W)))
        y2 = min(H-1, int(round((box["y"] + box["h"]) * H)))
        cv2.rectangle(mask, (x1, y1), (x2, y2), 255, -1)

    write_image(args["outputPath"], mask)
    return {"outputPath": args["outputPath"]}


# ─── draw_overlay ─────────────────────────────────────────────────────────────

def cmd_draw_overlay(args):
    """
    Draw debug overlays: lines, circles, rectangles, polygons.
    """
    img = read_image(args["imagePath"])
    if len(img.shape) == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)

    W, H = img.shape[1], img.shape[0]

    for op in args.get("ops", []):
        t = op["type"]
        color = tuple(reversed(op.get("color", [0, 255, 0])))  # RGB→BGR
        thickness = op.get("thickness", 1)

        if t == "line":
            x1 = int(round(op["x1"] * W)); y1 = int(round(op["y1"] * H))
            x2 = int(round(op["x2"] * W)); y2 = int(round(op["y2"] * H))
            cv2.line(img, (x1, y1), (x2, y2), color, thickness)

        elif t == "rect":
            x1 = int(round(op["x1"] * W)); y1 = int(round(op["y1"] * H))
            x2 = int(round(op["x2"] * W)); y2 = int(round(op["y2"] * H))
            cv2.rectangle(img, (x1, y1), (x2, y2), color, thickness)

        elif t == "circle":
            cx = int(round(op["cx"] * W)); cy = int(round(op["cy"] * H))
            cv2.circle(img, (cx, cy), op.get("radius", 4), color, thickness)

        elif t == "polyline":
            pts = np.array([
                [int(round(p["x"] * W)), int(round(p["y"] * H))]
                for p in op["points"]
            ], dtype=np.int32)
            cv2.polylines(img, [pts], op.get("closed", True), color, thickness)

        elif t == "text":
            x = int(round(op["x"] * W)); y = int(round(op["y"] * H))
            cv2.putText(img, op["text"], (x, y),
                        cv2.FONT_HERSHEY_SIMPLEX, op.get("scale", 0.4),
                        color, 1, cv2.LINE_AA)

    write_image(args["outputPath"], img)
    return {"outputPath": args["outputPath"]}


# ─── ocr ──────────────────────────────────────────────────────────────────────

def cmd_ocr(args):
    """
    Tesseract OCR on the image — returns all detected text with bounding boxes.
    Uses pytesseract PSM 11 (sparse text) so it finds isolated dimension labels.
    Falls back gracefully if pytesseract is not installed.
    """
    try:
        import pytesseract
    except ImportError:
        return {"items": [], "error": "pytesseract not installed; run: pip install pytesseract"}

    img = read_image(args["imagePath"])
    H, W = img.shape[:2]

    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img.copy()

    # Enhance contrast for better OCR on handwritten text
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)

    # Light denoising — keep ink strokes sharp
    denoised = cv2.GaussianBlur(enhanced, (3, 3), 0)

    # Sharpen: bring out pen strokes
    sharpened = cv2.addWeighted(enhanced, 1.5, denoised, -0.5, 0)

    # Run Tesseract with sparse-text mode (finds isolated labels anywhere)
    # Whitelist: digits, common dimension chars, units
    config = r'--psm 11 --oem 1 -c tessedit_char_whitelist=0123456789mMfFtTiInNcC\' "'
    try:
        data = pytesseract.image_to_data(
            sharpened,
            output_type=pytesseract.Output.DICT,
            config=config,
        )
    except Exception as e:
        return {"items": [], "error": str(e)}

    items = []
    n = len(data.get("text", []))
    for i in range(n):
        text = str(data["text"][i]).strip()
        if not text:
            continue
        try:
            conf = int(data["conf"][i])
        except (ValueError, TypeError):
            conf = 0
        if conf < 20:
            continue

        bx = data["left"][i]
        by = data["top"][i]
        bw = data["width"][i]
        bh = data["height"][i]
        if bw <= 0 or bh <= 0:
            continue

        items.append({
            "text": text,
            "x": bx / W,
            "y": by / H,
            "w": bw / W,
            "h": bh / H,
            "conf": min(1.0, conf / 100.0),
        })

    return {"items": items}


# ─── Main ─────────────────────────────────────────────────────────────────────

COMMANDS = {
    "preprocess":  cmd_preprocess,
    "extract":     cmd_extract,
    "trace_outline": cmd_trace_outline,
    "polygonize":  cmd_polygonize,
    "build_mask":  cmd_build_mask,
    "draw_overlay": cmd_draw_overlay,
    "ocr":         cmd_ocr,
}

if __name__ == "__main__":
    try:
        payload = json.load(sys.stdin)
        cmd = payload.get("cmd")
        if cmd not in COMMANDS:
            raise ValueError(f"Unknown command: {cmd}")
        result = COMMANDS[cmd](payload)
        print(json.dumps({"ok": True, "result": result}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e), "trace": traceback.format_exc()}))
        sys.exit(1)
