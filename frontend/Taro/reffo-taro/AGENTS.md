# Reffo Taro Agent Notes

## H5 Style Unit Policy

Taro H5 styles must distinguish between layout metrics and visual effect parameters.

- Use lowercase `px` for layout metrics that should scale with the configured design width.
  This includes `width`, `height`, `margin`, `padding`, `top`, `right`, `bottom`, `left`,
  `font-size`, `line-height`, `border-radius`, `border-width`, icon sizes, component spacing,
  and other values that determine how much space an element occupies.

- Use uppercase `PX` for visual effect parameters that should keep a stable physical intensity
  across devices and should not be converted by Taro px transform.
  This includes `filter` and `backdrop-filter` blur radii, shadow blur and spread radii,
  glow/highlight radii, material noise scale values, and similar rendering-effect lengths.

- Decision rule:
  If the value controls element geometry or layout, use `px`.
  If the value controls visual rendering strength, use `PX`.

Example:

```scss
.card {
  width: 210px;
  height: 332px;
  padding: 22px;
  border-radius: 10px;
  font-size: 14px;

  backdrop-filter: blur(12PX);
  box-shadow: 0 12PX 24PX rgba(0, 0, 0, 0.16);
}
```
