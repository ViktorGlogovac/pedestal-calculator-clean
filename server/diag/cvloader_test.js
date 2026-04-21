const fs = require('fs')
const t0 = Date.now()
fs.writeFileSync('/tmp/cvloader_test.txt', 'start\n')

// Simulate what cvLoader does - require at top level
const cv = require('@techstark/opencv-js')
fs.appendFileSync('/tmp/cvloader_test.txt', 'required: ' + (Date.now()-t0) + 'ms\n')

// Simulate loadOpenCV() behavior
function loadOpenCV() {
  if (cv.Mat) return Promise.resolve(cv)
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const interval = setInterval(() => {
      fs.appendFileSync('/tmp/cvloader_test.txt', 'poll at ' + (Date.now()-t0) + 'ms, Mat: ' + typeof cv.Mat + '\n')
      if (cv.Mat) {
        clearInterval(interval)
        resolve(cv)
      } else if (Date.now() - start > 15000) {
        clearInterval(interval)
        reject(new Error('timeout'))
      }
    }, 200)
  })
}

fs.appendFileSync('/tmp/cvloader_test.txt', 'calling loadOpenCV\n')
loadOpenCV().then(cv => {
  fs.appendFileSync('/tmp/cvloader_test.txt', 'READY at ' + (Date.now()-t0) + 'ms\n')
  process.exit(0)
}).catch(e => {
  fs.appendFileSync('/tmp/cvloader_test.txt', 'ERROR: ' + e.message + '\n')
  process.exit(1)
})

setTimeout(() => {
  fs.appendFileSync('/tmp/cvloader_test.txt', '10s safety timeout fired\n')
  process.exit(2)
}, 10000)
