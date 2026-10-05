const { copyLib } = require('./deps')

copyLib().catch(error => {
  console.error(error)
  process.exitCode = 1
})
