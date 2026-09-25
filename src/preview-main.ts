// The sole MAIN-world composition entry. Feature modules install their page
// adapters when this entry is loaded by the manifest.
import "./preview-quality.main";
import "./preview-captions.main";
import "./preview-metadata.main";
import "./preview-info.main";
import "./preview-playlist.main";
import { installSharedPreview } from "./preview-playback-adapter";
import { installPreviewPageBridge } from "./preview-page-bridge.main";
import { installPlaylistFrameBroker } from "./preview-playlist-broker-frame.main";
import { installPlaylistTopBroker } from "./preview-playlist-broker-top.main";

installPreviewPageBridge();
if (window === window.top) installPlaylistTopBroker();
else installPlaylistFrameBroker();

installSharedPreview();
