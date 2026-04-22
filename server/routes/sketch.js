/**
 * Sketch analysis route.
 *
 * POST /api/sketch/analyze now uses the simple Codex CLI image path for the
 * main shape: upload image → Codex returns a clockwise orthogonal walk → build
 * the existing deckPlan/canvasShapes response. The legacy CV/OCR helpers remain
 * in this file for older utilities/debug code, but the analyze response returns
 * before those stages run.
 *
 * GET /api/sketch/debug/:sessionId
 */

const express = require('express')
const path    = require('path')
const fs      = require('fs')

const { upload, processUpload, uploadsDir } = require('../pipeline/ingest')
const { preprocessImage }    = require('../pipeline/preprocess')
const { detectTextRegions }  = require('../pipeline/textDetect')
const { extractTextLocal }   = require('../pipeline/ocrLocal')
const { extractTextVision }  = require('../pipeline/ocrVision')
const { extractGeometryCV }  = require('../pipeline/cvExtract')
const { classifySegments }   = require('../pipeline/segmentClassify')
const { buildLineGraph }     = require('../pipeline/lineGraph')
const { generateCandidates } = require('../pipeline/candidateGen')
const { scoreCandidates }    = require('../pipeline/scorer')
const { normalizeDeckPlan }  = require('../pipeline/normalize')
const { associateLabels }    = require('../pipeline/associate')
const { toCanvasShapes, toCanvasDepthPoints, buildOutputDocument } = require('../pipeline/finalize')
const { polygonizeLines }    = require('../pipeline/polygonize')
const { traceOutline }       = require('../pipeline/outlineTrace')
const { extractShapeVision }  = require('../pipeline/shapeVision')
const { analyzeSketch }       = require('../pipeline/analyzeSketch')
const { analyzeDepths }       = require('../pipeline/analyzeDepths')
const { fileToBase64 } = require('../utils/imageUtils')
const {
  drawTextBoxes, drawClassifiedSegments, drawLineGraph, drawCandidates,
} = require('../pipeline/debugOverlay')

const router = express.Router()
const debugStore = new Map()   // Last 50 sessions

// ─── POST /api/sketch/analyze ─────────────────────────────────────────────────

router.post('/analyze', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'depthImage', maxCount: 1 }]), (req, res, next) => {
  (async () => {
  const startedAt = Date.now()
  const warnings = []
  const userNotes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : ''
  console.log(`[sketch] /analyze start files=${Object.keys(req.files || {}).join(',') || 'none'}`)

  // ── Stage 1: Ingest ───────────────────────────────────────────────────────
  let ingestResult
  try {
    const mainFile = req.files?.['image']?.[0] || req.file
    ingestResult = processUpload(mainFile, null)
  } catch (err) {
    return res.status(400).json({ success: false, error: `Ingest failed: ${err.message}`, warnings })
  }

  const { sessionId, originalPath } = ingestResult
  const debugData = { sessionId, originalPath, stages: {}, debugImages: {} }

  // ── Stage 2: Preprocess ───────────────────────────────────────────────────
  let preprocessResult
  try {
    preprocessResult = await preprocessImage(originalPath, sessionId, uploadsDir)
    debugData.stages.preprocess = {
      path: preprocessResult.preprocessedPath,
      width: preprocessResult.width,
      height: preprocessResult.height,
    }
    debugData.debugImages.original     = `/uploads/${path.basename(originalPath)}`
    debugData.debugImages.preprocessed = `/uploads/${path.basename(preprocessResult.preprocessedPath)}`
  } catch (err) {
    warnings.push(`Preprocess: ${err.message}`)
    preprocessResult = {
      preprocessedPath: originalPath,
      width: 0, height: 0,
      base64: fileToBase64(originalPath),
    }
  }

  const imgW = preprocessResult.width  || 800
  const imgH = preprocessResult.height || 600
  const imgPath = preprocessResult.preprocessedPath

  // ── Simple Codex CLI Analysis ─────────────────────────────────────────────
  // One image call returns one clockwise orthogonal walk.  No OCR/CV/fallback
  // path is used for the main shape.
  let codexResult = null
  try {
    codexResult = await analyzeSketch(originalPath, userNotes)
    debugData.stages.codexAnalysis = {
      corners: codexResult.outerBoundary.length,
      unit: codexResult.unit,
      segmentCount: codexResult.segments.length,
      imageSource: 'original',
    }
    warnings.push(...(codexResult.warnings || []))
    warnings.push(
      `Codex CLI analysis (original image): ` +
      `${codexResult.outerBoundary.length} corners, ${codexResult.segments.length} segments, unit=${codexResult.unit}`
    )
    console.log(
      `[sketch] Codex complete in ${Date.now() - startedAt}ms: ` +
      `${codexResult.outerBoundary.length} corners, ${codexResult.segments.length} segments`
    )
  } catch (err) {
    warnings.push(`Codex CLI analysis failed: ${err.message}`)
    debugData.stages.codexAnalysis = { error: err.message }
    console.warn(`[sketch] /analyze failed in ${Date.now() - startedAt}ms: ${err.message}`)
    return res.status(422).json({
      success: false,
      sessionId,
      error: err.message,
      debugImages: debugData.debugImages,
      warnings,
    })
  }

  if (codexResult && codexResult.outerBoundary.length >= 4) {
    const orthogonalBoundary = orthogonalizeMostlyAxisAlignedPoints(
      codexResult.outerBoundary,
      warnings,
      'Codex CLI primary'
    )
    codexResult.outerBoundary = orthogonalBoundary

    const segments = rebuildSegmentsForBoundary(codexResult.segments, codexResult.outerBoundary)

    // ── Optional: depth image ─────────────────────────────────────────────
    let depthPoints = []
    const depthFile = req.files?.['depthImage']?.[0]
    if (depthFile) {
      try {
        depthPoints = await analyzeDepths(depthFile.path, codexResult.outerBoundary, codexResult.unit)
        warnings.push(`Depth image analyzed: ${depthPoints.length} depth point${depthPoints.length !== 1 ? 's' : ''} extracted`)
      } catch (err) {
        warnings.push(`Depth image analysis failed: ${err.message}`)
      }
    }

    const deckPlan = {
      unit: codexResult.unit,
      outerBoundary: codexResult.outerBoundary,
      cutouts: [],
      segments,
      depthPoints,
      notes: [{ text: 'Shape extracted by simple Codex CLI image analysis', confidence: 0.85 }],
      confidence: 0.82,
      _alreadyScaled: true,
      allWarnings: warnings,
    }

    let canvasShapes = []
    try {
      canvasShapes = toCanvasShapes(deckPlan, 35)
    } catch (_) {}
    deckPlan.depthPoints = toCanvasDepthPoints(deckPlan, 35)

    const outputDoc = buildOutputDocument(deckPlan, canvasShapes, { width: imgW, height: imgH }, {
      detectedLines: [],
      detectedTextRegions: [],
      candidatePolygons: [],
      ocrItems: [],
      classifiedSegments: [],
      graph: { nodeCount: 0, edgeCount: 0 },
    })

    debugStore.set(sessionId, {
      ...debugData,
      ocrItems: [],
      deckPlan,
      canvasShapes,
      warnings,
      outputDoc,
      timestamp: new Date().toISOString(),
    })
    if (debugStore.size > 50) debugStore.delete(debugStore.keys().next().value)

    console.log(`[sketch] /analyze success in ${Date.now() - startedAt}ms`)
    return res.json({
      success: true,
      sessionId,
      outputDoc,
      deckPlan: {
        unit: deckPlan.unit,
        outerBoundary: deckPlan.outerBoundary,
        cutouts: deckPlan.cutouts,
        segments: deckPlan.segments,
        depthPoints: deckPlan.depthPoints,
        notes: deckPlan.notes,
        confidence: deckPlan.confidence,
        warnings,
        unmatchedLabels: [],
        alternateCandidates: [],
      },
      canvasShapes,
      debugImages: debugData.debugImages,
      warnings,
    })
  }

  return res.status(422).json({
    success: false,
    sessionId,
    error: 'Codex CLI did not return a usable polygon.',
    debugImages: debugData.debugImages,
    warnings,
  })

  // ── Stage 3: Text Detect ─────────────────────────────────────────────────
  let textResult = { textBoxes: [], maskPath: null }
  try {
    textResult = await detectTextRegions(imgPath, sessionId, uploadsDir)
    debugData.stages.textDetect = { boxCount: textResult.textBoxes.length }

    // Debug overlay: text boxes
    const tbOverlay = path.join(uploadsDir, `${sessionId}_dbg_text.png`)
    const tbPath = await drawTextBoxes(imgPath, textResult.textBoxes, tbOverlay)
    if (tbPath) debugData.debugImages.textBoxes = `/uploads/${path.basename(tbPath)}`
  } catch (err) {
    warnings.push(`Text detect: ${err.message}`)
    debugData.stages.textDetect = { error: err.message }
  }

  const textBoxes = textResult.textBoxes

  // ── Stage 4: OCR ─────────────────────────────────────────────────────────
  // OCR sources:
  //   1. pytesseract (server-side Python, PSM 11 sparse-text mode)
    //   2. Codex CLI vision
  // We merge them because local OCR can catch some clean labels while vision is
  // much better on handwritten/rotated notes. Using only one source is too brittle.
  let ocrItems = []
  try {
    const { runCV } = require('../utils/cvLoader')
    let pytesseractItems = []
    let visionItems = []

    // Try pytesseract first via cv_ops.py
    try {
      const ocrResult = await runCV('ocr', { imagePath: originalPath })
      if (ocrResult && Array.isArray(ocrResult.items) && ocrResult.items.length > 0) {
        // Convert pytesseract items to pipeline OCR format
        const { parseTextDimension, normalizeUnit } = require('../utils/units')
        pytesseractItems = ocrResult.items.map(item => {
          const clean = item.text.replace(/[^0-9'".ftinmcFTINMCmm°\-\/\s]/g, '').trim()
          const parsed = parseTextDimension(clean) || parseTextDimension(item.text)
          const bbox = { x: item.x, y: item.y, w: item.w, h: item.h }
          const dir = item.w > item.h ? 'horizontal' : 'vertical'
          return {
            text: item.text,
            normalized: clean,
            parsedValue: parsed?.value ?? null,
            parsedUnit: parsed?.unit ? normalizeUnit(parsed.unit) : null,
            bbox,
            confidence: item.conf,
            type: parsed?.value != null ? 'dimension' : 'note',
            orientation: 'normal',
            measureDir: dir,
            source: 'tesseract',
          }
        }).filter(item => item.parsedValue != null)
        warnings.push(`OCR: pytesseract found ${ocrResult.items.length} text items, ${pytesseractItems.length} parsed as dimensions`)
      }
    } catch (err) {
      warnings.push(`OCR pytesseract: ${err.message}`)
    }

    try {
      visionItems = await extractTextVision(originalPath, imgW, imgH)
      warnings.push(`OCR: vision found ${visionItems.length} candidate text items`)
    } catch (err) {
      warnings.push(`OCR vision: ${err.message}`)
    }

    ocrItems = mergeOcrItems(visionItems, pytesseractItems)

    if (ocrItems.length === 0 && pytesseractItems.length > 0) {
      ocrItems = pytesseractItems
    } else if (ocrItems.length === 0 && visionItems.length > 0) {
      ocrItems = visionItems
    }

    debugData.stages.ocr = {
      itemCount: ocrItems.length,
      items: ocrItems,
      source: visionItems.length > 0 && pytesseractItems.length > 0 ? 'merged' : visionItems.length > 0 ? 'vision' : 'tesseract',
      visionCount: visionItems.length,
      tesseractCount: pytesseractItems.length,
    }
  } catch (err) {
    warnings.push(`OCR: ${err.message}`)
    debugData.stages.ocr = { error: err.message }
  }

  // ── Stage 5: CV Extract ───────────────────────────────────────────────────
  let cvDetections = null
  try {
    cvDetections = await extractGeometryCV(imgPath)
    debugData.stages.cv = {
      lineCount: cvDetections.lines?.length || 0,
    }
  } catch (err) {
    warnings.push(`CV extract: ${err.message}`)
    debugData.stages.cv = { error: err.message }
  }

  const rawLines = cvDetections?.lines || []

  // ── Stage 6: Segment Classify ────────────────────────────────────────────
  let classifiedSegs = []
  try {
    classifiedSegs = classifySegments(rawLines, textBoxes, imgW, imgH)
    const byClass = {}
    for (const s of classifiedSegs) {
      byClass[s.bestClass] = (byClass[s.bestClass] || 0) + 1
    }
    debugData.stages.classify = byClass

    // Debug overlay: classified segments
    const csOverlay = path.join(uploadsDir, `${sessionId}_dbg_classify.png`)
    const csPath = await drawClassifiedSegments(imgPath, classifiedSegs, csOverlay)
    if (csPath) debugData.debugImages.classifiedSegments = `/uploads/${path.basename(csPath)}`
  } catch (err) {
    warnings.push(`Segment classify: ${err.message}`)
    classifiedSegs = rawLines.map(l => ({ ...l, bestClass: 'structural_boundary', classConfidence: 0.5 }))
  }

  // ── Stage 7: Line Graph (structural only) ─────────────────────────────────
  let graph = { nodes: [], edges: [] }
  let useLines = []  // Hoisted so Stage 8 bounding-box fallback can reference it
  try {
    const structuralLines = classifiedSegs
      .filter(s => s.bestClass === 'structural_boundary' && s.classConfidence > 0.40)
    // Fall back: if too few structural segments detected, use all non-noise long segments
    useLines = structuralLines.length >= 4 ? structuralLines
      : classifiedSegs.filter(s =>
          s.bestClass !== 'noise' && s.bestClass !== 'notebook_line' &&
          (s.length || 0) >= 0.04
        )

    graph = buildLineGraph(useLines)
    debugData.stages.lineGraph = { nodes: graph.nodes.length, edges: graph.edges.length, relaxedTolUsed: graph.relaxedTolUsed }

    if (graph.relaxedTolUsed) {
      warnings.push('Line graph: used relaxed corner-gap tolerance — sketch has large gaps at corners')
    }
    if (graph.nodes.length < 4) {
      warnings.push('Line graph has fewer than 4 nodes — sketch may be too faint or too sparse')
    }

    // Debug overlay: graph
    const lgOverlay = path.join(uploadsDir, `${sessionId}_dbg_graph.png`)
    const lgPath = await drawLineGraph(imgPath, graph, lgOverlay)
    if (lgPath) debugData.debugImages.lineGraph = `/uploads/${path.basename(lgPath)}`
  } catch (err) {
    warnings.push(`Line graph: ${err.message}`)
    debugData.stages.lineGraph = { error: err.message }
  }

  // ── Stage 8: Candidate Generation ────────────────────────────────────────
  let rawCandidates = []
  try {
    // ── Primary: OpenCV contour trace ─────────────────────────────────────
    // Trace the outer boundary directly from the preprocessed binary image.
    // This is the most reliable approach for hand-drawn complex shapes because
    // it works from pixel ink rather than from a graph of classified segments.
    try {
      const traced = await traceOutline(imgPath, { approxEpsilonFactor: 0.004 })
      debugData.stages.outlineTrace = {
        pointCount: traced.polygon.length,
        area: traced.area,
      }
      if (traced.polygon.length >= 4) {
        const contourCandidates = buildContourCandidates([traced.polygon])
        if (contourCandidates.length > 0) {
          rawCandidates = contourCandidates
          if (contourCandidates[0].vertices.length > 4) {
            warnings.push(`Candidate gen: contour trace found ${contourCandidates[0].vertices.length}-corner polygon`)
          }
        }
      }
    } catch (err) {
      warnings.push(`Candidate gen (contour trace): ${err.message}`)
    }

    // ── Secondary: JS face traversal on line graph ─────────────────────────
    // Only run if contour didn't find a complex shape (>4 corners).
    const contourCorners = rawCandidates[0]?.vertices?.length ?? 0
    if (contourCorners <= 4) {
      const graphCandidates = generateCandidates(graph)
      if (graphCandidates.length > 0) {
        // Prefer graph result only if it found more corners than contour
        if (graphCandidates[0].vertices.length > contourCorners) {
          rawCandidates = graphCandidates
          warnings.push(`Candidate gen: graph traversal found ${graphCandidates[0].vertices.length} corners (preferred over contour ${contourCorners})`)
        }
      }
    }

    // ── Tertiary: Shapely polygonize ───────────────────────────────────────
    if (rawCandidates.length === 0 || (rawCandidates[0]?.vertices?.length ?? 0) <= 4) {
      try {
        const graphEdgeSegs = graph.edges.map(e => {
          const from = graph.nodes.find(n => n.id === e.fromId)
          const to   = graph.nodes.find(n => n.id === e.toId)
          return from && to
            ? { p1: { x: from.x, y: from.y }, p2: { x: to.x, y: to.y } }
            : null
        }).filter(Boolean)

        const shapelyCandidates = await polygonizeLines(
          graphEdgeSegs.length >= 3 ? graphEdgeSegs : useLines,
          imgW, imgH
        )
        if (shapelyCandidates.length > 0 && shapelyCandidates[0].vertices.length > (rawCandidates[0]?.vertices?.length ?? 0)) {
          rawCandidates = shapelyCandidates
          warnings.push(`Candidate gen: Shapely polygonize found ${shapelyCandidates.length} candidate(s)`)
        }
      } catch (err) {
        warnings.push(`Candidate gen (Shapely): ${err.message}`)
      }
    }

    // ── Last resort: bounding box ──────────────────────────────────────────
    if (rawCandidates.length === 0 && useLines.length >= 2) {
      const bboxCandidates = buildBoundingBoxFromLines(useLines)
      if (bboxCandidates.length > 0) {
        rawCandidates = bboxCandidates
        warnings.push(`Candidate gen: all polygon methods failed — used axis-aligned bounding box (low confidence, edit manually)`)
      }
    }

    debugData.stages.candidates = {
      count: rawCandidates.length,
      corners: rawCandidates[0]?.vertices?.length ?? 0,
    }
    if (rawCandidates.length === 0) warnings.push('No closed polygon candidates found in structural graph')
  } catch (err) {
    warnings.push(`Candidate gen: ${err.message}`)
  }

  // ── Stage 9: Score Candidates ────────────────────────────────────────────
  let scoredCandidates = rawCandidates
  try {
    scoredCandidates = scoreCandidates(rawCandidates, ocrItems)
    debugData.stages.scoring = {
      count: scoredCandidates.length,
      topScore: scoredCandidates[0]?.score || 0,
    }

    // Debug overlay: top candidates
    if (scoredCandidates.length > 0) {
      const cdOverlay = path.join(uploadsDir, `${sessionId}_dbg_candidates.png`)
      const cdPath = await drawCandidates(imgPath, scoredCandidates, cdOverlay)
      if (cdPath) debugData.debugImages.candidates = `/uploads/${path.basename(cdPath)}`
    }
  } catch (err) {
    warnings.push(`Scoring: ${err.message}`)
  }

  // ── Stage 10: Apply Best Candidate ───────────────────────────────────────
  let deckPlan = null
  try {
    if (scoredCandidates.length > 0) {
      const best = scoredCandidates[0]
      const rawPlan = buildRawPlan(best, ocrItems, classifiedSegs)
      const normalized = normalizeDeckPlan(rawPlan)
      warnings.push(...(normalized.warnings || []))

      // Associate OCR labels deterministically
      const assocResult = associateLabels(
        ocrItems, normalized.segments, normalized.outerBoundary
      )
      warnings.push(...assocResult.warnings)

      normalized.segments   = filterScaleOutliers(assocResult.enrichedSegments, warnings)
      normalized.depthPoints = mergePoints(normalized.depthPoints, assocResult.depthPoints)
      normalized.notes      = mergeNotes(normalized.notes, assocResult.notes)
      normalized.confidence = computeConfidence(best, assocResult, ocrItems)

      // Convert from normalised [0,1] image coordinates to real-world feet.
      // Without this step, toCanvasShapes would interpret e.g. x=0.989 as
      // 0.989 feet (~30 cm) instead of ~33 feet — causing the canvas shape
      // to appear as a tiny dot.
      if (!normalized._alreadyScaled) {
        applyRealWorldScale(normalized, warnings)
      }

      normalized.allWarnings = warnings

      // Attach alternate candidates
      normalized.alternateCandidates = scoredCandidates.slice(1, 4).map(c => ({
        vertices: c.vertices,
        area: c.area,
        score: c.score,
      }))

      // Unmatched labels
      normalized.unmatchedLabels = assocResult.unassociatedItems || []

      deckPlan = normalized
      debugData.stages.apply = {
        vertexCount: deckPlan.outerBoundary?.length || 0,
        confidence: deckPlan.confidence,
      }
    } else {
      warnings.push('No candidates available — returning empty deck plan')
    }
  } catch (err) {
    warnings.push(`Apply/normalize: ${err.message}`)
    debugData.stages.apply = { error: err.message }
  }

  // ── Stage 11: Finalize ────────────────────────────────────────────────────
  let canvasShapes = []
  try {
    if (deckPlan) {
      deckPlan = orthogonalizeDeckPlan(deckPlan, warnings, 'deterministic geometry')
      canvasShapes = toCanvasShapes(deckPlan, 35)
    }
  } catch (err) {
    warnings.push(`Finalize: ${err.message}`)
  }
  if (deckPlan) {
    deckPlan.depthPoints = toCanvasDepthPoints(deckPlan, 35)
  }

  const deckPlanAgreement = evaluateDeckPlanAgainstOcr(deckPlan, ocrItems)
  if (deckPlanAgreement.warnings.length > 0) warnings.push(...deckPlanAgreement.warnings)

  // Detect whether geometry only produced a last-resort bounding box.
  // The scorer replaces scoreDetails, so we check the preserved 'id' field
  // instead of the isBBoxFallback flag (which gets wiped by the spread).
  const usedBBoxFallback = scoredCandidates.length > 0 &&
    scoredCandidates[0]?.id === 'bbox-fallback'

  // Fire shape vision when geometry could not produce a reliable polygon.
  // Cases:
  //   (a) geometry failed entirely
  //   (b) geometry produced only a bounding-box fallback
  //   (c) CV produced a simple 4-corner rectangle but OCR found enough
  //       distinct dimension labels to suggest the shape is more complex
  //       (e.g. an L-shape with 6-8 labeled sides).  LSD now reliably finds
  //       the outer rectangle of an L, but misses the short inner notch
  //       segments — triggering this condition saves a bad CV result.
  const geometryFailed = !deckPlan || canvasShapes.length === 0

  // CV reliably finds the outer bounding rectangle of an L-shape (LSD is
  // good at long edges) but consistently misses short inner notch segments.
  // Result: CV produces a confident 4-corner rectangle even for L-shapes.
  // Rule: if CV only found 4 corners, always run shape vision to verify.
  // For a genuine rectangle this adds one API call but confirms the shape.
  // For an L-shape it catches the error before it reaches the user.
  const cvOnlyFoundRect = scoredCandidates.length > 0 &&
    (scoredCandidates[0]?.vertices?.length ?? scoredCandidates[0]?.edgeCount ?? 0) === 4

  const lowDimensionAgreement = deckPlanAgreement.lowConfidence
  const shouldUseShapeFallback = geometryFailed || usedBBoxFallback || cvOnlyFoundRect || lowDimensionAgreement

  console.log(
    `[sketch] shouldUseShapeFallback=${shouldUseShapeFallback} geometryFailed=${geometryFailed} ` +
    `usedBBoxFallback=${usedBBoxFallback} cvOnlyFoundRect=${cvOnlyFoundRect} ` +
    `lowDimensionAgreement=${lowDimensionAgreement} agreementScore=${deckPlanAgreement.score.toFixed(3)} ` +
    `bestVertices=${scoredCandidates[0]?.vertices?.length ?? 0}`
  )

  if (shouldUseShapeFallback && !warnings.some(w => w.includes('Shape fallback succeeded'))) {
    try {
      // Send the preprocessed image (notebook lines removed) so Codex sees a
      // clean outline rather than the raw photo full of ruled-paper noise.
      const shapeImagePath = (imgPath && imgPath !== originalPath) ? imgPath : originalPath
      console.log(`[sketch] running shape vision on: ${shapeImagePath}`)
      const visionPlan = await extractShapeVision(shapeImagePath, userNotes, ocrItems)
      if (visionPlan) {
        const normalizedVision = normalizeDeckPlan(visionPlan)
        normalizedVision._alreadyScaled = true
        // Prefer vision when:
        //   (a) geometry failed entirely
        //   (b) geometry only produced a bounding-box fallback
        //   (c) CV found a 4-corner rectangle but vision found a more complex shape —
        //       this is the L-shape case where LSD confidently finds the outer rect
        //       but misses inner notch segments
        const visionCorners = normalizedVision.outerBoundary?.length || 0
        const shouldPreferVision =
          !deckPlan ||
          canvasShapes.length === 0 ||
          usedBBoxFallback ||
          (cvOnlyFoundRect && visionCorners > 4)

        console.log(`[sketch] visionCorners=${visionCorners} shouldPreferVision=${shouldPreferVision}`)

        if (shouldPreferVision) {
          // Associate OCR labels to vision segments by value matching.
          // Vision segments are in real-world coordinates (meters/feet), so
          // spatial association in image [0,1] coords doesn't work. Instead
          // match each OCR parsedValue to the closest segment geometricLength.
          normalizedVision.segments = associateVisionLabels(
            ocrItems, normalizedVision.segments, normalizedVision.unit
          )
          const visionAgreement = evaluateDeckPlanAgainstOcr(normalizedVision, ocrItems)

          if (!lowDimensionAgreement || visionAgreement.score >= deckPlanAgreement.score + 0.12 || visionAgreement.criticalCount < deckPlanAgreement.criticalCount) {
            const cleanedVision = orthogonalizeDeckPlan(normalizedVision, warnings, 'shape fallback')
            cleanedVision.allWarnings = [
              ...(normalizedVision.warnings || []),
              ...warnings,
              'Shape fallback succeeded: used Codex CLI perimeter reasoning because deterministic polygon extraction did not produce a usable result.',
            ]
            deckPlan = cleanedVision
            canvasShapes = toCanvasShapes(deckPlan, 35)
            warnings.push(
              `Shape fallback succeeded: used Codex CLI perimeter reasoning ` +
              `(dimension agreement ${visionAgreement.score.toFixed(2)} vs ${deckPlanAgreement.score.toFixed(2)}).`
            )
          } else {
            warnings.push(
              `Shape fallback ran but kept deterministic shape because vision agreement ` +
              `(${visionAgreement.score.toFixed(2)}) did not beat current shape (${deckPlanAgreement.score.toFixed(2)}).`
            )
          }
        } else {
          warnings.push('Shape fallback ran but kept deterministic shape because it appeared simpler and more stable.')
        }

        debugData.stages.shapeFallback = {
          used: true,
          preferred: shouldPreferVision,
          vertexCount: normalizedVision.outerBoundary?.length || 0,
          confidence: normalizedVision.confidence || 0,
          trace: visionPlan._visionTrace || '',
        }
      }
    } catch (err) {
      warnings.push(`Shape fallback: ${err.message}`)
      debugData.stages.shapeFallback = { used: false, error: err.message }
    }
  }

  // Only warn about "no shape" when shapeVision also couldn't run (e.g. no API key).
  if ((!deckPlan || canvasShapes.length === 0) && !warnings.some(w => w.includes('Shape fallback'))) {
    warnings.push(
      'Geometry could not produce a reliable polygon and shape vision fallback did not run (check API key).'
    )
  }

  const outputDoc = buildOutputDocument(deckPlan, canvasShapes, { width: imgW, height: imgH }, {
    detectedLines:       cvDetections?.lines     || [],
    detectedTextRegions: textBoxes,
    candidatePolygons:   scoredCandidates.map(c => c.vertices),
    ocrItems,
    classifiedSegments:  classifiedSegs,
    graph: { nodeCount: graph.nodes.length, edgeCount: graph.edges.length },
  })

  // Store debug session
  debugStore.set(sessionId, {
    ...debugData, ocrItems, classifiedSegs, scoredCandidates,
    deckPlan, canvasShapes, warnings, outputDoc,
    timestamp: new Date().toISOString(),
  })
  if (debugStore.size > 50) debugStore.delete(debugStore.keys().next().value)

  return res.json({
    success:     true,
    sessionId,
    outputDoc,
    deckPlan:    deckPlan ? {
      unit:          deckPlan.unit,
      outerBoundary: deckPlan.outerBoundary,
      cutouts:       deckPlan.cutouts,
      segments:      deckPlan.segments,
      depthPoints:   deckPlan.depthPoints,
      notes:         deckPlan.notes,
      confidence:    deckPlan.confidence,
      warnings:      deckPlan.allWarnings || [],
      unmatchedLabels:     deckPlan.unmatchedLabels || [],
      alternateCandidates: deckPlan.alternateCandidates || [],
    } : null,
    canvasShapes,
    debugImages: debugData.debugImages,
    warnings,
  })
  })().catch(next)
})

// ─── GET /api/sketch/debug/:sessionId ─────────────────────────────────────────

router.get('/debug/:sessionId', (req, res) => {
  const data = debugStore.get(req.params.sessionId)
  if (!data) return res.status(404).json({ success: false, error: `No debug data for session: ${req.params.sessionId}` })
  return res.json({ success: true, data })
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the raw deck plan from the top-scored candidate polygon.
 * Attaches any available segment evidence from classified segments.
 */
function buildRawPlan(candidate, ocrItems, classifiedSegs) {
  const vertices  = candidate.vertices.map(v => ({ x: v.x, y: v.y }))
  const segments  = vertices.map((v, i) => {
    const next = vertices[(i + 1) % vertices.length]
    return {
      id: `s${i + 1}`,
      start: v,
      end: next,
      geometricLength: Math.hypot(next.x - v.x, next.y - v.y),
      lengthLabel: null,
      inferred: false,
      confidence: 0.5,
    }
  })

  return {
    unit: inferUnit(ocrItems),
    outerBoundary: vertices,
    cutouts: [],
    segments,
    depthPoints: [],
    notes: [],
    confidence: candidate.score || 0.3,
    warnings: [],
  }
}

/**
 * Infer the measurement unit from the most common parsed unit in OCR items.
 */
function inferUnit(ocrItems) {
  const counts = {}
  for (const item of ocrItems) {
    if (item.parsedUnit && item.parsedUnit !== 'unknown') {
      counts[item.parsedUnit] = (counts[item.parsedUnit] || 0) + 1
    }
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const best = entries[0]?.[0]
  // Map normalised unit names to canonical output units
  if (!best) return 'ft'
  if (best === 'feet')   return 'ft'
  if (best === 'meters') return 'm'
  return best
}

function shouldAugmentWithVision(ocrItems) {
  if (!ocrItems || ocrItems.length === 0) return true

  const parsedItems = ocrItems.filter(i => i.parsedValue != null)
  const dimensionItems = ocrItems.filter(i => i.type === 'dimension' && i.parsedValue != null)
  const confidentDimensionItems = dimensionItems.filter(i => (i.confidence || 0) >= 0.45)
  const compoundItems = dimensionItems.filter(i => /['\u2032`].+["\u2033]/.test(i.text || ''))

  // Hand-drawn plans usually need at least a couple of usable dimensions to
  // anchor the scale and score the correct polygon candidate.
  return (
    parsedItems.length < 3 ||
    confidentDimensionItems.length < 2 ||
    compoundItems.length === 0
  )
}

function mergeOcrItems(localItems, visionItems) {
  const merged = [...(localItems || [])]

  for (const visionItem of (visionItems || [])) {
    const existingIndex = merged.findIndex(localItem => ocrItemsLikelySame(localItem, visionItem))
    if (existingIndex === -1) {
      merged.push(visionItem)
      continue
    }

    const existing = merged[existingIndex]
    if (isBetterOcrCandidate(visionItem, existing)) {
      merged[existingIndex] = {
        ...existing,
        ...visionItem,
        source: [existing.source, visionItem.source].filter(Boolean).join('+') || 'local+vision',
      }
    }
  }

  return merged
}

function ocrItemsLikelySame(a, b) {
  if (!a?.bbox || !b?.bbox) return false

  const ac = { x: a.bbox.x + a.bbox.w / 2, y: a.bbox.y + a.bbox.h / 2 }
  const bc = { x: b.bbox.x + b.bbox.w / 2, y: b.bbox.y + b.bbox.h / 2 }
  const near = Math.hypot(ac.x - bc.x, ac.y - bc.y) < 0.08
  if (!near) return false

  const norm = t => String(t || '').toLowerCase().replace(/[\s'"′″`]/g, '')
  const ta = norm(a.text)
  const tb = norm(b.text)
  return ta === tb || (ta && tb && (ta.startsWith(tb) || tb.startsWith(ta)))
}

function isBetterOcrCandidate(candidate, current) {
  const candidateParsed = candidate?.parsedValue != null
  const currentParsed = current?.parsedValue != null
  if (candidateParsed !== currentParsed) return candidateParsed

  const candidateDimension = candidate?.type === 'dimension'
  const currentDimension = current?.type === 'dimension'
  if (candidateDimension !== currentDimension) return candidateDimension

  return (candidate?.confidence || 0) > (current?.confidence || 0)
}

/**
 * Compute confidence from scoring and label coverage.
 */
function computeConfidence(candidate, assocResult, ocrItems) {
  let conf = candidate.score * 0.6  // Base from geometric scoring

  const dims = ocrItems.filter(i => i.type === 'dimension').length
  const matched = (assocResult.enrichedSegments || []).filter(s => s.lengthLabel).length
  if (dims > 0) {
    conf += (matched / dims) * 0.3
  } else {
    conf += 0.15  // Neutral bonus if no dimensions expected
  }

  // Penalise low vertex counts (fewer than 4 vertices → suspicious)
  if (candidate.vertices.length < 4) conf *= 0.5

  return Math.max(0, Math.min(1, +conf.toFixed(3)))
}

function evaluateDeckPlanAgainstOcr(deckPlan, ocrItems) {
  const dims = (ocrItems || []).filter(item => item?.type === 'dimension' && item.parsedValue != null && item.parsedValue > 0)
  if (!deckPlan || !Array.isArray(deckPlan.segments) || deckPlan.segments.length === 0 || dims.length === 0) {
    return { score: 0.5, lowConfidence: false, criticalCount: 0, warnings: [] }
  }

  const bbox = computePlanBoundingBox(deckPlan.segments)
  const warnings = []
  const valuesByDir = { horizontal: [], vertical: [] }
  for (const item of dims) {
    if (item.measureDir === 'horizontal' || item.measureDir === 'vertical') {
      valuesByDir[item.measureDir].push(item.parsedValue)
    }
  }
  const largestHorizontal = valuesByDir.horizontal.length > 0 ? Math.max(...valuesByDir.horizontal) : null
  const largestVertical = valuesByDir.vertical.length > 0 ? Math.max(...valuesByDir.vertical) : null

  let total = 0
  let count = 0
  let criticalCount = 0

  for (const item of dims) {
    const best = bestSegmentMatchForItem(item, deckPlan.segments, bbox)
    if (!best) continue

    count++
    total += best.score

    const isCritical =
      (item.measureDir === 'vertical' && largestVertical != null && Math.abs(item.parsedValue - largestVertical) < 0.001) ||
      (item.measureDir === 'horizontal' && largestHorizontal != null && Math.abs(item.parsedValue - largestHorizontal) < 0.001)

    if (isCritical && best.score < 0.45) {
      criticalCount++
      warnings.push(
        `Dimension check: largest ${item.measureDir} label "${item.text}" does not align well with any ${item.measureDir} edge ` +
        `(best match ${best.segment.id} score ${best.score.toFixed(2)}).`
      )
    }
  }

  const score = count > 0 ? total / count : 0.5
  return {
    score,
    criticalCount,
    lowConfidence: score < 0.62 || criticalCount > 0,
    warnings,
  }
}

function bestSegmentMatchForItem(item, segments, bbox) {
  const preferredSide = inferPreferredSideFromOcr(item)
  let best = null

  for (const segment of segments || []) {
    const horizontal = Math.abs(segment.end.x - segment.start.x) >= Math.abs(segment.end.y - segment.start.y)
    if (item.measureDir === 'horizontal' && !horizontal) continue
    if (item.measureDir === 'vertical' && horizontal) continue

    const denom = Math.max(Math.abs(item.parsedValue), Math.abs(segment.geometricLength || 0), 0.001)
    const relErr = Math.abs((segment.geometricLength || 0) - item.parsedValue) / denom
    const side = classifySegmentSide(segment, bbox)
    const sidePenalty = preferredSide && side && preferredSide !== side ? 0.45 : 1
    const labelBoost = segment.lengthLabel && segment.lengthLabel.value != null &&
      Math.abs(segment.lengthLabel.value - item.parsedValue) / Math.max(Math.abs(item.parsedValue), 1) < 0.05
      ? 1.15
      : 1
    const score = Math.max(0, (1 - relErr / 0.22) * sidePenalty * labelBoost)

    if (!best || score > best.score) {
      best = { segment, score }
    }
  }

  return best
}

function computePlanBoundingBox(segments) {
  const pts = (segments || []).flatMap(segment => [segment.start, segment.end]).filter(Boolean)
  if (pts.length === 0) return null
  const xs = pts.map(pt => pt.x)
  const ys = pts.map(pt => pt.y)
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
}

function inferPreferredSideFromOcr(item) {
  if (!item?.bbox) return null
  const cx = item.bbox.x + item.bbox.w / 2
  const cy = item.bbox.y + item.bbox.h / 2
  if (item.measureDir === 'vertical') {
    if (cx <= 0.4) return 'left'
    if (cx >= 0.6) return 'right'
  }
  if (item.measureDir === 'horizontal') {
    if (cy <= 0.4) return 'top'
    if (cy >= 0.6) return 'bottom'
  }
  return null
}

function classifySegmentSide(segment, bbox) {
  if (!segment?.start || !segment?.end || !bbox) return null
  const midX = (segment.start.x + segment.end.x) / 2
  const midY = (segment.start.y + segment.end.y) / 2
  const spanX = Math.max(0.001, bbox.maxX - bbox.minX)
  const spanY = Math.max(0.001, bbox.maxY - bbox.minY)
  const horizontal = Math.abs(segment.end.x - segment.start.x) >= Math.abs(segment.end.y - segment.start.y)
  const tolX = Math.max(0.25, spanX * 0.15)
  const tolY = Math.max(0.25, spanY * 0.15)

  if (horizontal) {
    if (Math.abs(midY - bbox.minY) <= tolY) return 'top'
    if (Math.abs(midY - bbox.maxY) <= tolY) return 'bottom'
    return null
  }

  if (Math.abs(midX - bbox.minX) <= tolX) return 'left'
  if (Math.abs(midX - bbox.maxX) <= tolX) return 'right'
  return null
}

function mergePoints(a, b) {
  const merged = [...(a || [])]
  for (const pt of (b || [])) {
    const dup = merged.some(p =>
      p.position && pt.position &&
      Math.hypot(p.position.x - pt.position.x, p.position.y - pt.position.y) < 0.05
    )
    if (!dup) merged.push(pt)
  }
  return merged
}

/**
 * Build a single axis-aligned bounding-box candidate from a set of line segments.
 * Used as a last-resort fallback when all polygon-closure methods fail (e.g. on
 * notebook paper where gaps prevent a closed graph from forming).
 *
 * The resulting rectangle spans the full extent of the provided structural lines.
 * It will be over-estimated if annotation/dimension lines are mixed in, but it
 * gives the scorer and the user a starting point to work from.
 */
function buildBoundingBoxFromLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) return []

  const xs = lines.flatMap(l => [l.p1?.x, l.p2?.x]).filter(v => typeof v === 'number' && isFinite(v))
  const ys = lines.flatMap(l => [l.p1?.y, l.p2?.y]).filter(v => typeof v === 'number' && isFinite(v))
  if (xs.length < 4 || ys.length < 4) return []

  const left   = Math.min(...xs)
  const right  = Math.max(...xs)
  const top    = Math.min(...ys)
  const bottom = Math.max(...ys)

  const width  = right - left
  const height = bottom - top
  const area   = width * height

  // Reject degenerate boxes and near-full-image boxes (notebook lines across whole page).
  // 0.80 is the threshold: a deck should not span more than 80% of the image area.
  if (area < 0.003 || area > 0.80) return []

  return [{
    id: 'bbox-fallback',
    vertices: [
      { x: +left.toFixed(4),  y: +top.toFixed(4) },
      { x: +right.toFixed(4), y: +top.toFixed(4) },
      { x: +right.toFixed(4), y: +bottom.toFixed(4) },
      { x: +left.toFixed(4),  y: +bottom.toFixed(4) },
    ],
    area: +area.toFixed(4),
    edgeCount: 4,
    score: 0.1,
    scoreDetails: { isBBoxFallback: true },
  }]
}

function buildContourCandidates(contours) {
  return (contours || [])
    .map((contour, index) => {
      const vertices = orthogonalizeContour(contour)
      const area = polygonArea(vertices)
      if (vertices.length < 4 || area < 0.003) return null
      return {
        id: `contour-${index}`,
        vertices,
        area,
        edgeCount: vertices.length,
        score: 0,
        scoreDetails: {},
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.area - a.area)
}

function orthogonalizeContour(points) {
  if (!Array.isArray(points) || points.length < 4) return []

  const cleaned = []
  for (const pt of points) {
    if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number') continue
    const prev = cleaned[cleaned.length - 1]
    if (prev && Math.hypot(prev.x - pt.x, prev.y - pt.y) < 0.008) continue
    cleaned.push({ x: +pt.x.toFixed(4), y: +pt.y.toFixed(4) })
  }

  if (cleaned.length < 4) return cleaned

  const rectified = [{ ...cleaned[0] }]
  for (let i = 1; i < cleaned.length; i++) {
    const prev = rectified[rectified.length - 1]
    const curr = cleaned[i]
    const dx = curr.x - prev.x
    const dy = curr.y - prev.y
    if (Math.abs(dx) >= Math.abs(dy)) {
      rectified.push({ x: +curr.x.toFixed(4), y: prev.y })
    } else {
      rectified.push({ x: prev.x, y: +curr.y.toFixed(4) })
    }
  }

  const deduped = []
  for (const pt of rectified) {
    const prev = deduped[deduped.length - 1]
    if (prev && Math.hypot(prev.x - pt.x, prev.y - pt.y) < 0.008) continue
    deduped.push(pt)
  }

  if (deduped.length >= 2) {
    const first = deduped[0]
    const last = deduped[deduped.length - 1]
    if (Math.hypot(first.x - last.x, first.y - last.y) < 0.01) {
      deduped.pop()
    }
  }

  const snapped = snapAxisLevels(deduped, 0.01)
  const simplified = simplifyOrthogonalPolygon(snapped, 0.008)
  return simplifyOrthogonalPolygon(simplified, 0.012)
}

function polygonArea(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 3) return 0
  let area = 0
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]
    const b = vertices[(i + 1) % vertices.length]
    area += a.x * b.y - b.x * a.y
  }
  return Math.abs(area) / 2
}


function snapAxisLevels(points, tolerance) {
  if (!Array.isArray(points) || points.length < 4) return points || []

  const snapValues = values => {
    const sorted = [...values].sort((a, b) => a - b)
    const clusters = []
    for (const value of sorted) {
      const last = clusters[clusters.length - 1]
      if (last && Math.abs(last.center - value) <= tolerance) {
        last.values.push(value)
        last.center = last.values.reduce((sum, v) => sum + v, 0) / last.values.length
      } else {
        clusters.push({ center: value, values: [value] })
      }
    }
    return values.map(value => {
      const match = clusters.find(cluster => Math.abs(cluster.center - value) <= tolerance)
      return match ? +match.center.toFixed(4) : +value.toFixed(4)
    })
  }

  const snappedXs = snapValues(points.map(p => p.x))
  const snappedYs = snapValues(points.map(p => p.y))
  return points.map((p, i) => ({ x: snappedXs[i], y: snappedYs[i] }))
}

function simplifyOrthogonalPolygon(points, minSegmentLen) {
  if (!Array.isArray(points) || points.length < 4) return points || []

  let current = [...points]
  let changed = true

  while (changed && current.length >= 4) {
    changed = false
    const next = []

    for (let i = 0; i < current.length; i++) {
      const prev = current[(i - 1 + current.length) % current.length]
      const curr = current[i]
      const nextPt = current[(i + 1) % current.length]

      const lenPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y)
      const lenNext = Math.hypot(nextPt.x - curr.x, nextPt.y - curr.y)

      // Drop tiny detours that create staircase artefacts along a mostly
      // straight boundary after contour tracing on notebook paper.
      if (
        lenPrev < minSegmentLen &&
        lenNext < minSegmentLen &&
        (prev.x === curr.x || prev.y === curr.y) &&
        (curr.x === nextPt.x || curr.y === nextPt.y)
      ) {
        changed = true
        continue
      }

      next.push(curr)
    }

    current = removeCollinearAxisPoints(next)
  }

  return removeCollinearAxisPoints(current)
}

function removeCollinearAxisPoints(points) {
  if (!Array.isArray(points) || points.length < 4) return points || []

  const result = []
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length]
    const curr = points[i]
    const next = points[(i + 1) % points.length]

    const sameX = prev.x === curr.x && curr.x === next.x
    const sameY = prev.y === curr.y && curr.y === next.y
    if (sameX || sameY) continue
    result.push(curr)
  }

  return result.length >= 4 ? result : points
}

function rebuildSegmentsForBoundary(existingSegments, boundary) {
  return boundary.map((start, i) => {
    const end = boundary[(i + 1) % boundary.length]
    const existing = Array.isArray(existingSegments) ? existingSegments[i] : null
    return {
      ...(existing || {}),
      id: existing?.id || `s${i + 1}`,
      start,
      end,
      geometricLength: +Math.hypot(end.x - start.x, end.y - start.y).toFixed(4),
      inferred: existing?.inferred ?? true,
      confidence: existing?.confidence ?? 0.75,
    }
  })
}

function orthogonalizeDeckPlan(deckPlan, warnings, source = 'geometry') {
  if (!deckPlan || !Array.isArray(deckPlan.outerBoundary) || deckPlan.outerBoundary.length < 4) {
    return deckPlan
  }

  const cleanedOuter = orthogonalizeMostlyAxisAlignedPoints(deckPlan.outerBoundary, warnings, source)
  if (cleanedOuter === deckPlan.outerBoundary) return deckPlan

  const cleanedSegments = cleanedOuter.map((start, i) => {
    const end = cleanedOuter[(i + 1) % cleanedOuter.length]
    const previous = Array.isArray(deckPlan.segments) ? deckPlan.segments[i] : null
    return {
      ...(previous || {}),
      id: previous?.id || `s${i + 1}`,
      start,
      end,
      geometricLength: +Math.hypot(end.x - start.x, end.y - start.y).toFixed(4),
    }
  })

  return {
    ...deckPlan,
    outerBoundary: cleanedOuter,
    segments: cleanedSegments,
  }
}

function orthogonalizeMostlyAxisAlignedPoints(points, warnings, source = 'geometry') {
  if (!Array.isArray(points) || points.length < 4) return points || []

  let changed = false
  let rejectedDiagonalCount = 0
  const result = [{ x: roundCoord(points[0].x), y: roundCoord(points[0].y) }]

  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1]
    const curr = points[i]
    const dx = curr.x - prev.x
    const dy = curr.y - prev.y
    const adx = Math.abs(dx)
    const ady = Math.abs(dy)

    if (adx > 0.001 && ady > 0.001) {
      const minor = Math.min(adx, ady)
      const major = Math.max(adx, ady)

      if (minor / major <= 0.35) {
        changed = true
        if (adx >= ady) {
          result.push({ x: roundCoord(curr.x), y: prev.y })
        } else {
          result.push({ x: prev.x, y: roundCoord(curr.y) })
        }
        continue
      }

      rejectedDiagonalCount++
    }

    result.push({ x: roundCoord(curr.x), y: roundCoord(curr.y) })
  }

  const first = result[0]
  const last = result[result.length - 1]
  const closeDx = Math.abs(last.x - first.x)
  const closeDy = Math.abs(last.y - first.y)
  if (closeDx > 0.001 && closeDy > 0.001) {
    const minor = Math.min(closeDx, closeDy)
    const major = Math.max(closeDx, closeDy)
    if (minor / major <= 0.35) {
      changed = true
      if (closeDx <= closeDy) {
        result[result.length - 1] = { x: first.x, y: last.y }
      } else {
        result[result.length - 1] = { x: last.x, y: first.y }
      }
    } else {
      rejectedDiagonalCount++
    }
  }

  if (rejectedDiagonalCount > 0) {
    warnings.push(
      `${source}: detected ${rejectedDiagonalCount} strongly diagonal edge(s). ` +
      'This sketch cannot be represented reliably as an orthogonal deck without manual correction.'
    )
  }

  if (!changed) return points

  const deduped = removeConsecutiveDuplicatePoints(result)
  const cleaned = removeCollinearAxisPoints(deduped)
  if (cleaned.length < 4) return points

  warnings.push(`${source}: snapped slight skew from photographed/hand-drawn lines to orthogonal edges.`)
  return cleaned
}

function removeConsecutiveDuplicatePoints(points) {
  const result = []
  for (const point of points || []) {
    const previous = result[result.length - 1]
    if (previous && Math.abs(previous.x - point.x) < 0.001 && Math.abs(previous.y - point.y) < 0.001) {
      continue
    }
    result.push(point)
  }
  if (result.length > 1) {
    const first = result[0]
    const last = result[result.length - 1]
    if (Math.abs(first.x - last.x) < 0.001 && Math.abs(first.y - last.y) < 0.001) {
      result.pop()
    }
  }
  return result
}

function roundCoord(value) {
  return +Number(value || 0).toFixed(4)
}

/**
 * Remove segment labels whose implied scale (label_ft / geom_length) deviates
 * wildly from the majority of labeled segments.
 * Prevents interior annotations (e.g. "3'") from being assigned to long boundary edges.
 *
 * With ≥ 3 labeled segments: median-based (outlier = < median/5)
 * With exactly 2 labeled segments: ratio-based (outlier = < other/10)
 * With < 2: no data to judge, keep everything
 */
function filterScaleOutliers(segments, warnings) {
  const labeled = segments.filter(s =>
    s.lengthLabel && s.lengthLabel.value != null &&
    (s.lengthLabel.unit === 'feet' || s.lengthLabel.unit === 'ft') &&
    s.geometricLength > 0.01
  )

  if (labeled.length < 2) return segments

  const scaleOf = s => s.lengthLabel.value / s.geometricLength

  // Special case: exactly 2 labeled segments — use ratio test
  if (labeled.length === 2) {
    const [lo, hi] = labeled.map(scaleOf).sort((a, b) => a - b)
    if (hi / lo > 10) {
      // lo is the outlier
      return segments.map(s => {
        if (!s.lengthLabel || s.lengthLabel.value == null || !s.geometricLength) return s
        if (s.lengthLabel.unit !== 'feet' && s.lengthLabel.unit !== 'ft') return s
        if (Math.abs(scaleOf(s) - lo) < 0.001) {
          warnings.push(`Label "${s.lengthLabel.rawText}" on ${s.id} removed — scale outlier (2-segment ratio test)`)
          const { lengthLabel, ...rest } = s
          return rest
        }
        return s
      })
    }
    return segments
  }

  // General case: ≥ 3 labeled segments — median-based
  const scales = labeled.map(scaleOf).sort((a, b) => a - b)
  const median = scales[Math.floor(scales.length / 2)]

  return segments.map(s => {
    if (!s.lengthLabel || s.lengthLabel.value == null || !s.geometricLength) return s
    if (s.lengthLabel.unit !== 'feet' && s.lengthLabel.unit !== 'ft') return s
    const scale = scaleOf(s)
    if (scale < median / 5) {
      warnings.push(
        `Label "${s.lengthLabel.rawText}" on ${s.id} removed — implied scale ${scale.toFixed(1)} ft/unit is <1/5 of median ${median.toFixed(1)}`
      )
      const { lengthLabel, ...rest } = s
      return rest
    }
    return s
  })
}

/**
 * Scale a normalized deck plan from [0,1] image coordinates to real-world feet
 * in-place, using per-axis scale factors derived from labeled segments.
 *
 * x_scale = labeled_ft / geom_length  averaged over horizontal labeled segs
 * y_scale = same for vertical labeled segs
 *
 * Mutates deckPlan directly so callers don't need to reassign.
 */
function applyRealWorldScale(deckPlan, warnings) {
  const segs = deckPlan.segments || []
  const labeled = segs.filter(s =>
    s.lengthLabel && s.lengthLabel.value != null && s.geometricLength > 0.01 &&
    (s.lengthLabel.unit === 'feet' || s.lengthLabel.unit === 'ft')
  )

  if (labeled.length === 0) {
    // No OCR-derived scale — apply a default scale so the canvas shows a visible shape.
    // Assume the deck spans roughly 40 ft across its longest axis; the user can then
    // correct the dimensions manually in the UI.
    const bb = deckPlan.boundingBox
    const bboxSpan = bb ? Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) : 0
    if (bboxSpan > 0.05) {
      const defaultFt = 40
      const scale = defaultFt / bboxSpan
      const sp = (p) => ({ x: +(p.x * scale).toFixed(3), y: +(p.y * scale).toFixed(3) })
      deckPlan.outerBoundary = (deckPlan.outerBoundary || []).map(sp)
      deckPlan.cutouts       = (deckPlan.cutouts || []).map(c => c.map(sp))
      deckPlan.segments      = segs.map(s => {
        const start = sp(s.start)
        const end   = sp(s.end)
        return { ...s, start, end, geometricLength: +(Math.hypot(end.x - start.x, end.y - start.y)).toFixed(3) }
      })
      deckPlan.depthPoints = (deckPlan.depthPoints || []).map(dp => ({
        ...dp,
        position: dp.position ? sp(dp.position) : dp.position,
      }))
      if (bb) {
        deckPlan.boundingBox = {
          minX: +(bb.minX * scale).toFixed(3), minY: +(bb.minY * scale).toFixed(3),
          maxX: +(bb.maxX * scale).toFixed(3), maxY: +(bb.maxY * scale).toFixed(3),
        }
      }
      warnings.push(`Scale: no labeled segments found — applied default ${defaultFt} ft scale. Edit dimensions manually.`)
    } else {
      warnings.push('Scale: no labeled segments found — canvas coordinates may appear tiny')
    }
    return
  }

  const hSegs = labeled.filter(s => Math.abs(s.end.x - s.start.x) > Math.abs(s.end.y - s.start.y))
  const vSegs = labeled.filter(s => Math.abs(s.end.y - s.start.y) > Math.abs(s.end.x - s.start.x))

  // Use the single most-reliable (longest geometric extent) segment per axis
  // rather than averaging, because contradictory labels on the same axis
  // (e.g. "31'6"" top vs "25'6"" bottom both with normalized length 0.954)
  // would average to a wrong scale.
  const bestScale = (arr) => {
    if (arr.length === 0) return null
    const best = arr.reduce((a, b) => b.geometricLength > a.geometricLength ? b : a)
    return best.lengthLabel.value / best.geometricLength
  }

  const xScale = bestScale(hSegs)
  const yScale = bestScale(vSegs)
  const sX = xScale || yScale
  const sY = yScale || xScale

  if (!sX || !sY) {
    warnings.push('Scale: insufficient labeled segments for per-axis scaling')
    return
  }

  warnings.push(`Scale: x=${sX.toFixed(2)} ft/unit  y=${sY.toFixed(2)} ft/unit  (from ${labeled.length} labeled segments)`)

  const sp = (p) => ({ x: +(p.x * sX).toFixed(3), y: +(p.y * sY).toFixed(3) })

  deckPlan.outerBoundary = (deckPlan.outerBoundary || []).map(sp)
  deckPlan.cutouts       = (deckPlan.cutouts || []).map(c => c.map(sp))
  deckPlan.segments      = segs.map(s => {
    const start = sp(s.start)
    const end   = sp(s.end)
    return {
      ...s,
      start,
      end,
      geometricLength: +(Math.hypot(end.x - start.x, end.y - start.y)).toFixed(3),
    }
  })
  deckPlan.depthPoints = (deckPlan.depthPoints || []).map(dp => ({
    ...dp,
    position: dp.position ? sp(dp.position) : dp.position,
  }))
  if (deckPlan.boundingBox) {
    const bb = deckPlan.boundingBox
    deckPlan.boundingBox = {
      minX: +(bb.minX * sX).toFixed(3),
      minY: +(bb.minY * sY).toFixed(3),
      maxX: +(bb.maxX * sX).toFixed(3),
      maxY: +(bb.maxY * sY).toFixed(3),
    }
  }
}

function mergeNotes(a, b) {
  const merged = [...(a || [])]
  for (const n of (b || [])) {
    if (!merged.some(m => m.text === n.text)) merged.push(n)
  }
  return merged
}

/**
 * Associate OCR dimension labels to Codex CLI vision segments by numeric value matching.
 *
 * The spatial association in associateLabels() uses image [0,1] coordinates, but
 * vision-produced segments live in real-world units (meters or feet). We instead
 * match each OCR parsedValue to the closest segment geometricLength within a
 * relative tolerance, using direction alignment as a tiebreaker.
 *
 * Algorithm:
 *   1. Build (segment, ocrItem, score) triples for all pairs within tolerance.
 *   2. Sort by score ascending (low = good match).
 *   3. Greedy assignment: accept best unambiguous match for each segment.
 *
 * @param {Array} ocrItems   - OCR results with parsedValue, parsedUnit, measureDir
 * @param {Array} segments   - Vision plan segments with geometricLength in plan units
 * @param {string} planUnit  - 'm' | 'ft' | 'in'
 * @returns {Array} segments with lengthLabel populated where a match was found
 */
function associateVisionLabels(ocrItems, segments, planUnit) {
  const dimItems = (ocrItems || []).filter(item =>
    item.parsedValue != null &&
    item.parsedValue > 0 &&
    (item.type === 'dimension' || item.type === 'unknown' || !item.type) &&
    isUnitCompatible(item.parsedUnit, planUnit)
  )

  if (dimItems.length === 0) return segments

  const enriched = segments.map(seg => ({ ...seg }))
  const usedItemIndices = new Set()

  // Build all (segment-index, item-index, score) candidates
  const candidates = []
  for (let si = 0; si < enriched.length; si++) {
    const seg = enriched[si]
    const gl = seg.geometricLength
    if (!gl || gl <= 0) continue

    const isH = Math.abs(seg.end.x - seg.start.x) > Math.abs(seg.end.y - seg.start.y)

    for (let ii = 0; ii < dimItems.length; ii++) {
      const item = dimItems[ii]
      const relErr = Math.abs(item.parsedValue - gl) / gl
      if (relErr > 0.12) continue  // > 12% off — not a plausible match

      let score = relErr  // lower = better
      if ((isH && item.measureDir === 'horizontal') || (!isH && item.measureDir === 'vertical')) {
        score *= 0.4  // Direction agrees — strong bonus
      } else if ((isH && item.measureDir === 'vertical') || (!isH && item.measureDir === 'horizontal')) {
        score *= 2.5  // Direction contradicts — penalty
      }

      candidates.push({ si, ii, score })
    }
  }

  // Greedy: take the best match first, then next-best from remaining unmatched pairs
  candidates.sort((a, b) => a.score - b.score)
  for (const { si, ii, score } of candidates) {
    if (usedItemIndices.has(ii)) continue
    const seg = enriched[si]
    if (seg.lengthLabel) continue  // Already assigned by a better match

    const item = dimItems[ii]
    const matchConf = Math.max(0.4, (item.confidence || 0.5) * (1 - score))
    seg.lengthLabel = {
      rawText:    item.text,
      value:      item.parsedValue,
      unit:       item.parsedUnit || planUnit,
      confidence: +matchConf.toFixed(3),
    }
    seg.confidence = Math.max(seg.confidence || 0, matchConf * 0.9)
    usedItemIndices.add(ii)
  }

  return enriched
}

/**
 * Return true if the OCR item's unit is compatible with the plan's unit.
 * Null/unknown units are treated as compatible (benefit of the doubt).
 */
function isUnitCompatible(itemUnit, planUnit) {
  if (!itemUnit || !planUnit) return true
  const norm = u => {
    u = String(u).toLowerCase()
    if (u === 'feet' || u === 'foot') return 'ft'
    if (u === 'meters' || u === 'meter' || u === 'metres' || u === 'metre') return 'm'
    return u
  }
  return norm(itemUnit) === norm(planUnit)
}

module.exports = router
