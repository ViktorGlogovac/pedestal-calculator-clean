const fs = require('fs')
const t0 = Date.now()
fs.writeFileSync('/tmp/cvtime.txt', 'before require: 0ms\n')

const cv = require('@techstark/opencv-js')

fs.appendFileSync('/tmp/cvtime.txt', 'after require: ' + (Date.now()-t0) + 'ms, Mat: ' + (typeof cv.Mat) + '\n')

let polls = 0
const check = () => {
  polls++
  if (cv.Mat) {
    fs.appendFileSync('/tmp/cvtime.txt', 'Mat ready after: ' + (Date.now()-t0) + 'ms (' + polls + ' polls)\n')
    process.exit(0)
  }
  if (Date.now() - t0 > 30000) {
    fs.appendFileSync('/tmp/cvtime.txt', 'TIMEOUT\n')
    process.exit(1)
  }
  setTimeout(check, 100)
}
setTimeout(check, 100)
