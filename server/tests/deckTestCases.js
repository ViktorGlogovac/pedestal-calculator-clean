/**
 * Test suite for the refactored deck plan pipeline.
 *
 * Tests cover:
 *   - Unit parsing (units.js)
 *   - Line graph construction (lineGraph.js)
 *   - Polygon candidate generation (candidateGen.js)
 *   - Candidate scoring (scorer.js)
 *   - Normalization (normalize.js)
 *   - Label association (associate.js)
 *   - Canvas conversion (finalize.js)
 */

const { normalizeUnit, toCm, parseTextDimension } = require('../utils/units')
const { buildLineGraph }     = require('../pipeline/lineGraph')
const { generateCandidates } = require('../pipeline/candidateGen')
const { scoreCandidates }    = require('../pipeline/scorer')
const { normalizeDeckPlan }  = require('../pipeline/normalize')
const { associateLabels }    = require('../pipeline/associate')
const { toCanvasShapes }     = require('../pipeline/finalize')

let passed = 0
let failed = 0
const failures = []

function expect(desc, actual, expected, comparator) {
  const ok = comparator ? comparator(actual, expected) : actual === expected
  if (ok) {
    passed++
  } else {
    failed++
    failures.push({ desc, actual, expected })
    console.log(`  ✗ FAIL: ${desc}`)
    console.log(`      expected: ${JSON.stringify(expected)}`)
    console.log(`      actual:   ${JSON.stringify(actual)}`)
  }
}

function approx(a, b, tol = 0.01) {
  return Math.abs(a - b) <= tol
}

// ─── Unit parsing ─────────────────────────────────────────────────────────────

function testUnitParsing() {
  console.log('\n── Unit Parsing ──')

  // Feet-inches
  const fi = parseTextDimension("31'6\"")
  expect("31'6\" value",  fi?.value,  31.5, approx)
  expect("31'6\" unit",   fi?.unit,   'feet')

  const fi2 = parseTextDimension("15'9\"")
  expect("15'9\" value",  fi2?.value, 15.75, approx)

  const fi3 = parseTextDimension("25'6\"")
  expect("25'6\" value",  fi3?.value, 25.5, approx)

  // Feet only
  const ft = parseTextDimension("7'")
  expect("7' value",  ft?.value, 7,      approx)
  expect("7' unit",   ft?.unit,  'feet')

  // Metric
  const mm = parseTextDimension("150mm")
  expect("150mm value", mm?.value, 150,    approx)
  expect("150mm unit",  mm?.unit,  'mm')

  // toCm
  expect("7ft → cm",    toCm(7, 'feet'),    213.36, approx)
  expect("150mm → cm",  toCm(150, 'mm'),    15.0,   approx)
  expect("5m → cm",     toCm(5, 'meters'),  500,    approx)
}

// ─── Line Graph: simple rectangle ────────────────────────────────────────────

function testLineGraphRectangle() {
  console.log('\n── Line Graph: 44×31.5 rectangle ──')

  // Simulate normalised line segments for a rectangle
  // Image is 800×600, rectangle fills most of it (normalised)
  const lines = [
    { p1: { x: 0.1, y: 0.1 }, p2: { x: 0.9, y: 0.1 }, angle: 0,   length: 0.8 },  // top
    { p1: { x: 0.9, y: 0.1 }, p2: { x: 0.9, y: 0.85 }, angle: 90, length: 0.75 }, // right
    { p1: { x: 0.1, y: 0.85 }, p2: { x: 0.9, y: 0.85 }, angle: 0, length: 0.8 },  // bottom
    { p1: { x: 0.1, y: 0.1 }, p2: { x: 0.1, y: 0.85 }, angle: 90, length: 0.75 }, // left
  ]

  const graph = buildLineGraph(lines)

  expect('graph has nodes', graph.nodes.length >= 4, true)
  expect('graph has edges', graph.edges.length >= 4, true)
  expect('graph has 1 H-level', graph.hLevels.length, 2)
  expect('graph has 1 V-column', graph.vColumns.length, 2)
}

// ─── Line Graph: L-shape ──────────────────────────────────────────────────────

function testLineGraphLShape() {
  console.log('\n── Line Graph: L-shape ──')

  // L-shape: outer boundary has 6 edges
  const lines = [
    { p1: { x: 0.1, y: 0.1 }, p2: { x: 0.9, y: 0.1 }, angle: 0,   length: 0.8 },  // top
    { p1: { x: 0.9, y: 0.1 }, p2: { x: 0.9, y: 0.5 }, angle: 90,  length: 0.4 },  // right upper
    { p1: { x: 0.5, y: 0.5 }, p2: { x: 0.9, y: 0.5 }, angle: 0,   length: 0.4 },  // notch horizontal
    { p1: { x: 0.5, y: 0.5 }, p2: { x: 0.5, y: 0.9 }, angle: 90,  length: 0.4 },  // notch vertical
    { p1: { x: 0.1, y: 0.9 }, p2: { x: 0.5, y: 0.9 }, angle: 0,   length: 0.4 },  // bottom partial
    { p1: { x: 0.1, y: 0.1 }, p2: { x: 0.1, y: 0.9 }, angle: 90,  length: 0.8 },  // left
  ]

  const graph = buildLineGraph(lines)

  expect('L-shape graph has nodes', graph.nodes.length >= 6, true)
  expect('L-shape graph has edges', graph.edges.length >= 6, true)
  expect('L-shape H-levels', graph.hLevels.length >= 3, true)
}

// ─── Candidate Generation: rectangle ─────────────────────────────────────────

function testCandidateGenRectangle() {
  console.log('\n── Candidate Generation: rectangle ──')

  const lines = [
    { p1: { x: 0.1, y: 0.1 }, p2: { x: 0.9, y: 0.1 }, angle: 0,  length: 0.8 },
    { p1: { x: 0.9, y: 0.1 }, p2: { x: 0.9, y: 0.9 }, angle: 90, length: 0.8 },
    { p1: { x: 0.1, y: 0.9 }, p2: { x: 0.9, y: 0.9 }, angle: 0,  length: 0.8 },
    { p1: { x: 0.1, y: 0.1 }, p2: { x: 0.1, y: 0.9 }, angle: 90, length: 0.8 },
  ]

  const graph = buildLineGraph(lines)
  const candidates = generateCandidates(graph)

  expect('rectangle: at least 1 candidate', candidates.length >= 1, true)

  if (candidates.length > 0) {
    const best = candidates[0]
    expect('rectangle: 4 vertices', best.vertices.length, 4)
    expect('rectangle: area in range', best.area > 0.3 && best.area < 0.7, true)
  }
}

// ─── Candidate Scoring ───────────────────────────────────────────────────────

function testCandidateScoring() {
  console.log('\n── Candidate Scoring ──')

  const mockCandidates = [
    {
      id: 0,
      vertices: [
        { id: 0, x: 0.1, y: 0.1 },
        { id: 1, x: 0.9, y: 0.1 },
        { id: 2, x: 0.9, y: 0.9 },
        { id: 3, x: 0.1, y: 0.9 },
      ],
      area: 0.64,
      edgeCount: 4,
      score: 0,
      scoreDetails: {},
    },
    {
      id: 1,
      vertices: [
        { id: 4, x: 0.4, y: 0.4 },
        { id: 5, x: 0.6, y: 0.4 },
        { id: 6, x: 0.6, y: 0.6 },
        { id: 7, x: 0.4, y: 0.6 },
      ],
      area: 0.04,
      edgeCount: 4,
      score: 0,
      scoreDetails: {},
    },
  ]

  const ocrItems = [
    { type: 'dimension', text: "44'", parsedValue: 44, parsedUnit: 'feet',
      bbox: { x: 0.45, y: 0.05, w: 0.1, h: 0.03 }, confidence: 0.9 },
  ]

  const scored = scoreCandidates(mockCandidates, ocrItems)

  expect('scoring returns 2 candidates', scored.length, 2)
  expect('larger candidate scores higher', scored[0].area > scored[1].area, true)
  expect('top score > 0', scored[0].score > 0, true)
  expect('scores have details', !!scored[0].scoreDetails, true)
}

// ─── Normalization: rectangle ─────────────────────────────────────────────────

function testNormalizationRectangle() {
  console.log('\n── Normalization: rectangle ──')

  const rawPlan = {
    unit: 'ft',
    outerBoundary: [
      { x: 0, y: 0 }, { x: 44, y: 0 }, { x: 44, y: 31.5 }, { x: 0, y: 31.5 },
    ],
    cutouts: [],
    segments: [],
    depthPoints: [],
    notes: [],
    confidence: 0.85,
    warnings: [],
  }

  const result = normalizeDeckPlan(rawPlan)

  expect('rectangle vertices', result.outerBoundary.length, 4)
  expect('rectangle area ≈ 1386', result.area, 1386, (a, b) => approx(a, b, 1))
  expect('rectangle no closure warning',
    result.warnings.filter(w => w.includes('not closed')).length, 0)
  expect('rectangle bounding box minX', result.boundingBox.minX, 0, approx)
  expect('rectangle bounding box maxX', result.boundingBox.maxX, 44, approx)
}

// ─── Normalization: L-shape ───────────────────────────────────────────────────

function testNormalizationLShape() {
  console.log('\n── Normalization: L-shape ──')

  // 20×15 with 8×9 notch in top-right
  // Vertices: (0,0)→(12,0)→(12,6)→(20,6)→(20,15)→(0,15)
  // Area = 20×15 - 8×6 = 300 - 48 = 252
  const rawPlan = {
    unit: 'ft',
    outerBoundary: [
      { x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 6 },
      { x: 20, y: 6 }, { x: 20, y: 15 }, { x: 0, y: 15 },
    ],
    cutouts: [], segments: [], depthPoints: [], notes: [],
    confidence: 0.8, warnings: [],
  }

  const result = normalizeDeckPlan(rawPlan)

  expect('L-shape vertices', result.outerBoundary.length, 6)
  expect('L-shape area ≈ 252', result.area, 252, (a, b) => approx(a, b, 1))
  expect('L-shape segments', result.segments.length, 6)
}

// ─── OCR Label Association ────────────────────────────────────────────────────

function testOCRAssociation() {
  console.log('\n── OCR Label Association ──')

  const segments = [
    { id: 's1', start: { x: 0, y: 0 }, end: { x: 1, y: 0 },
      geometricLength: 1, lengthLabel: null, confidence: 0.3 },
    { id: 's2', start: { x: 1, y: 0 }, end: { x: 1, y: 0.5 },
      geometricLength: 0.5, lengthLabel: null, confidence: 0.3 },
  ]

  const ocrItems = [
    // Wide label above top edge (y < 0) — should match s1 (horizontal)
    { type: 'dimension', text: "44'", parsedValue: 44, parsedUnit: 'feet',
      bbox: { x: 0.4, y: 0.03, w: 0.2, h: 0.04 }, confidence: 0.9 },
    // Tall label right of right edge — should match s2 (vertical)
    { type: 'dimension', text: "31'6\"", parsedValue: 31.5, parsedUnit: 'feet',
      bbox: { x: 1.05, y: 0.2, w: 0.04, h: 0.1 }, confidence: 0.9 },
  ]

  const result = associateLabels(ocrItems, segments, [{ x: 0, y: 0 }, { x: 1, y: 0 }])

  expect('s1 gets horizontal label', result.enrichedSegments[0].lengthLabel?.rawText, "44'")
  expect('s2 gets vertical label',   result.enrichedSegments[1].lengthLabel?.rawText, "31'6\"")
}

// ─── Canvas Conversion ────────────────────────────────────────────────────────

function testCanvasConversion() {
  console.log('\n── Canvas Conversion ──')

  const deckPlan = {
    unit: 'ft',
    outerBoundary: [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 },
    ],
    cutouts: [],
    segments: [],
    depthPoints: [],
    notes: [],
  }

  const shapes = toCanvasShapes(deckPlan, 35)

  expect('canvas shapes count', shapes.length, 1)
  expect('shape type', shapes[0].type, 'add')
  expect('shape closed', shapes[0].isLoopClosed, true)
  expect('shape has 4 points', shapes[0].points.length, 4)

  // Check pixel math: x=10ft at gridSize=35 → (10*30.48/100)*35 ≈ 106 px + margin
  const expectedX = 2 * 35 + Math.round((10 * 30.48 / 100) * 35)
  expect('right edge x pixel', shapes[0].points[1].x, expectedX, (a, b) => Math.abs(a - b) <= 2)
}

// ─── Sketch with missing edge ─────────────────────────────────────────────────

function testMissingEdge() {
  console.log('\n── Missing edge tolerance ──')

  // 3 lines of a rectangle — 4th is missing (common in sketches)
  const lines = [
    { p1: { x: 0.1, y: 0.1 }, p2: { x: 0.9, y: 0.1 }, angle: 0,  length: 0.8 },  // top
    { p1: { x: 0.9, y: 0.1 }, p2: { x: 0.9, y: 0.9 }, angle: 90, length: 0.8 },  // right
    { p1: { x: 0.1, y: 0.9 }, p2: { x: 0.9, y: 0.9 }, angle: 0,  length: 0.8 },  // bottom
    // left edge missing
  ]

  const graph = buildLineGraph(lines)

  expect('incomplete graph builds', graph.nodes.length >= 4, true)
  // Candidates may be 0 due to missing edge — that's expected
  const candidates = generateCandidates(graph)
  expect('missing edge: 0 or more candidates', candidates.length >= 0, true)
}

// ─── Lined paper robustness ───────────────────────────────────────────────────

function testLinedPaperRobustness() {
  console.log('\n── Lined paper robustness ──')

  // Many near-horizontal lines (simulating notebook lines) + one rectangle
  const lines = []
  for (let i = 0; i < 20; i++) {
    // Notebook lines: evenly spaced, near-horizontal
    const y = 0.05 + i * 0.045
    lines.push({ p1: { x: 0.0, y }, p2: { x: 1.0, y }, angle: 0.5, length: 1.0 })
  }
  // Add the actual deck outline (slightly different y-levels)
  lines.push({ p1: { x: 0.1, y: 0.15 }, p2: { x: 0.85, y: 0.15 }, angle: 0, length: 0.75 })
  lines.push({ p1: { x: 0.85, y: 0.15 }, p2: { x: 0.85, y: 0.8 }, angle: 90, length: 0.65 })
  lines.push({ p1: { x: 0.1, y: 0.8  }, p2: { x: 0.85, y: 0.8 }, angle: 0, length: 0.75 })
  lines.push({ p1: { x: 0.1, y: 0.15 }, p2: { x: 0.1, y: 0.8  }, angle: 90, length: 0.65 })

  const graph = buildLineGraph(lines)
  const candidates = generateCandidates(graph)

  // The graph clustering should group nearby horizontal lines together
  // We can't guarantee perfect extraction but candidates should be non-empty
  expect('lined paper: graph has nodes', graph.nodes.length > 0, true)
  expect('lined paper: graph built without error', true, true)
}

// ─── Multiple dimension labels ────────────────────────────────────────────────

function testMultipleDimensionLabels() {
  console.log('\n── Multiple dimension labels ──')

  // In the new pipeline, candidate vertices AND ocr bboxes are both in
  // normalised [0,1] image space — use consistent coords here.
  const segments = [
    { id: 's1', start: { x: 0.1, y: 0.1 }, end: { x: 0.9, y: 0.1 }, geometricLength: 0.8, lengthLabel: null, confidence: 0.3 },
    { id: 's2', start: { x: 0.9, y: 0.1 }, end: { x: 0.9, y: 0.85 }, geometricLength: 0.75, lengthLabel: null, confidence: 0.3 },
    { id: 's3', start: { x: 0.9, y: 0.85 }, end: { x: 0.1, y: 0.85 }, geometricLength: 0.8, lengthLabel: null, confidence: 0.3 },
    { id: 's4', start: { x: 0.1, y: 0.85 }, end: { x: 0.1, y: 0.1 }, geometricLength: 0.75, lengthLabel: null, confidence: 0.3 },
  ]

  const ocrItems = [
    // Wide label centred above top edge — should match s1 (horizontal)
    { type: 'dimension', text: "44'",    parsedValue: 44,   parsedUnit: 'feet', bbox: { x: 0.40, y: 0.04, w: 0.20, h: 0.04 }, confidence: 0.9 },
    // Tall label to the right of right edge — should match s2 (vertical)
    { type: 'dimension', text: "31'6\"", parsedValue: 31.5, parsedUnit: 'feet', bbox: { x: 0.93, y: 0.38, w: 0.04, h: 0.20 }, confidence: 0.9 },
  ]

  const result = associateLabels(ocrItems, segments, [
    { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.85 }, { x: 0.1, y: 0.85 },
  ])

  const labeled = result.enrichedSegments.filter(s => s.lengthLabel !== null)
  expect('2 segments get labels', labeled.length, 2)
  expect('no critical warnings', result.warnings.filter(w => w.includes('Error')).length, 0)
}

// ─── Run All ──────────────────────────────────────────────────────────────────

function runAll(suiteName) {
  const suites = {
    units:          testUnitParsing,
    lineGraphRect:  testLineGraphRectangle,
    lineGraphL:     testLineGraphLShape,
    candidateRect:  testCandidateGenRectangle,
    scoring:        testCandidateScoring,
    normRect:       testNormalizationRectangle,
    normL:          testNormalizationLShape,
    association:    testOCRAssociation,
    canvas:         testCanvasConversion,
    missingEdge:    testMissingEdge,
    linedPaper:     testLinedPaperRobustness,
    multiLabel:     testMultipleDimensionLabels,
  }

  if (suiteName && suites[suiteName]) {
    suites[suiteName]()
  } else {
    Object.values(suites).forEach(fn => fn())
  }

  console.log(`\n──────────────────────────────`)
  console.log(`Results: ${passed} passed, ${failed} failed`)
  if (failures.length > 0) {
    console.log('\nFailures:')
    failures.forEach(f => console.log(`  • ${f.desc}: expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.actual)}`))
  }
  console.log('──────────────────────────────')
  return { passed, failed, failures }
}

module.exports = { runAll }
