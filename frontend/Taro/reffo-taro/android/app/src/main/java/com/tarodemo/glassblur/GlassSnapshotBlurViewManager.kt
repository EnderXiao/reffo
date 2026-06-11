package com.tarodemo.glassblur

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class GlassSnapshotBlurViewManager : SimpleViewManager<GlassSnapshotBlurImageView>() {
  override fun getName(): String = GlassSnapshotBlurViewManagerImpl.REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): GlassSnapshotBlurImageView =
    GlassSnapshotBlurViewManagerImpl.createViewInstance(context)

  @ReactProp(
    name = "blurRadius",
    defaultFloat = GlassSnapshotBlurViewManagerImpl.DEFAULT_BLUR_RADIUS,
  )
  fun setBlurRadius(view: GlassSnapshotBlurImageView, blurRadius: Float) {
    GlassSnapshotBlurViewManagerImpl.setBlurRadius(view, blurRadius)
  }

  @ReactProp(
    name = "downsampleFactor",
    defaultFloat = GlassSnapshotBlurViewManagerImpl.DEFAULT_DOWNSAMPLE_FACTOR,
  )
  fun setDownsampleFactor(view: GlassSnapshotBlurImageView, downsampleFactor: Float) {
    GlassSnapshotBlurViewManagerImpl.setDownsampleFactor(view, downsampleFactor)
  }

  @ReactProp(name = "enabled", defaultBoolean = true)
  fun setEnabled(view: GlassSnapshotBlurImageView, enabled: Boolean) {
    GlassSnapshotBlurViewManagerImpl.setEnabled(view, enabled)
  }

  @ReactProp(name = "refreshToken")
  fun setRefreshToken(view: GlassSnapshotBlurImageView, refreshToken: String?) {
    GlassSnapshotBlurViewManagerImpl.setRefreshToken(view, refreshToken)
  }
}
