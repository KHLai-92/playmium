# Inline Preview

Inline Preview provides a floating YouTube preview player and playlist switching without leaving the current page.

## Language

**YouTube native preview**:
A preview experience supplied by YouTube for a video.
_Avoid_: Preview startup, YouTube-provided preview

**Playmium-added preview**:
A preview Playmium supplies when YouTube does not provide its native preview experience for a video.
_Avoid_: Non-native preview, playlist preview, other video

**Playlist hover preparation**:
Transient work started after stable hover or focus so a playlist selection can begin preparing before a click.
_Avoid_: Retention, saved preview

**Playlist preview retention**:
A completed playlist preview response kept for possible later selection after its preparation has finished.
_Avoid_: Hover preparation, prefetch trigger
