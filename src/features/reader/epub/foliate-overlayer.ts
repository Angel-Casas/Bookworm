// Typed re-export of foliate-js's Overlayer class. The upstream module ships
// untyped JS; this file declares the surface our adapter actually uses.
//
// Why a separate file: with `moduleResolution: bundler`, TS resolves
// `foliate-js/overlayer.js` to the real file and ignores ambient
// `declare module` declarations. A typed wrapper module sidesteps that.

export type FoliateOverlayerRect = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
};

export type FoliateHighlightDrawer = (
  rects: readonly FoliateOverlayerRect[],
  options?: { color?: string },
) => SVGElement;

interface FoliateOverlayerStatic {
  highlight: FoliateHighlightDrawer;
}

// @ts-expect-error -- foliate-js has no upstream type declarations.
import { Overlayer as RawOverlayer } from 'foliate-js/overlayer.js';

export const Overlayer = RawOverlayer as FoliateOverlayerStatic;
