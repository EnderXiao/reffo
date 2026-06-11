package com.tarodemo.glassblur

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import eightbitlab.com.blurview.BlurView

class GlassBlurViewManager : SimpleViewManager<BlurView>() {
  override fun getName(): String = GlassBlurViewManagerImpl.REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): BlurView =
    GlassBlurViewManagerImpl.createViewInstance(context)

  @ReactProp(name = "blurRadius", defaultFloat = GlassBlurViewManagerImpl.DEFAULT_BLUR_RADIUS)
  fun setBlurRadius(view: BlurView, blurRadius: Float) {
    GlassBlurViewManagerImpl.setBlurRadius(view, blurRadius)
  }

  @ReactProp(name = "overlayColor", customType = "Color")
  fun setOverlayColor(view: BlurView, overlayColor: Int?) {
    GlassBlurViewManagerImpl.setOverlayColor(view, overlayColor)
  }

  @ReactProp(name = "enabled", defaultBoolean = true)
  fun setEnabled(view: BlurView, enabled: Boolean) {
    GlassBlurViewManagerImpl.setBlurEnabled(view, enabled)
  }

  @ReactProp(name = "autoUpdate", defaultBoolean = true)
  fun setAutoUpdate(view: BlurView, autoUpdate: Boolean) {
    GlassBlurViewManagerImpl.setAutoUpdate(view, autoUpdate)
  }
}
