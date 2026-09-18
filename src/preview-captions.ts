export const captionRequestEvent = "skip-ads-preview-caption-request";
export const captionResponseEvent = "skip-ads-preview-caption-response";
export type CaptionTrack = { id: string; label: string; languageCode: string };
export type CaptionState = {
  source: string; enabled: boolean; available: boolean; nativeSupported: boolean; error: string;
  tracks: CaptionTrack[]; selectedTrack: string; languageSupported: boolean;
  translations: { languageCode: string; label: string }[]; translation: string;
};
