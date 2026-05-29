import type { ReactNode, Ref } from 'react';
import '../practice/noBrainerLab.css';

/** Inset board frame: watermark, canvas, optional toolbar. */
export interface InGameBoardFrameProps {
  children: ReactNode;
  toolbar?: ReactNode;
  className?: string;
}

export function InGameBoardFrame({ children, toolbar, className }: InGameBoardFrameProps) {
  return (
    <main className={`nbl-stage walnut-nbl-stage rh-board-stage${className ? ` ${className}` : ''}`}>
      <div className="nbl-board-frame rh-board-frame">
        <div className="nbl-board-canvas rh-board-canvas" data-ui="board">
          <div className="nbl-board-watermark rh-board-watermark" aria-hidden="true">
            <img src="/brand_logo.png" alt="" />
          </div>
          {children}
          {toolbar ? <div className="nbl-board-toolbar">{toolbar}</div> : null}
        </div>
      </div>
    </main>
  );
}

export type InGameBoardLayout = 'studio' | 'walnut-hud' | 'walnut-wrap';

export interface InGameBoardShellProps {
  /**
   * - studio: rh-live-studio-shell + framed board zone + hand tray
   * - walnut-hud: walnut-match-layout + top HUD + wl-stage + hand (multiplayer)
   * - walnut-wrap: walnut-match-layout + top HUD + studio shell or custom matchBody (Fritz / bot)
   */
  layout?: InGameBoardLayout;
  board: ReactNode;
  boardMeta?: ReactNode;
  boardMetaBarClassName?: string;
  boardToolbar?: ReactNode;
  frameClassName?: string;
  boardStageRef?: Ref<HTMLDivElement>;
  hand?: ReactNode;
  handClassName?: string;
  /** Outer hand wrapper class (default: hand-area wl-hand-area; bot studio uses rh-live-hand-deck). */
  handOuterClassName?: string;
  handRef?: Ref<HTMLDivElement>;
  studioClassName?: string;
  /** Board zone + stage only (guided learn embed, or NBL main). */
  boardColumnOnly?: boolean;
  boardZoneClassName?: string;
  boardZonePrefix?: ReactNode;
  topHud?: ReactNode;
  /** walnut-wrap only: replaces default studio shell (e.g. guided learn cockpit). */
  matchBody?: ReactNode;
  matchLayoutClassName?: string;
  /** walnut-wrap: HUD + play + rail + hand as one pvf-control-panel column (Fritz / Daily Fritz). */
  integratedPvfPanel?: boolean;
}

function InGameBoardFrameContent({
  board,
  boardMeta,
  boardMetaBarClassName,
  boardToolbar,
  frameClassName,
}: Pick<
  InGameBoardShellProps,
  'board' | 'boardMeta' | 'boardMetaBarClassName' | 'boardToolbar' | 'frameClassName'
>) {
  return (
    <InGameBoardFrame className={frameClassName} toolbar={boardToolbar}>
      {boardMeta ? (
        <div
          className={`rh-board-meta-bar${boardMetaBarClassName ? ` ${boardMetaBarClassName}` : ''}`}
          data-ui="board-meta"
        >
          {boardMeta}
        </div>
      ) : null}
      {board}
    </InGameBoardFrame>
  );
}

function InGameBoardStage({
  layout,
  boardStageRef,
  frameClassName,
  board,
  boardMeta,
  boardMetaBarClassName,
  boardToolbar,
  boardZoneClassName,
  boardZonePrefix,
  playfieldEmbed = false,
}: Pick<
  InGameBoardShellProps,
  | 'layout'
  | 'boardStageRef'
  | 'frameClassName'
  | 'board'
  | 'boardMeta'
  | 'boardMetaBarClassName'
  | 'boardToolbar'
  | 'boardZoneClassName'
  | 'boardZonePrefix'
> & { playfieldEmbed?: boolean }) {
  const stage = (
    <div className="wl-stage-shell" ref={boardStageRef}>
      <InGameBoardFrameContent
        board={board}
        boardMeta={boardMeta}
        boardMetaBarClassName={boardMetaBarClassName}
        boardToolbar={boardToolbar}
        frameClassName={frameClassName}
      />
    </div>
  );

  const playfieldClass = `rh-match-playfield-card${playfieldEmbed ? ' rh-match-playfield-card--embed' : ''}`;

  if (layout === 'walnut-hud') {
    return (
      <div className={playfieldClass} data-ui="playfield">
        {stage}
      </div>
    );
  }

  return (
    <div className={playfieldClass} data-ui="playfield">
      <div
        className={`rh-live-board-zone rh-match-arena${boardZoneClassName ? ` ${boardZoneClassName}` : ''}`}
        data-ui="live-board-zone"
      >
        {boardZonePrefix}
        {stage}
      </div>
    </div>
  );
}

function InGameBoardHandTray({
  hand,
  handClassName,
  handOuterClassName,
  handRef,
}: Pick<InGameBoardShellProps, 'hand' | 'handClassName' | 'handOuterClassName' | 'handRef'>) {
  if (hand == null) return null;

  const outerClass = handOuterClassName ?? 'hand-area wl-hand-area';
  const dataUi = handOuterClassName === 'rh-live-hand-deck' ? 'live-hand-deck' : 'tray';

  return (
    <div
      ref={handRef}
      className={`${outerClass}${handClassName ? ` ${handClassName}` : ''}`}
      data-ui={dataUi}
    >
      {hand}
    </div>
  );
}

/**
 * Canonical in-game board layout shell.
 */
export function InGameBoardShell({
  layout = 'studio',
  board,
  boardMeta,
  boardMetaBarClassName,
  boardToolbar,
  frameClassName,
  boardStageRef,
  hand,
  handClassName,
  handOuterClassName,
  handRef,
  studioClassName,
  boardColumnOnly = false,
  boardZoneClassName,
  boardZonePrefix,
  topHud,
  matchBody,
  matchLayoutClassName,
  integratedPvfPanel = false,
}: InGameBoardShellProps) {
  const studioStageLayout: InGameBoardLayout = 'studio';
  const cinematicPvfPanel =
    integratedPvfPanel && layout === 'walnut-wrap' && !boardColumnOnly;
  const stage = (
    <InGameBoardStage
      layout={layout === 'walnut-hud' ? 'walnut-hud' : studioStageLayout}
      board={board}
      boardMeta={boardMeta}
      boardMetaBarClassName={boardMetaBarClassName}
      boardToolbar={boardToolbar}
      frameClassName={frameClassName}
      boardStageRef={boardStageRef}
      boardZoneClassName={boardZoneClassName}
      boardZonePrefix={boardZonePrefix}
      playfieldEmbed={boardColumnOnly}
    />
  );

  if (boardColumnOnly) {
    return stage;
  }

  const studioBody = (
    <div className="rh-match-body" data-ui="match-body">
      {stage}
      <InGameBoardHandTray
        hand={hand}
        handClassName={handClassName}
        handOuterClassName={handOuterClassName}
        handRef={handRef}
      />
    </div>
  );

  if (layout === 'walnut-hud') {
    return (
      <div
        className={matchLayoutClassName ?? 'walnut-match-layout game-layout-layer'}
        data-ui="match-board"
      >
        {topHud}
        {stage}
        <InGameBoardHandTray
          hand={hand}
          handClassName={handClassName}
          handOuterClassName={handOuterClassName}
          handRef={handRef}
        />
      </div>
    );
  }

  if (layout === 'walnut-wrap' && integratedPvfPanel && matchBody == null) {
    return (
      <div
        className={
          matchLayoutClassName ??
          'walnut-match-layout game-layout-layer rh-pvf-integrated-layout rh-pvf-pass-a'
        }
        data-ui="match-board"
      >
        <div className="rh-pvf-match-panel rh-pvf-cinematic-panel" data-ui="pvf-match-panel">
          {topHud ? (
            <div className="rh-pvf-match-panel__hud" data-ui="hud">
              {topHud}
            </div>
          ) : null}
          {topHud ? (
            <div className="pvf-section-divider rh-pvf-match-panel__divider" aria-hidden="true" />
          ) : null}
          <div className="rh-pvf-match-panel__main rh-pvf-cinematic-main" data-ui="match-main">
            <div className="rh-pvf-match-panel__play rh-pvf-cinematic-play" data-ui="match-play">
              <div className="rh-match-body rh-pvf-cinematic-body" data-ui="match-body">
                {stage}
              </div>
            </div>
          </div>
          {hand != null ? (
            <>
              <div className="pvf-section-divider rh-pvf-match-panel__divider" aria-hidden="true" />
              <InGameBoardHandTray
                hand={hand}
                handClassName={handClassName}
                handOuterClassName={`${handOuterClassName ?? 'rh-live-hand-deck'} rh-pvf-match-panel__hand`}
                handRef={handRef}
              />
            </>
          ) : null}
        </div>
      </div>
    );
  }

  if (layout === 'walnut-wrap') {
    return (
      <div
        className={matchLayoutClassName ?? 'walnut-match-layout game-layout-layer'}
        data-ui="match-board"
      >
        {topHud}
        {matchBody ?? (
          <div
            className={`rh-live-studio-shell${studioClassName ? ` ${studioClassName}` : ''}`}
            data-ui="live-studio-shell"
          >
            {studioBody}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`rh-live-studio-shell${studioClassName ? ` ${studioClassName}` : ''}`}
      data-ui="live-studio-shell"
    >
      {studioBody}
    </div>
  );
}
