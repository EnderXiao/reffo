package com.tarodemo.glassblur

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.AttributeSet
import android.view.PixelCopy
import android.view.View
import android.view.ViewGroup
import android.view.Window
import androidx.appcompat.widget.AppCompatImageView
import kotlin.math.max
import kotlin.math.roundToInt

class GlassSnapshotBlurImageView @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null,
) : AppCompatImageView(context, attrs) {
  private var blurRadius = 24f
  private var downsampleFactor = 1f
  private var snapshotEnabled = true
  private var refreshPending = false
  private var refreshGeneration = 0
  private val mainHandler = Handler(Looper.getMainLooper())

  init {
    scaleType = ScaleType.FIT_XY
    clipToOutline = false
  }

  fun setSnapshotBlurRadius(value: Float) {
    val nextValue = value.coerceIn(0f, 200f)
    if (blurRadius == nextValue) {
      return
    }

    blurRadius = nextValue
    applyRenderBlur()
    scheduleRefresh()
  }

  fun setSnapshotDownsampleFactor(value: Float) {
    val nextValue = value.coerceIn(1f, 20f)
    if (downsampleFactor == nextValue) {
      return
    }

    downsampleFactor = nextValue
    scheduleRefresh()
  }

  fun setSnapshotEnabled(value: Boolean) {
    if (snapshotEnabled == value) {
      return
    }

    snapshotEnabled = value
    alpha = if (value) 1f else 0f
    if (value) {
      scheduleRefresh()
    } else {
      setImageDrawable(null)
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (snapshotEnabled) {
      scheduleRefresh()
    }
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    if (w != oldw || h != oldh) {
      scheduleRefresh()
    }
  }

  override fun onVisibilityChanged(changedView: View, visibility: Int) {
    super.onVisibilityChanged(changedView, visibility)
    if (changedView === this && visibility == VISIBLE && snapshotEnabled) {
      scheduleRefresh()
    }
  }

  override fun onDetachedFromWindow() {
    refreshGeneration += 1
    super.onDetachedFromWindow()
  }

  fun scheduleRefresh() {
    if (!snapshotEnabled || width <= 0 || height <= 0 || refreshPending) {
      return
    }

    refreshPending = true
    post {
      refreshPending = false
      refreshSnapshot()
    }
  }

  private fun refreshSnapshot() {
    if (!snapshotEnabled || width <= 0 || height <= 0) {
      return
    }

    val activity = resolveActivity(context) ?: return
    val window = activity.window ?: return
    val targetRect = resolveTargetRectInWindow(window) ?: return

    val bitmapWidth = max(1, (targetRect.width() / downsampleFactor).roundToInt())
    val bitmapHeight = max(1, (targetRect.height() / downsampleFactor).roundToInt())
    val bitmap = Bitmap.createBitmap(bitmapWidth, bitmapHeight, Bitmap.Config.ARGB_8888)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      copyWindowSnapshot(window, targetRect, bitmap)
    } else {
      drawRootSnapshot(bitmap)
    }
  }

  private fun copyWindowSnapshot(window: Window, targetRect: Rect, bitmap: Bitmap) {
    val requestGeneration = ++refreshGeneration
    val previousImageAlpha = imageAlpha
    imageAlpha = 0

    PixelCopy.request(window, targetRect, bitmap, { result ->
      imageAlpha = previousImageAlpha

      if (requestGeneration != refreshGeneration || !snapshotEnabled) {
        return@request
      }

      if (result == PixelCopy.SUCCESS) {
        setImageBitmap(bitmap)
        applyRenderBlur()
      } else {
        drawRootSnapshot(bitmap)
      }
    }, mainHandler)
  }

  private fun drawRootSnapshot(bitmap: Bitmap) {
    val rootView = resolveRootView() ?: return

    val rootLocation = IntArray(2)
    val targetLocation = IntArray(2)

    rootView.getLocationOnScreen(rootLocation)
    getLocationOnScreen(targetLocation)

    val translationX = (rootLocation[0] - targetLocation[0]).toFloat()
    val translationY = (rootLocation[1] - targetLocation[1]).toFloat()
    val canvas = Canvas(bitmap)
    val scaleX = bitmap.width.toFloat() / width.toFloat()
    val scaleY = bitmap.height.toFloat() / height.toFloat()
    canvas.scale(scaleX, scaleY)
    canvas.translate(translationX, translationY)

    val previousAlpha = alpha
    alpha = 0f
    rootView.draw(canvas)
    alpha = previousAlpha

    setImageBitmap(bitmap)
    applyRenderBlur()
  }

  private fun resolveTargetRectInWindow(window: Window): Rect? {
    val decorView = window.decorView
    if (decorView.width <= 0 || decorView.height <= 0) {
      return null
    }

    val targetLocation = IntArray(2)
    getLocationInWindow(targetLocation)

    val left = targetLocation[0].coerceIn(0, decorView.width)
    val top = targetLocation[1].coerceIn(0, decorView.height)
    val right = (targetLocation[0] + width).coerceIn(0, decorView.width)
    val bottom = (targetLocation[1] + height).coerceIn(0, decorView.height)

    if (right <= left || bottom <= top) {
      return null
    }

    return Rect(left, top, right, bottom)
  }

  private fun resolveRootView(): ViewGroup? {
    val activity = resolveActivity(context) ?: return null
    return activity.window?.decorView?.findViewById(android.R.id.content) as? ViewGroup
  }

  private fun resolveActivity(context: Context?): Activity? {
    var currentContext = context

    while (currentContext is ContextWrapper) {
      if (currentContext is Activity) {
        return currentContext
      }

      currentContext = currentContext.baseContext
    }

    return null
  }

  private fun applyRenderBlur() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      setRenderEffect(
        if (snapshotEnabled && blurRadius > 0f) {
          RenderEffect.createBlurEffect(blurRadius, blurRadius, Shader.TileMode.CLAMP)
        } else {
          null
        },
      )
    }
  }
}
