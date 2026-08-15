import type { Dispatch, RefObject, SetStateAction } from 'react';
import {
  FitBoardIcon,
  FullscreenIcon,
  HomeIcon,
  VolumeIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '../../../components';
import type { BoardHandle } from '../../../components';

type BotMatchBoardControlsTrayProps = {
  boardRef: RefObject<BoardHandle | null>;
  isMuted: boolean;
  setIsMuted: Dispatch<SetStateAction<boolean>>;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  onRequestLeave: () => void;
};

export function BotMatchBoardControlsTray({
  boardRef,
  isMuted,
  setIsMuted,
  isFullscreen,
  toggleFullscreen,
  onRequestLeave,
}: BotMatchBoardControlsTrayProps) {
  return (
    <div
      className="wl-controls-tray control-pill"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        zIndex: 20,
      }}
    >
      <button
        type="button"
        className="wl-control-btn"
        title="Zoom out"
        aria-label="Zoom out"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          boardRef.current?.zoomOut();
        }}
      >
        <ZoomOutIcon />
      </button>
      <button
        type="button"
        className="wl-control-btn"
        title="Fit board"
        aria-label="Fit board"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          boardRef.current?.resetCamera();
        }}
      >
        <FitBoardIcon />
      </button>
      <button
        type="button"
        className="wl-control-btn"
        title="Zoom in"
        aria-label="Zoom in"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          boardRef.current?.zoomIn();
        }}
      >
        <ZoomInIcon />
      </button>
      <button
        type="button"
        className="wl-control-btn"
        onClick={() => setIsMuted((prev) => !prev)}
        title={isMuted ? 'Unmute' : 'Mute'}
        aria-label={isMuted ? 'Unmute' : 'Mute'}
      >
        <VolumeIcon isMuted={isMuted} />
      </button>
      <button
        type="button"
        className="wl-control-btn"
        onClick={toggleFullscreen}
        title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      >
        <FullscreenIcon isFullscreen={isFullscreen} />
      </button>
      <button
        type="button"
        className="wl-control-btn"
        onClick={onRequestLeave}
        title="Leave game"
        aria-label="Leave game"
      >
        <HomeIcon />
      </button>
    </div>
  );
}