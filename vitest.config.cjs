const { defineConfig } = require('vitest/config')

module.exports = defineConfig({
  test: {
    globals: true,
    watch: false,
    isolate: false,
    environment: 'node',
    reporters: ['tree'],
  },
})
