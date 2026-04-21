/**
 * Calls OpenAI GPT-4o vision API to analyze a deck design image.
 * Uses a two-call chain: first extract shape description + corners, then convert to JSON.
 */
export async function analyzeDeckImage(base64Image, mimeType = 'image/jpeg', userNotes = '') {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OpenAI API key not configured. Add VITE_OPENAI_API_KEY to your .env file.')
  }

  const imageContent = {
    type: 'image_url',
    image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: 'high' },
  }

  // ── CALL 1: Trace the perimeter as directed moves ──────────────────────────
  const step1System = `You are an expert architectural drawing reader specializing in floor plans.

Your job: read this deck/terrace floor plan and describe the outer perimeter as a WALK around the boundary.

INSTRUCTIONS:
1. Find the TOP-LEFT corner of the shape. That is your starting point.
2. Walk clockwise around the outer edge of the shape.
3. For each straight segment you traverse, write one line:
      <direction> <distance><unit>
   Direction is one of: RIGHT, LEFT, UP, DOWN.
   Distance is the number from the label nearest that edge segment.
   Unit is whatever the drawing uses (m, ft, etc.).

4. After listing all segments, verify the walk closes back to the start
   (rights minus lefts = 0, downs minus ups = 0).

5. List any INTERNAL measurements separately (these are inside the shape and
   do NOT belong in the perimeter walk).

6. List any heights, slopes, or elevation values you see.

IMPORTANT:
- Every labeled edge on the drawing perimeter must appear exactly once.
- Do NOT skip small notches, bumps, or steps — trace every corner.
- If you see a rectangular protrusion sticking out from the main body,
  walk INTO it (right → down → left, or similar).
- If you see a rectangular cutout, walk AROUND its inside edge.
${userNotes ? `\nUser notes: "${userNotes}"` : ''}`

  const step1Response = await callOpenAI(apiKey, [
    { role: 'system', content: step1System },
    {
      role: 'user',
      content: [
        imageContent,
        { type: 'text', text: 'Trace the perimeter of this deck clockwise from the top-left corner, one segment per line. Then list internal measurements and any height/slope values separately.' },
      ],
    },
  ])

  const description = step1Response

  // ── CALL 2: Convert segment walk → absolute coordinate JSON ──────────────
  const step2System = `You are a coordinate geometry expert.

You will receive a clockwise perimeter walk of a deck shape, written as:
  RIGHT Xm / LEFT Xm / DOWN Xm / UP Xm  (one segment per line)

Your job: convert that walk into absolute (x, y) polygon coordinates and output JSON.

COORDINATE SYSTEM:
  - Start at (0, 0) = top-left corner
  - RIGHT increases x, LEFT decreases x
  - DOWN increases y, UP decreases y
  - Convert feet/inches to decimal: 25'6" → 25.5

ALGORITHM — keep a running position (cx, cy) starting at (0,0):
  For each segment, record the STARTING position as a polygon point,
  then update (cx, cy) according to the direction and distance.
  The last segment brings you back to (0,0) — do NOT add (0,0) again at the end.

EXAMPLE:
  Walk: RIGHT 5m, DOWN 3m, RIGHT 2m, DOWN 4m, LEFT 7m, UP 7m
  Points:
    (0,0)  — before RIGHT 5
    (5,0)  — before DOWN 3
    (5,3)  — before RIGHT 2
    (7,3)  — before DOWN 4
    (7,7)  — before LEFT 7
    (0,7)  — before UP 7  → returns to (0,0) ✓

OUTPUT — respond ONLY with valid JSON, no markdown, no extra text:
{
  "unit": "meters" | "feet" | "inches",
  "dimensions_found": ["list every perimeter segment value, e.g. 'RIGHT 5m', 'DOWN 20m'"],
  "shapes": [
    {
      "name": "main deck",
      "type": "add",
      "points": [{ "x": number, "y": number, "height": number | null }]
    }
  ]
}

If there are multiple separate regions (e.g. a cutout inside the main shape),
add a second shape with type "sub".
Heights at corners: use any elevation/slope values from the description, else null.`

  const step2Response = await callOpenAI(apiKey, [
    { role: 'system', content: step2System },
    {
      role: 'user',
      content: `Convert this perimeter walk to polygon JSON:\n\n${description}`,
    },
  ])

  // Strip markdown fences if present
  const cleaned = step2Response
    .replace(/^```[a-z]*\n?/im, '')
    .replace(/\n?```$/m, '')
    .trim()

  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        parsed = JSON.parse(match[0])
      } catch {
        throw new Error(
          'Could not parse AI response. Try adding more detail in the guidance field and re-analyzing.',
        )
      }
    } else {
      throw new Error(
        'Could not parse AI response. Try adding more detail in the guidance field and re-analyzing.',
      )
    }
  }

  if (!parsed.shapes || !Array.isArray(parsed.shapes)) {
    throw new Error('AI response is missing the shapes array.')
  }

  // Attach the step1 description so the UI can show it
  parsed._description = description

  return parsed
}

async function callOpenAI(apiKey, messages) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 3000,
      messages,
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err?.error?.message || `OpenAI API error: ${response.status}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}

/**
 * Converts the GPT-4o shapes response into the canvas pixel format used by PedestalGrid.
 * Canvas system: gridSize pixels = 100 cm (1 metre), default gridSize = 35px
 */
export function convertAnalysisToShapes(analysisResult, gridSize = 35, marginCells = 2) {
  const { unit, shapes } = analysisResult

  const toCm = unit === 'meters' ? 100 : unit === 'feet' ? 30.48 : unit === 'inches' ? 2.54 : 100

  const allPointsCm = shapes.flatMap((s) =>
    s.points.map((p) => ({ x: p.x * toCm, y: p.y * toCm })),
  )

  const minX = Math.min(...allPointsCm.map((p) => p.x))
  const minY = Math.min(...allPointsCm.map((p) => p.y))

  const marginPx = marginCells * gridSize

  // Round to nearest pixel — NOT nearest grid cell (that was rounding 31.5ft → 32.81ft)
  const cmToPx = (cm) => Math.round((cm / 100) * gridSize)

  return shapes.map((shape, idx) => ({
    name: shape.name || `region${idx + 1}`,
    type: shape.type === 'sub' ? 'sub' : 'add',
    isLoopClosed: true,
    points: shape.points.map((pt) => ({
      x: marginPx + cmToPx(pt.x * toCm - minX),
      y: marginPx + cmToPx(pt.y * toCm - minY),
      ...(pt.height != null ? { height: pt.height * toCm } : {}),
    })),
  }))
}
