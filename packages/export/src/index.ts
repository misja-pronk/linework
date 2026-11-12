export { toPptx, iconSvg, type Drawing, type PptxOptions, type Rasterize } from './pptx.ts';
export { toPdf, pdfFamilies, type FamilyBytes, type FontBytes, type PdfOptions } from './pdf.ts';
export * from './steps.ts';
export { svgOnPage } from './page.ts';
export type { SlideText } from './pptx.ts';
export { toPictureDeck, type PictureSlide } from './pictures.ts';
export { readTemplate, chooseLayout, type PptxTemplate, type TemplateLayout } from './template/read.ts';
export { templateTheme } from './template/theme.ts';
export { fitSlide, ownRoom, slideScale, stepCaptionLines, type SlideFit, type SlideRoom } from './fit.ts';
