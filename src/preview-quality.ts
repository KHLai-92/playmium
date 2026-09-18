// Shared, bounded DOM protocol between the isolated controls and page player.
export const qualityRequestEvent = "skip-ads-preview-quality-request";
export const qualityResponseEvent = "skip-ads-preview-quality-response";
export const qualityLabels: Record<string, string> = {
  highres: "Highest", hd2880: "2880p", hd2160: "2160p", hd1440: "1440p",
  hd1080: "1080p", hd720: "720p", large: "480p", medium: "360p",
  small: "240p", tiny: "144p", auto: "Auto",
};
export type QualityState = {
  source: string;
  available: string[];
  current: string;
  requested: string | null;
  requestedAt: number;
  supported: boolean;
  error: string;
};
