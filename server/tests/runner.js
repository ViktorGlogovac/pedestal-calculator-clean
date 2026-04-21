#!/usr/bin/env node
/**
 * Test runner for the deck sketch parsing pipeline.
 *
 * Usage:
 *   node server/tests/runner.js               — run all test suites
 *   node server/tests/runner.js units         — run only unit parsing
 *   node server/tests/runner.js lineGraphRect — run only rectangle graph test
 *
 * Exit code 0 = all tests passed, 1 = one or more failures.
 */

const { runAll } = require('./deckTestCases')

console.log(`\n${'═'.repeat(56)}`)
console.log(' Pedestal Calculator — Sketch Parser Test Suite')
console.log(`${'═'.repeat(56)}`)

const suiteName = process.argv[2] || null
const { failed } = runAll(suiteName)

console.log()
if (failed > 0) {
  console.log(' RESULT: Some tests FAILED — see above for details')
  process.exit(1)
} else {
  console.log(' RESULT: All tests PASSED')
  process.exit(0)
}
