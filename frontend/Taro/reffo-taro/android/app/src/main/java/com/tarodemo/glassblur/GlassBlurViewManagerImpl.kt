package com.tarodemo.glassblur

import android.graphics.Color
import android.os.Build
import android.view.ViewGroup
import com.facebook.react.uimanager.ThemedReactContext
import eightbitlab.com.blurview.BlurView
import eightbitlab.com.blurview.RenderEffectBlur
import eightbitlab.com.blurview.RenderScriptBlur

object GlassBlurViewManagerImpl {
  const val REACT_CLASS = "GlassAndroidBlurView"
  const val DEFAULT_BLUR_RADIUS = 12f
  private const val MAX_BLUR_RADIUS = 40f

  fun createViewInstance(context: ThemedReactContext): BlurView {
    val blurView = BlurView(context)
    val activity = context.currentActivity
    val decorView = activity?.window?.decorView
    val rootView = decorView?.findViewById<ViewGroup>(android.R.id.content)

    if (rootView != null) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        blurView
          .setupWith(rootView, RenderEffectBlur())
          .setFrameClearDrawable(decorView.background)
      } else {
        blurView
          .setupWith(rootView, RenderScriptBlur(context))
          .setFrameClearDrawable(decorView.background)
      }
    }

    blurView.setBlurAutoUpdate(true)
    blurView.setOverlayColor(Color.TRANSPARENT)
    setBlurRadius(blurView, DEFAULT_BLUR_RADIUS)

    return blurView
  }

  fun setBlurRadius(view: BlurView, blurRadius: Float) {
    val safeRadius = blurRadius.coerceIn(0f, MAX_BLUR_RADIUS)
    view.setBlurEnabled(safeRadius > 0f)

    if (safeRadius > 0f) {
      view.setBlurRadius(safeRadius)
    }

    view.invalidate()
  }

  fun setOverlayColor(view: BlurView, overlayColor: Int?) {
    view.setOverlayColor(overlayColor ?: Color.TRANSPARENT)
    view.invalidate()
  }

  fun setBlurEnabled(view: BlurView, enabled: Boolean) {
    view.setBlurEnabled(enabled)
    view.invalidate()
  }

  fun setAutoUpdate(view: BlurView, autoUpdate: Boolean) {
    view.setBlurAutoUpdate(autoUpdate)
    view.invalidate()
  }
}
