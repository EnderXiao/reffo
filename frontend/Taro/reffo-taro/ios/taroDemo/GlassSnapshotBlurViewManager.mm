#import <CoreImage/CoreImage.h>
#import <QuartzCore/QuartzCore.h>
#import <React/RCTConvert.h>
#import <React/RCTViewManager.h>
#import <cfloat>

@interface GlassSnapshotBlurContentView : UIView

@property (nonatomic, assign) CGFloat blurRadius;
@property (nonatomic, assign) CGFloat downsampleFactor;
@property (nonatomic, assign, getter=isEnabled) BOOL enabled;
@property (nonatomic, copy, nullable) NSString *refreshToken;

- (void)scheduleRefresh;

@end

@implementation GlassSnapshotBlurContentView {
  UIImageView *_imageView;
  BOOL _refreshPending;
  NSInteger _refreshGeneration;
  dispatch_queue_t _blurQueue;
  CIContext *_ciContext;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  self = [super initWithFrame:frame];
  if (self) {
    _blurRadius = 24.0;
    _downsampleFactor = 1.0;
    _enabled = YES;
    _blurQueue = dispatch_queue_create("com.tarodemo.glass.snapshotblur", DISPATCH_QUEUE_SERIAL);
    _ciContext = [CIContext contextWithOptions:nil];

    self.clipsToBounds = YES;
    self.userInteractionEnabled = NO;
    self.backgroundColor = UIColor.clearColor;

    _imageView = [[UIImageView alloc] initWithFrame:self.bounds];
    _imageView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    _imageView.contentMode = UIViewContentModeScaleToFill;
    _imageView.clipsToBounds = YES;
    _imageView.userInteractionEnabled = NO;
    [self addSubview:_imageView];
  }
  return self;
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  _imageView.frame = self.bounds;

  if (self.enabled) {
    [self scheduleRefresh];
  }
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];

  if (self.window != nil && self.enabled) {
    [self scheduleRefresh];
  }
}

- (void)setBlurRadius:(CGFloat)blurRadius
{
  CGFloat nextValue = MAX(0.0, MIN(blurRadius, 200.0));
  if (fabs(_blurRadius - nextValue) < DBL_EPSILON) {
    return;
  }

  _blurRadius = nextValue;
  [self scheduleRefresh];
}

- (void)setDownsampleFactor:(CGFloat)downsampleFactor
{
  CGFloat nextValue = MAX(1.0, MIN(downsampleFactor, 20.0));
  if (fabs(_downsampleFactor - nextValue) < DBL_EPSILON) {
    return;
  }

  _downsampleFactor = nextValue;
  [self scheduleRefresh];
}

- (void)setEnabled:(BOOL)enabled
{
  if (_enabled == enabled) {
    return;
  }

  _enabled = enabled;
  if (!enabled) {
    _imageView.image = nil;
    return;
  }

  [self scheduleRefresh];
}

- (void)setRefreshToken:(NSString *)refreshToken
{
  if ((_refreshToken == nil && refreshToken == nil) || [_refreshToken isEqualToString:refreshToken]) {
    return;
  }

  _refreshToken = [refreshToken copy];
  if (self.enabled) {
    [self scheduleRefresh];
  }
}

- (void)scheduleRefresh
{
  if (!self.enabled || self.window == nil || CGRectIsEmpty(self.bounds) || _refreshPending) {
    return;
  }

  _refreshPending = YES;
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_refreshPending = NO;
    [self refreshSnapshot];
  });
}

- (void)refreshSnapshot
{
  if (!self.enabled || self.window == nil || CGRectIsEmpty(self.bounds)) {
    return;
  }

  UIWindow *window = self.window;
  CGRect targetRect = [self convertRect:self.bounds toView:window];
  targetRect = CGRectIntersection(targetRect, window.bounds);

  if (CGRectIsEmpty(targetRect)) {
    return;
  }

  CGFloat factor = MAX(1.0, self.downsampleFactor);
  CGSize captureSize = CGSizeMake(MAX(1.0, floor(CGRectGetWidth(targetRect) / factor)),
                                  MAX(1.0, floor(CGRectGetHeight(targetRect) / factor)));
  UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat defaultFormat];
  format.opaque = NO;

  UIImage *snapshot = nil;
  BOOL previousHidden = _imageView.hidden;
  _imageView.hidden = YES;

  @autoreleasepool {
    UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:captureSize
                                                                                format:format];
    snapshot = [renderer imageWithActions:^(UIGraphicsImageRendererContext *_Nonnull context) {
      CGContextRef cgContext = context.CGContext;
      CGFloat scaleX = captureSize.width / CGRectGetWidth(targetRect);
      CGFloat scaleY = captureSize.height / CGRectGetHeight(targetRect);
      CGContextScaleCTM(cgContext, scaleX, scaleY);
      CGContextTranslateCTM(cgContext, -CGRectGetMinX(targetRect), -CGRectGetMinY(targetRect));
      [window drawViewHierarchyInRect:window.bounds afterScreenUpdates:NO];
    }];
  }

  _imageView.hidden = previousHidden;

  if (snapshot == nil) {
    return;
  }

  NSInteger generation = ++_refreshGeneration;
  CGFloat blurRadius = self.blurRadius;

  dispatch_async(_blurQueue, ^{
    UIImage *blurredImage = [self blurredImageFromImage:snapshot radius:blurRadius];
    dispatch_async(dispatch_get_main_queue(), ^{
      if (generation != self->_refreshGeneration || !self.enabled) {
        return;
      }

      self->_imageView.image = blurredImage;
    });
  });
}

- (UIImage *)blurredImageFromImage:(UIImage *)image radius:(CGFloat)radius
{
  if (image == nil || radius <= 0.0) {
    return image;
  }

  CIImage *inputImage = [[CIImage alloc] initWithImage:image];
  if (inputImage == nil) {
    return image;
  }

  CIFilter *clampFilter = [CIFilter filterWithName:@"CIAffineClamp"];
  [clampFilter setValue:inputImage forKey:kCIInputImageKey];
  [clampFilter setValue:[NSValue valueWithCGAffineTransform:CGAffineTransformIdentity]
                 forKey:@"inputTransform"];
  CIImage *clampedImage = clampFilter.outputImage != nil ? clampFilter.outputImage : inputImage;

  CIFilter *blurFilter = [CIFilter filterWithName:@"CIGaussianBlur"];
  [blurFilter setValue:clampedImage forKey:kCIInputImageKey];
  [blurFilter setValue:@(radius) forKey:kCIInputRadiusKey];
  CIImage *outputImage = blurFilter.outputImage != nil ? blurFilter.outputImage : inputImage;

  CGRect extent = inputImage.extent;
  CGImageRef blurredImageRef = [_ciContext createCGImage:outputImage fromRect:extent];
  if (blurredImageRef == nil) {
    return image;
  }

  UIImage *blurredImage = [UIImage imageWithCGImage:blurredImageRef
                                              scale:image.scale
                                        orientation:image.imageOrientation];
  CGImageRelease(blurredImageRef);

  return blurredImage;
}

@end

@interface GlassSnapshotBlurViewManager : RCTViewManager
@end

@implementation GlassSnapshotBlurViewManager

RCT_EXPORT_MODULE(GlassSnapshotBlurView)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (UIView *)view
{
  return [[GlassSnapshotBlurContentView alloc] initWithFrame:CGRectZero];
}

RCT_EXPORT_VIEW_PROPERTY(blurRadius, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(downsampleFactor, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(enabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(refreshToken, NSString)

@end
