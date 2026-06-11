package com.tarodemo.glassblur

import com.facebook.react.uimanager.ThemedReactContext

object GlassSnapshotBlurViewManagerImpl {
  const val REACT_CLASS = "GlassSnapshotBlurView"
  const val DEFAULT_BLUR_RADIUS = 24f
  const val DEFAULT_DOWNSAMPLE_FACTOR = 1f

  fun createViewInstance(context: ThemedReactContext): GlassSnapshotBlurImageView {
    val view = GlassSnapshotBlurImageView(context)
    view.setSnapshotBlurRadius(DEFAULT_BLUR_RADIUS)
    view.setSnapshotDownsampleFactor(DEFAULT_DOWNSAMPLE_FACTOR)
    view.setSnapshotEnabled(true)
    return view
  }

  fun setBlurRadius(view: GlassSnapshotBlurImageView, blurRadius: Float) {
    view.setSnapshotBlurRadius(blurRadius)
  }

  fun setDownsampleFactor(view: GlassSnapshotBlurImageView, downsampleFactor: Float) {
    view.setSnapshotDownsampleFactor(downsampleFactor)
  }

  fun setEnabled(view: GlassSnapshotBlurImageView, enabled: Boolean) {
    view.setSnapshotEnabled(enabled)
  }

  fun setRefreshToken(view: GlassSnapshotBlurImageView, refreshToken: String?) {
    if (refreshToken != null) {
      view.scheduleRefresh()
    }
  }
}
