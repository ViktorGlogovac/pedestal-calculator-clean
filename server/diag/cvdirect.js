const fs = require('fs')
const t0 = Date.now()
fs.writeFileSync('/tmp/cvdirect.txt', 'start\n')

const cv = require('@techstark/opencv-js')
fs.appendFileSync('/tmp/cvdirect.txt', 'required: ' + (Date.now()-t0) + 'ms, Mat type: ' + typeof cv.Mat + '\n')

let polls = 0
const tick = () => {
  polls++
  const elapsed = Date.now() - t0
  fs.appendFileSync('/tmp/cvdirect.txt', 'poll ' + polls + ' at ' + elapsed + 'ms, Mat: ' + typeof cv.Mat + '\n')
  if (cv.Mat) { fs.appendFileSync('/tmp/cvdirect.txt', 'READY\n'); process.exit(0) }
  if (elapsed > 15000) { fs.appendFileSync('/tmp/cvdirect.txt', 'TIMEOUT\n'); process.exit(1) }
  setTimeout(tick, 500)
}
setTimeout(tick, 500)
