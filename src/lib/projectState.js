const PROJECT_STORAGE_KEYS = [
  'pedestal_points',
  'pedestal_gridSize',
  'pedestal_unitSystem',
  'pedestal_adjustedPedestals',
  'pedestalGrid_shapes',
  'pedestalGrid_heights',
  'pedestalGrid_activeShapeIndex',
  'pedestalGrid_gridSize',
  'tileLayout_selectedTileType',
  'tileLayout_isOffset',
  'tileLayout_orientation',
  'tileGrid_selectedTileType',
  'tileGrid_isOffset',
  'tileGrid_orientation',
  'tileGrid_adjustedPedestals',
  'pedestalHeightAdjuster_adjustedPedestals',
]

const safeRead = (key) => {
  try {
    const value = localStorage.getItem(key)
    return value === null ? undefined : value
  } catch (error) {
    return undefined
  }
}

const safeWrite = (key, value) => {
  try {
    if (value === undefined || value === null) {
      localStorage.removeItem(key)
      return
    }
    localStorage.setItem(key, value)
  } catch (error) {}
}

export const clearProjectDraft = () => {
  PROJECT_STORAGE_KEYS.forEach((key) => safeWrite(key, undefined))
}

export const buildProjectState = ({ points, gridSize, unitSystem, calcData, zoom, panOffset, step }) => {
  const localState = PROJECT_STORAGE_KEYS.reduce((accumulator, key) => {
    const value = safeRead(key)
    if (value !== undefined) {
      accumulator[key] = value
    }
    return accumulator
  }, {})

  return {
    version: 1,
    savedAt: new Date().toISOString(),
    runtime: {
      points,
      gridSize,
      unitSystem,
      calcData,
      zoom,
      panOffset,
      step,
    },
    localState,
  }
}

export const applyProjectState = (projectState, setters) => {
  const runtime = projectState?.runtime ?? {}
  const localState = projectState?.localState ?? {}

  PROJECT_STORAGE_KEYS.forEach((key) => {
    safeWrite(key, localState[key])
  })

  setters.setPoints(runtime.points ?? [])
  setters.setGridSize(runtime.gridSize ?? 35)
  setters.setUnitSystem(runtime.unitSystem ?? 'imperial')
  setters.setCalcData(
    runtime.calcData ?? {
      tiles: [],
      pedestals: [],
      userPolygon: [],
      tileCount: 0,
      adjustedPedestals: {},
    },
  )
  setters.setZoom(runtime.zoom ?? 1)
  setters.setPanOffset(runtime.panOffset ?? { x: 0, y: 0 })
  setters.setStep(runtime.step ?? 1)
}

