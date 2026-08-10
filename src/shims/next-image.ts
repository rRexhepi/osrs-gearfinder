// Shim for `next/image` so vendored upstream files compile under Vite.
// Vite turns image imports into URL strings, so StaticImageData is just a string.
export type StaticImageData = string;

export default function Image(): never {
  throw new Error('next/image is not available; use a plain <img> tag');
}
