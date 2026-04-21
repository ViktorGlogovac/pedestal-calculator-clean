const fs = require('fs')
const out = '/tmp/cvtest_out.txt'
fs.writeFileSync(out, 'start\n')

const { loadOpenCV } = require('../utils/cvLoader')
fs.appendFileSync(out, 'cvLoader required\n')

loadOpenCV().then(cv => {
  fs.appendFileSync(out, 'cv ready, Mat exists: ' + (typeof cv.Mat) + '\n')
  process.exit(0)
}).catch(e => {
  fs.appendFileSync(out, 'error: ' + e.message + '\n')
  process.exit(1)
})

// Timeout safety
setTimeout(() => {
  fs.appendFileSync(out, 'TIMEOUT after 10s\n')
  process.exit(2)
}, 10000)
