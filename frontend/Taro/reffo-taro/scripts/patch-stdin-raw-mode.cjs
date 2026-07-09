'use strict'

if (!process.stdin) {
  process.stdin = process.stdin || {}
}

if (typeof process.stdin.setRawMode !== 'function') {
  process.stdin.setRawMode = () => {}
}
