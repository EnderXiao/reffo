(function () {
  var isStandalone = window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
  if (isStandalone) {
    document.documentElement.classList.add('reffo-standalone')
  }

  var DESIGN_WIDTH = 393
  var BASE_FONT_SIZE = 20
  var MIN_ROOT_SIZE = 14
  var MAX_ROOT_SIZE = 24

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
  }

  function getViewportSize() {
    var viewport = window.visualViewport
    var documentElement = document.documentElement
    return {
      width: viewport && viewport.width ? viewport.width : documentElement.clientWidth,
      height: viewport && viewport.height ? viewport.height : documentElement.clientHeight,
    }
  }

  function refreshRootFontSize() {
    var size = getViewportSize()
    var effectiveWidth = Math.min(size.width, DESIGN_WIDTH)
    var nextFontSize = BASE_FONT_SIZE * (effectiveWidth / DESIGN_WIDTH)

    document.documentElement.style.fontSize = clamp(nextFontSize, MIN_ROOT_SIZE, MAX_ROOT_SIZE) + 'px'
  }

  function scheduleRefresh() {
    window.requestAnimationFrame(refreshRootFontSize)
  }

  refreshRootFontSize()
  window.addEventListener('resize', scheduleRefresh)
  window.addEventListener('orientationchange', scheduleRefresh)
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleRefresh)
    window.visualViewport.addEventListener('scroll', scheduleRefresh)
  }
})()
